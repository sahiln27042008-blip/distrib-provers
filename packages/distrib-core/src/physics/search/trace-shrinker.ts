import type { CompiledAlphabetGraph } from "../alphabet/types.ts";
import type { Finding } from "../alphabet/invariants/finding.ts";
import type { ConsonantFault } from "./search-types.ts";
import { executeFaultSequence } from "./execute-faults.ts";

export type FaultStep = ConsonantFault & {
  tick?: number;
  nodeId?: string;
  action?: string;
  key?: string;
  value?: string | number;
  actorId?: string;
  txnId?: string;
  leaseId?: string;
  [key: string]: unknown;
};

export interface TraceShrinkResult {
  originalStepCount: number;
  minimalStepCount: number;
  minimalSteps: FaultStep[];
  finding: Finding | null;
  shrinkRatio: number;
  iterations: number;
}

export interface ShrinkTraceOptions {
  graph?: CompiledAlphabetGraph;
  seed?: number;
  evaluate?: (steps: FaultStep[]) => Finding[] | Promise<Finding[]>;
}

function getFindingKind(f: Finding): string {
  const anyF = f as unknown as Record<string, unknown>;
  if (typeof anyF.kind === "string" && anyF.kind.length > 0) return anyF.kind;
  return f.rule_id;
}

function getFindingTargetVowelId(f: Finding): string {
  const anyF = f as unknown as Record<string, unknown>;
  if (typeof anyF.targetVowelId === "string" && anyF.targetVowelId.length > 0) return anyF.targetVowelId;
  return f.evidence?.resource ?? "";
}

function getFindingBusinessTarget(f: Finding): string {
  const anyF = f as unknown as Record<string, unknown>;
  if (typeof anyF.businessTarget === "string" && anyF.businessTarget.length > 0) return anyF.businessTarget;
  if (typeof anyF.targetName === "string" && anyF.targetName.length > 0) return anyF.targetName;
  return "";
}

export function findingsMatch(candidate: Finding, target: Finding): boolean {
  if (getFindingKind(candidate) !== getFindingKind(target)) return false;
  const targetVowel = getFindingTargetVowelId(target);
  const candVowel = getFindingTargetVowelId(candidate);
  if (targetVowel && candVowel && targetVowel !== candVowel) return false;
  const targetBiz = getFindingBusinessTarget(target);
  const candBiz = getFindingBusinessTarget(candidate);
  if (targetBiz && candBiz && targetBiz !== candBiz) return false;
  return true;
}

/**
 * Delta Debugging (ddmin, Zeller 1999) trace shrinker.
 * Repeatedly partitions/halves the fault schedule while preserving relative step order
 * to find a 1-minimal subset of FaultSteps that reproduces the exact same Finding.
 */
export async function shrinkTrace(
  schedule: FaultStep[],
  targetFinding: Finding | null,
  options: ShrinkTraceOptions = {},
): Promise<TraceShrinkResult> {
  const originalStepCount = Array.isArray(schedule) ? schedule.length : 0;

  if (originalStepCount === 0 || !targetFinding) {
    return {
      originalStepCount,
      minimalStepCount: originalStepCount,
      minimalSteps: originalStepCount > 0 ? [...schedule] : [],
      finding: null,
      shrinkRatio: 1,
      iterations: 0,
    };
  }

  const runCandidate = async (steps: FaultStep[]): Promise<Finding | null> => {
    let findings: Finding[];
    if (options.evaluate) {
      findings = await options.evaluate(steps);
    } else if (options.graph) {
      const exec = await executeFaultSequence(options.graph, steps, options.seed ?? 42817);
      findings = exec.findings;
    } else {
      throw new Error("shrinkTrace requires either options.evaluate or options.graph");
    }
    return findings.find((f) => findingsMatch(f, targetFinding)) ?? null;
  };

  let iterations = 0;
  let current: FaultStep[] = [...schedule];

  // Verify the initial full schedule actually triggers the target finding
  iterations++;
  let confirmedFinding = await runCandidate(current);
  if (!confirmedFinding) {
    return {
      originalStepCount,
      minimalStepCount: originalStepCount,
      minimalSteps: current,
      finding: null,
      shrinkRatio: 1,
      iterations,
    };
  }

  if (current.length === 1) {
    return {
      originalStepCount,
      minimalStepCount: 1,
      minimalSteps: current,
      finding: confirmedFinding,
      shrinkRatio: 1,
      iterations,
    };
  }

  let granularity = 2;

  while (current.length >= 2) {
    const chunkSize = Math.ceil(current.length / granularity);
    let reduced = false;

    // 1. Test each chunk (subset) — O(log n) halving when bug is localized
    for (let i = 0; i < granularity; i++) {
      const start = i * chunkSize;
      if (start >= current.length) break;
      const end = Math.min(start + chunkSize, current.length);
      const subset = current.slice(start, end);
      if (subset.length === 0 || subset.length === current.length) continue;

      iterations++;
      const hit = await runCandidate(subset);
      if (hit) {
        current = subset;
        confirmedFinding = hit;
        granularity = 2;
        reduced = true;
        break;
      }
    }
    if (reduced) continue;

    // 2. Test each complement (current \ chunk_i) while preserving relative order
    if (granularity > 2) {
      for (let i = 0; i < granularity; i++) {
        const start = i * chunkSize;
        if (start >= current.length) break;
        const end = Math.min(start + chunkSize, current.length);
        const complement = [...current.slice(0, start), ...current.slice(end)];
        if (complement.length === 0 || complement.length === current.length) continue;

        iterations++;
        const hit = await runCandidate(complement);
        if (hit) {
          current = complement;
          confirmedFinding = hit;
          granularity = Math.max(granularity - 1, 2);
          reduced = true;
          break;
        }
      }
      if (reduced) continue;
    } else if (current.length === 2) {
      // At granularity 2 and length 2, subsets already tested both singletons [0] and [1],
      // so both elements are required -> 1-minimal reached.
      break;
    }

    if (granularity >= current.length) {
      break;
    }
    granularity = Math.min(current.length, granularity * 2);
  }

  const minimalStepCount = current.length;
  const shrinkRatio = minimalStepCount > 0
    ? Number((originalStepCount / minimalStepCount).toFixed(2))
    : originalStepCount;

  return {
    originalStepCount,
    minimalStepCount,
    minimalSteps: current,
    finding: confirmedFinding,
    shrinkRatio,
    iterations,
  };
}
