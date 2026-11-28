import type { ApiWorkerNode, DispatchResult } from "./spike-fleet.ts";

/**
 * Patched Spike.sh API Fleet Model:
 * 1. Recursion depth cap (MAX_ROTATION_DEPTH = 32) rejects cyclic schedules cleanly.
 * 2. Queue-aware readiness probe rejects workers >= 75% thread saturation or frozen.
 * 3. Request idempotency deduplicates retries without amplifying CPU load.
 */
export class SpikeFleetPatched {
  static readonly MAX_ROTATION_DEPTH = 32;
  readonly workers: ApiWorkerNode[];
  readonly seenRequestIds = new Set<string>();
  droppedAlerts = 0;
  rejectedPoisonPills = 0;
  processedAlerts = 0;
  deduplicatedRetries = 0;
  private rrIndex = 0;

  constructor(workerCount = 4, maxThreadsPerWorker = 8) {
    this.workers = Array.from({ length: workerCount }, (_, i) => ({
      id: `api-worker-${i + 1}`,
      activeThreads: 0,
      maxThreads: maxThreadsPerWorker,
      cpuPct: 5,
      frozen: false,
    }));
  }

  /** Readiness probe: only routes to workers with real capacity headroom */
  readinessCheck(worker: ApiWorkerNode): boolean {
    if (worker.frozen) return false;
    return worker.activeThreads < Math.floor(worker.maxThreads * 0.75);
  }

  private computeShiftRotationBounded(depth: number, visited: Set<string>, slotKey: string): { ok: boolean } {
    if (depth > SpikeFleetPatched.MAX_ROTATION_DEPTH || visited.has(slotKey)) {
      return { ok: false };
    }
    visited.add(slotKey);
    return { ok: true };
  }

  dispatchRequest(req: { id: string; isCyclicPoisonPill?: boolean }): DispatchResult {
    if (this.seenRequestIds.has(req.id)) {
      this.deduplicatedRetries++;
      return { accepted: true, routedToWorkerId: null, statusCode: 200, reason: "deduplicated" };
    }

    const ready = this.workers.filter((w) => this.readinessCheck(w));
    if (ready.length === 0) {
      this.droppedAlerts++;
      return { accepted: false, routedToWorkerId: null, statusCode: 503, reason: "shed_at_threshold" };
    }

    const target = ready[this.rrIndex % ready.length]!;
    this.rrIndex++;

    target.activeThreads++;
    if (req.isCyclicPoisonPill) {
      const visited = new Set<string>(["slot-A"]);
      const res = this.computeShiftRotationBounded(1, visited, "slot-A");
      target.activeThreads--;
      if (!res.ok) {
        this.rejectedPoisonPills++;
        return { accepted: false, routedToWorkerId: target.id, statusCode: 503, reason: "cyclic_schedule_rejected" };
      }
    }

    this.seenRequestIds.add(req.id);
    target.activeThreads--;
    this.processedAlerts++;
    return {
      accepted: true,
      routedToWorkerId: target.id,
      statusCode: 200,
    };
  }
}
