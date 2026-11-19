import { createHash } from "node:crypto";
import type { CompiledAlphabetGraph, Consonant } from "../alphabet/types.ts";
import type {
  ConsonantFault,
  FaultSearchOptions,
  FaultSearchResult,
} from "./search-types.ts";
import { executeFaultSequence } from "./execute-faults.ts";

const DEFAULT_SEED = 1;
const MAX_SEARCH_DEPTH = 64;

function faultFromCandidate(candidate: {
  consonant: Consonant;
  targetId: string;
}): ConsonantFault {
  const { kind, ...params } = candidate.consonant;
  return {
    consonantKind: kind,
    targetVowelId: candidate.targetId,
    params: params as Record<string, unknown>,
  };
}

export function enumerateFaults(graph: CompiledAlphabetGraph): ConsonantFault[] {
  const explicitCandidates = graph.candidatePerturbations.map(faultFromCandidate);
  const defaultCandidates: ConsonantFault[] = [];

  for (const vowel of graph.vowels) {
    switch (vowel.kind) {
      case "CHANNEL":
        defaultCandidates.push(
          { consonantKind: "DELAY", targetVowelId: vowel.id, params: { durationMs: 1 } },
          { consonantKind: "SEVER", targetVowelId: vowel.id, params: { phase: "PRE_COMMIT" } },
          { consonantKind: "SEVER", targetVowelId: vowel.id, params: { phase: "POST_COMMIT" } },
          { consonantKind: "DUPLICATE", targetVowelId: vowel.id, params: { count: 2 } },
          { consonantKind: "CORRUPT", targetVowelId: vowel.id, params: { mode: "SCHEMA_DRIFT" } },
        );
        break;
      case "LEASE": {
        const capacity = "maxCapacity" in vowel && typeof vowel.maxCapacity === "number"
          ? vowel.maxCapacity
          : 1;
        defaultCandidates.push({
          consonantKind: "SATURATE",
          targetVowelId: vowel.id,
          params: { loadUnits: capacity },
        });
        break;
      }
      case "LOG":
        defaultCandidates.push(
          { consonantKind: "DELAY", targetVowelId: vowel.id, params: { durationMs: 1 } },
          { consonantKind: "CORRUPT", targetVowelId: vowel.id, params: { mode: "LOSSY_DROP" } },
        );
        break;
      case "CELL":
        if ("persistence" in vowel && vowel.persistence === "VOLATILE") {
          defaultCandidates.push({
            consonantKind: "WIPE",
            targetVowelId: vowel.id,
            params: { scope: "VOLATILE_CELLS", cellIds: [vowel.id] },
          });
        }
        break;
    }
  }

  const seen = new Map<string, { fault: ConsonantFault; priority: number }>();
  for (const [priority, candidates] of [[0, explicitCandidates], [1, defaultCandidates]] as const) {
    for (const fault of candidates) {
      const key = faultSortKey(fault);
      if (!seen.has(key)) seen.set(key, { fault, priority });
    }
  }

  return [...seen.values()]
    .sort((left, right) => left.priority - right.priority || faultSortKey(left.fault).localeCompare(faultSortKey(right.fault)))
    .map(({ fault }) => fault);
}

function faultSortKey(fault: ConsonantFault): string {
  return `${fault.consonantKind}\u0000${fault.targetVowelId}\u0000${JSON.stringify(fault.params)}`;
}

function graphFingerprintInput(graph: CompiledAlphabetGraph): string {
  return JSON.stringify({
    actors: graph.actors.map(({ id, kind }) => ({ id, kind })),
    vowels: graph.vowels.map((vowel) => ({ id: vowel.id, kind: vowel.kind, state: vowel.snapshot() })),
    channels: graph.channels.map((channel) => channel.id),
    candidates: graph.candidatePerturbations,
  });
}

function fingerprint(
  graph: CompiledAlphabetGraph,
  seed: number,
  result: Pick<FaultSearchResult, "status" | "minimalCounterexample" | "violatedInvariants" | "evaluations">,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ graph: graphFingerprintInput(graph), seed, ...result }))
    .digest("hex");
}

