export interface ApiWorkerNode {
  id: string;
  activeThreads: number;
  maxThreads: number;
  cpuPct: number;
  frozen: boolean;
}

export interface DispatchResult {
  accepted: boolean;
  routedToWorkerId: string | null;
  statusCode: 200 | 503 | 504;
  reason?: string;
}

/**
 * Unpatched Spike.sh API Fleet Model:
 * 1. Shift-rotation calculator has no recursion depth cap (poison-pill loops up to stack limit).
 * 2. Health check (/healthz) returns static 200 OK even when 100% of worker threads are pegged.
 * 3. Load balancer keeps routing live monitoring alerts to frozen workers.
 */
export class SpikeFleetUnpatched {
  readonly workers: ApiWorkerNode[];
  droppedAlerts = 0;
  processedAlerts = 0;
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

  /** Static liveness probe: lies by returning true even when worker threads are 100% frozen */
  healthCheck(_worker: ApiWorkerNode): boolean {
    return true;
  }

  private computeShiftRotation(depth: number, cyclic: boolean): number {
    if (!cyclic && depth <= 0) return 1;
    // Unbounded recursion bug when cyclic schedule is encountered (capped safely at 10_000 iterations in JS test)
    if (cyclic) {
      let acc = 0;
      for (let i = 0; i < 10_000; i++) acc += i;
      return acc;
    }
    return this.computeShiftRotation(depth - 1, false);
  }

  dispatchRequest(req: { id: string; isCyclicPoisonPill?: boolean }): DispatchResult {
    // Load balancer picks next "healthy" worker per lying healthCheck()
    const healthy = this.workers.filter((w) => this.healthCheck(w));
    const target = healthy[this.rrIndex % healthy.length]!;
    this.rrIndex++;

    if (target.frozen || target.activeThreads >= target.maxThreads) {
      this.droppedAlerts++;
      return {
        accepted: false,
        routedToWorkerId: target.id,
        statusCode: 504,
        reason: "routed_to_frozen_worker",
      };
    }

    target.activeThreads++;
    if (req.isCyclicPoisonPill) {
      this.computeShiftRotation(1, true);
      target.activeThreads = target.maxThreads;
      target.cpuPct = 100;
      target.frozen = true;
      this.droppedAlerts++;
      return {
        accepted: false,
        routedToWorkerId: target.id,
        statusCode: 504,
        reason: "unbounded_recursion_cpu_100pct",
      };
    }

    target.activeThreads--;
    this.processedAlerts++;
    return {
      accepted: true,
      routedToWorkerId: target.id,
      statusCode: 200,
    };
  }
}
