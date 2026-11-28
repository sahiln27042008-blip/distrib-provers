import { createHash } from "node:crypto";
import type { Sim } from "../../../kernel.ts";
import type { Vowel } from "../types.ts";
import type { Cell } from "../vowels/cell.ts";
import type { Lease } from "../vowels/lease.ts";
import type { Channel } from "../vowels/channel.ts";
import type { Finding } from "./finding.ts";

export interface QuiescenceOptions {
  calmDownTicks?: number;
  checkConvergence?: boolean;
  maxPendingAllowed?: number;
  replicaGroups?: string[][];
}

export interface QuiescenceResult {
  quiescent: boolean;
  converged: boolean;
  finalVirtualTick: number;
  pendingTasks: number;
  stateHashes: Record<string, string>;
  findings: Finding[];
}

function canonJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonJson(o[k])}`).join(",")}}`;
}

function sha256(v: unknown): string {
  return createHash("sha256").update(canonJson(v)).digest("hex").slice(0, 16);
}

/**
 * Calm-Down Phase (#5): Turns off fault injection, advances virtual time by `calmDownTicks`,
 * and checks both Liveness (no pending tasks / stuck leases / hung channels) and
 * Convergence (healthy replica cells converge to identical canonical state hashes).
 */
export function runQuiescencePhase(
  sim: Sim,
  vowels: Map<string, Vowel> | Vowel[],
  options: QuiescenceOptions = {},
): QuiescenceResult {
  const calmDownTicks = options.calmDownTicks ?? 5000;
  const maxPendingAllowed = options.maxPendingAllowed ?? 0;
  const checkConvergence = options.checkConvergence !== false;
  const vowelList = Array.isArray(vowels) ? vowels : Array.from(vowels.values());

  // 1. Advance virtual clock through fault-free calm-down window
  sim.advanceTo(sim.now + calmDownTicks);

  // Expire any remaining leases at calm-down tick
  const leases = vowelList.filter((v): v is Lease => v.kind === "LEASE");
  for (const lease of leases) {
    lease.expire(sim.now, sim);
  }

  const findings: Finding[] = [];
  const pendingTasks = sim.pending();
  const stuckLeases = leases.filter((l) => l.holders.some((h) => h.expiresAt <= sim.now) || (l.currentLoad >= l.maxCapacity && l.holders.length > 0));
  const channels = vowelList.filter((v): v is Channel => v.kind === "CHANNEL");
  const hungChannels = channels.filter(
    (ch) => ch.currentPhase === "REQUEST_SENT" || ch.currentPhase === "REQUEST_RECEIVED" || ch.currentPhase === "TARGET_MUTATION",
  );

  const quiescent = pendingTasks <= maxPendingAllowed && stuckLeases.length === 0 && hungChannels.length === 0;

  if (!quiescent) {
    const resource = stuckLeases[0]?.id ?? hungChannels[0]?.id ?? "sim-kernel";
    findings.push({
      rule_id: "quiescence-deadlock",
      pillar: "liveness-quiescence",
      status: "proven",
      severity: "critical",
      message: `System failed to reach quiescence after ${calmDownTicks}ms fault-free calm-down: pendingTasks=${pendingTasks}, stuckLeases=${stuckLeases.length}, hungChannels=${hungChannels.length}.`,
      evidence: {
        span_ids: sim.log.slice(-3).map((e) => e.id),
        resource,
        gap_ms: calmDownTicks,
        details: {
          pendingTasks,
          stuckLeaseIds: stuckLeases.map((l) => l.id),
          hungChannelIds: hungChannels.map((c) => c.id),
          finalVirtualTick: sim.now,
        },
      },
      repro: `Advance virtual clock ${calmDownTicks}ms without faults; observe unresolved tasks/leases/channels.`,
      suggested_fix: "Ensure bounded timeouts, zero-hold lease releases, and retry circuit breakers allow all in-flight operations to drain.",
    });
  }

  // 2. Compute canonical state hashes for all cells & check replica convergence
  const cells = vowelList.filter((v): v is Cell => v.kind === "CELL");
  const stateHashes: Record<string, string> = {};
  for (const cell of cells) {
    stateHashes[cell.id] = sha256({ state: cell.state, mutationCount: cell.mutationCount });
  }

  let converged = true;
  if (checkConvergence && options.replicaGroups && options.replicaGroups.length > 0) {
    for (const group of options.replicaGroups) {
      const groupCells = group
        .map((id) => cells.find((c) => c.id === id))
        .filter((c): c is Cell => c !== undefined);
      if (groupCells.length < 2) continue;
      const hashes = new Set(groupCells.map((c) => stateHashes[c.id]!));
      if (hashes.size > 1) {
        converged = false;
        findings.push({
          rule_id: "quiescence-divergence",
          pillar: "liveness-quiescence",
          status: "proven",
          severity: "critical",
          message: `Replica group [${group.join(", ")}] failed to converge after ${calmDownTicks}ms calm-down (${hashes.size} distinct state hashes).`,
          evidence: {
            span_ids: sim.log.slice(-3).map((e) => e.id),
            resource: group[0]!,
            gap_ms: calmDownTicks,
            details: {
              group,
              hashes: Object.fromEntries(groupCells.map((c) => [c.id, stateHashes[c.id]])),
            },
          },
          repro: `Run ${calmDownTicks}ms fault-free calm-down and compare canonical state hashes across [${group.join(", ")}].`,
          suggested_fix: "Add anti-entropy reconciliation or durable outbox replay so replicas converge after partitions heal.",
        });
      }
    }
  }

  return {
    quiescent,
    converged,
    finalVirtualTick: sim.now,
    pendingTasks,
    stateHashes,
    findings,
  };
}