function getNodesInSequenceAndExecution(
  sequence: ConsonantFault[],
  graph: CompiledAlphabetGraph,
  execution: { events: Array<{ kind: string; id: string; corr?: string; actorId?: string; data?: Record<string, unknown> }>; findings: Array<any> },
): Set<string> {
  const nodes = new Set<string>();
  const vowelById = new Map(graph.vowels.map((v) => [v.id, v]));

  // 1. Nodes in the fault sequence
  for (const fault of sequence) {
    nodes.add(fault.targetVowelId);
    const v = vowelById.get(fault.targetVowelId);
    if (v) {
      nodes.add(v.actorId);
      if (v.kind === "CHANNEL") {
        const ch = v as any;
        if (ch.sourceActorId) nodes.add(ch.sourceActorId);
        if (ch.targetActorId) nodes.add(ch.targetActorId);
        if (ch.intermediary) nodes.add(ch.intermediary);
      }
    }
    for (const val of Object.values(fault.params)) {
      if (typeof val === "string") nodes.add(val);
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === "string") nodes.add(item);
        }
      }
    }
  }

  // 2. Nodes in the proven failure findings and their causal spans (not background noise)
  const failureSpanIds = new Set<string>();
  for (const finding of execution.findings) {
    if (finding.status !== "proven") continue;
    if (finding.evidence.resource) nodes.add(finding.evidence.resource);
    for (const id of finding.evidence.span_ids) {
      failureSpanIds.add(id);
    }
    const details = finding.evidence.details;
    if (details) {
      for (const [k, v] of Object.entries(details)) {
        if (typeof v === "string") nodes.add(v);
        if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === "string") nodes.add(item);
          }
        }
      }
    }
  }

  // 3. Events directly referenced by failure evidence
  for (const event of execution.events) {
    if (!failureSpanIds.has(event.id)) continue;
    if (event.actorId) nodes.add(String(event.actorId));
    if (event.corr) nodes.add(String(event.corr));
    const data = event.data;
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "string") nodes.add(v);
        if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === "string") nodes.add(item);
          }
        }
      }
    }
  }

  return nodes;
}

function counterexampleMatchesTargetPath(
  sequence: ConsonantFault[],
  graph: CompiledAlphabetGraph,
  execution: { events: Array<{ kind: string; id: string; corr?: string; actorId?: string; data?: Record<string, unknown> }>; findings: Array<any> },
  targetPath: string[],
): boolean {
  if (targetPath.length === 0) return true;
  const nodes = getNodesInSequenceAndExecution(sequence, graph, execution);
  return targetPath.every((target) => {
    if (nodes.has(target)) return true;
    for (const n of nodes) {
      if (n.includes(target) || target.includes(n)) return true;
    }
    return false;
  });
}

