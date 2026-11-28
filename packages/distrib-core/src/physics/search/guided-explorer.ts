import { createHash } from "node:crypto";
import { Rng } from "../../kernel.ts";
import type { CompiledAlphabetGraph } from "../alphabet/types.ts";
import { executeFaultSequence } from "./execute-faults.ts";
import { enumerateFaults } from "./fault-search.ts";
import { StateCorpus } from "./state-corpus.ts";
import { shrinkTrace } from "./trace-shrinker.ts";
import { createSwarmProfile, applySwarmProfile, type SwarmProfile } from "./swarm-profile.ts";
import type { ConsonantFault, FaultSearchResult } from "./search-types.ts";

export interface GuidedExploreOptions {
  maxEvaluations?: number;
  maxDepth?: number;
  maxCorpusSize?: number;
  checkQuiescence?: boolean;
  calmDownTicks?: number;
  replicaGroups?: string[][];
  shrinkCounterexample?: boolean;
  useSwarm?: boolean;
  enableBuggify?: boolean;
  buggifyProbability?: number;
  enableProtocolTriggers?: boolean;
}

export interface GuidedExploreResult extends FaultSearchResult {
  uniqueStatesExplored: number;
  fullCounterexample?: ConsonantFault[];
  swarmProfile?: SwarmProfile;
}

export async function exploreStateGuided(
  graph: CompiledAlphabetGraph,
  options: GuidedExploreOptions = {},
  seed = 1,
): Promise<GuidedExploreResult> {
  const startedAt = performance.now();
  const maxEvaluations = Math.max(1, options.maxEvaluations ?? 300);
  const maxDepth = Math.max(1, options.maxDepth ?? 15);
  const maxCorpusSize = Math.max(1, options.maxCorpusSize ?? 2000);
  const checkQuiescence = options.checkQuiescence !== false;
  const calmDownTicks = options.calmDownTicks ?? 5000;
  const shrinkCounterexample = options.shrinkCounterexample !== false;

  const rng = new Rng(seed);
  const corpus = new StateCorpus(maxCorpusSize);
  const rawCandidates = enumerateFaults(graph);
  const swarmProfile = options.useSwarm ? createSwarmProfile(seed) : undefined;
  const candidates = swarmProfile ? applySwarmProfile(rawCandidates, swarmProfile) : rawCandidates;
  const enableBuggify = options.enableBuggify ?? options.useSwarm ?? false;
  const buggifyProbability = options.buggifyProbability ?? swarmProfile?.intensities.buggifyProbability;
  const enableProtocolTriggers = options.enableProtocolTriggers ?? false;

  let evaluations = 0;
  let maxDepthReached = 0;

  const makeFingerprint = (
    status: FaultSearchResult["status"],
    minimalCounterexample: ConsonantFault[] | undefined,
    violatedInvariants: string[],
  ): string =>
    createHash("sha256")
      .update(JSON.stringify({ seed, status, minimalCounterexample, violatedInvariants, evaluations }))
      .digest("hex");

  // 1. Baseline execution at tick 0
  const baseline = await executeFaultSequence(graph, [], seed, {
    checkQuiescence,
    calmDownTicks,
    replicaGroups: options.replicaGroups,
    enableBuggify,
    buggifyProbability,
    enableProtocolTriggers,
  });
  evaluations++;

  if (baseline.violatedInvariants.length > 0) {
    const findingsWithSeed = baseline.findings.map((f) => ({ ...f, seed, minimalSteps: [], shrinkRatio: 1 }));
    return {
      status: "BASELINE_FAILURE",
      violatedInvariants: baseline.violatedInvariants,
      depthReached: 0,
      evaluations,
      durationMs: performance.now() - startedAt,
      deterministicFingerprint: makeFingerprint("BASELINE_FAILURE", undefined, baseline.violatedInvariants),
      allFindings: findingsWithSeed,
      uniqueStatesExplored: 1,
    };
  }

  if (baseline.stateHash) {
    corpus.add({ stateHash: baseline.stateHash, faultPrefix: [], depth: 0 });
  }

  if (candidates.length === 0) {
    return {
      status: "NO_FAILURE_WITHIN_BOUND",
      violatedInvariants: [],
      depthReached: 0,
      evaluations,
      durationMs: performance.now() - startedAt,
      deterministicFingerprint: makeFingerprint("NO_FAILURE_WITHIN_BOUND", undefined, []),
      uniqueStatesExplored: corpus.size(),
    };
  }

  const seenSequences = new Set<string>(["[]"]);

  // 2. Coverage-guided mutation loop: sample unseen state from corpus, append 1 fault, explore deeper
  while (evaluations < maxEvaluations) {
    const parent = corpus.pick(rng, maxDepth);
    if (!parent) break;

    const faultIdx = rng.int(0, candidates.length - 1);
    const nextFault = candidates[faultIdx]!;
    const sequence = [...parent.faultPrefix, nextFault];
    const seqKey = JSON.stringify(sequence);

    // Avoid re-evaluating identical sequences while still counting progress cleanly
    if (seenSequences.has(seqKey)) {
      evaluations++;
      continue;
    }
    seenSequences.add(seqKey);

    if (sequence.length > maxDepthReached) {
      maxDepthReached = sequence.length;
    }

    const execution = await executeFaultSequence(graph, sequence, seed, {
      checkQuiescence,
      calmDownTicks,
      replicaGroups: options.replicaGroups,
      enableBuggify,
      buggifyProbability,
      enableProtocolTriggers,
    });
    evaluations++;

    if (execution.violatedInvariants.length > 0) {
      let minimal = sequence;
      let shrinkRatio = 1;
      const primary = execution.findings.find((f) => f.status === "proven" && f.severity === "critical") ?? execution.findings[0];

      if (shrinkCounterexample && primary && sequence.length > 1) {
        const shrunk = await shrinkTrace(sequence, primary, { graph, seed });
        if (shrunk.finding) {
          minimal = shrunk.minimalSteps;
          shrinkRatio = shrunk.shrinkRatio;
        }
      }

      const enrichedFindings = execution.findings.map((f) => ({
        ...f,
        seed,
        minimalSteps: minimal,
        shrinkRatio,
      }));

      return {
        status: "FAILURE_FOUND",
        minimalCounterexample: minimal,
        fullCounterexample: sequence,
        violatedInvariants: execution.violatedInvariants,
        depthReached: sequence.length,
        evaluations,
        durationMs: performance.now() - startedAt,
        deterministicFingerprint: makeFingerprint("FAILURE_FOUND", minimal, execution.violatedInvariants),
        allFindings: enrichedFindings,
        uniqueStatesExplored: corpus.size(),
        ...(swarmProfile ? { swarmProfile } : {}),
      };
    }

    if (execution.stateHash) {
      corpus.add({
        stateHash: execution.stateHash,
        faultPrefix: sequence,
        depth: sequence.length,
      });
    }
  }

  return {
    status: "NO_FAILURE_WITHIN_BOUND",
    violatedInvariants: [],
    depthReached: maxDepthReached,
    evaluations,
    durationMs: performance.now() - startedAt,
    deterministicFingerprint: makeFingerprint("NO_FAILURE_WITHIN_BOUND", undefined, []),
    uniqueStatesExplored: corpus.size(),
    ...(swarmProfile ? { swarmProfile } : {}),
  };
}