export async function searchFaults(
  graph: CompiledAlphabetGraph,
  options: FaultSearchOptions = {},
  seed = DEFAULT_SEED,
): Promise<FaultSearchResult> {
  const startedAt = performance.now();
  const requestedMaxDepth = options.maxDepth ?? 3;
  const requestedMaxEvaluations = options.maxEvaluations ?? 5000;
  if (!Number.isFinite(requestedMaxDepth)) {
    throw new RangeError("maxDepth must be finite");
  }
  if (!Number.isFinite(requestedMaxEvaluations)) {
    throw new RangeError("maxEvaluations must be finite");
  }
  const maxDepth = Math.max(0, Math.floor(requestedMaxDepth));
  if (maxDepth > MAX_SEARCH_DEPTH) {
    throw new RangeError(`maxDepth cannot exceed ${MAX_SEARCH_DEPTH}`);
  }
  const maxEvaluations = Math.max(1, Math.floor(requestedMaxEvaluations));
  const targetPath = options.targetPath;
  const isTargetPathSearch = Array.isArray(targetPath) && targetPath.length > 0;
  const candidates = enumerateFaults(graph);
  let evaluations = 0;

  const makeResult = (
    status: FaultSearchResult["status"],
    depthReached: number,
    violatedInvariants: string[],
    minimalCounterexample?: ConsonantFault[],
    extra?: { allFindings?: any[]; targetPathNotice?: string },
  ): FaultSearchResult => {
    const resultBase = {
      status,
      ...(minimalCounterexample ? { minimalCounterexample } : {}),
      violatedInvariants,
      depthReached,
      evaluations,
      ...(extra?.allFindings ? { allFindings: extra.allFindings } : {}),
      ...(extra?.targetPathNotice ? { targetPathNotice: extra.targetPathNotice } : {}),
    };
    return {
      ...resultBase,
      durationMs: performance.now() - startedAt,
      deterministicFingerprint: fingerprint(graph, seed, resultBase),
    };
  };

  const baseline = await executeFaultSequence(graph, [], seed);
  evaluations++;
  if (baseline.violatedInvariants.length > 0) {
    return makeResult("BASELINE_FAILURE", 0, baseline.violatedInvariants);
  }

  if (maxEvaluations <= evaluations) {
    return makeResult("BUDGET_EXHAUSTED", 0, []);
  }

  interface DiscoveredFailure {
    sequence: ConsonantFault[];
    depth: number;
    violatedInvariants: string[];
    execution: any;
    matchesTarget: boolean;
  }
  const discoveredFailures: DiscoveredFailure[] = [];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const visited = new Set<string>();
    let budgetExhausted = false;

    const visit = async (
      sequence: ConsonantFault[],
    ): Promise<FaultSearchResult | undefined> => {
      if (sequence.length === depth) {
        const sequenceKey = JSON.stringify(sequence);
        if (visited.has(sequenceKey)) return undefined;
        visited.add(sequenceKey);

        if (evaluations >= maxEvaluations) {
          budgetExhausted = true;
          return undefined;
        }

        const execution = await executeFaultSequence(graph, sequence, seed);
        evaluations++;
        if (execution.violatedInvariants.length > 0) {
          if (!isTargetPathSearch) {
            return makeResult(
              "FAILURE_FOUND",
              depth,
              execution.violatedInvariants,
              sequence,
            );
          }

          const matchesTarget = counterexampleMatchesTargetPath(
            sequence,
            graph,
            execution,
            targetPath!,
          );
          discoveredFailures.push({
            sequence,
            depth,
            violatedInvariants: execution.violatedInvariants,
            execution,
            matchesTarget,
          });

          if (matchesTarget) {
            // Found target path failure! Return shortest matching counterexample
            return makeResult(
              "FAILURE_FOUND",
              depth,
              execution.violatedInvariants,
              sequence,
              { allFindings: discoveredFailures.flatMap((f) => f.execution.findings) },
            );
          }
          // Continue searching until target path is reached or budget exhausted
          return undefined;
        }
        return undefined;
      }

      for (const candidate of candidates) {
        if (budgetExhausted) break;
        const result = await visit([...sequence, candidate]);
        if (result) return result;
      }
      return undefined;
    };

    const result = await visit([]);
    if (result) return result;
    if (budgetExhausted) {
      if (isTargetPathSearch) {
        const matching = discoveredFailures.find((f) => f.matchesTarget);
        if (matching) {
          return makeResult(
            "FAILURE_FOUND",
            matching.depth,
            matching.violatedInvariants,
            matching.sequence,
            { allFindings: discoveredFailures.flatMap((f) => f.execution.findings) },
          );
        }
        if (discoveredFailures.length > 0) {
          const shortest = discoveredFailures[0]!;
          return makeResult(
            "TARGET_PATH_NOT_REACHED",
            depth,
            shortest.violatedInvariants,
            shortest.sequence,
            {
              allFindings: discoveredFailures.flatMap((f) => f.execution.findings),
              targetPathNotice: `Target path [${targetPath!.join(", ")}] not reached within search budget (${evaluations} evaluations). Discovered ${discoveredFailures.length} other failures.`,
            },
          );
        }
      }
      return makeResult("BUDGET_EXHAUSTED", depth, []);
    }
  }

  if (isTargetPathSearch) {
    const matching = discoveredFailures.find((f) => f.matchesTarget);
    if (matching) {
      return makeResult(
        "FAILURE_FOUND",
        matching.depth,
        matching.violatedInvariants,
        matching.sequence,
        { allFindings: discoveredFailures.flatMap((f) => f.execution.findings) },
      );
    }
    if (discoveredFailures.length > 0) {
      const shortest = discoveredFailures[0]!;
      return makeResult(
        "TARGET_PATH_NOT_REACHED",
        maxDepth,
        shortest.violatedInvariants,
        shortest.sequence,
        {
          allFindings: discoveredFailures.flatMap((f) => f.execution.findings),
          targetPathNotice: `Target path [${targetPath!.join(", ")}] not reached within search bound (depth ${maxDepth}, ${evaluations} evaluations). Discovered ${discoveredFailures.length} other failures.`,
        },
      );
    }
  }

  return makeResult("NO_FAILURE_WITHIN_BOUND", maxDepth, []);
}