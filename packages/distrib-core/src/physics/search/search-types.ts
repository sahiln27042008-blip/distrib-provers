// enterpriseee/enterprise-simulator/src/physics/search/search-types.ts

export type ConsonantFault = {
  consonantKind:
    | "DELAY"
    | "SEVER"
    | "DUPLICATE"
    | "SATURATE"
    | "WIPE"
    | "CORRUPT"
    | "STRIP_ON_RETRY"
    | "STALE_READ_WITHOUT_LOCK";
  targetVowelId: string;
  params: Record<string, unknown>;
};

export interface Finding {
  rule_id: string;
  pillar: string;
  status: "proven" | "unknown" | "not_evaluated";
  severity: "critical" | "warning" | "info";
  message: string;
  evidence: {
    span_ids: string[];
    resource?: string;
    hashes?: string[];
    gap_ms?: number;
    details?: Record<string, unknown>;
  };
  repro: string;
  suggested_fix: string;
  minimalSteps?: Array<{
    consonantKind: string;
    targetVowelId: string;
    params: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  shrinkRatio?: number;
  seed?: number;
}

export interface SearchNode {
  faultSequence: ConsonantFault[];
  depth: number;
}

export interface FaultSearchOptions {
  maxDepth?: number;        // default 3
  maxEvaluations?: number;  // default 5000
  timeoutMs?: number;       // default 2000 — advisory only, do not make correctness depend on wall-clock
  targetPath?: string[];    // Target node IDs to reach in counterexample
  mode?: "iddfs" | "guided";
  checkQuiescence?: boolean;
  calmDownTicks?: number;
  replicaGroups?: string[][];
  useSwarm?: boolean;
  enableBuggify?: boolean;
  buggifyProbability?: number;
  enableProtocolTriggers?: boolean;
}

export type FaultSearchStatus =
  | "BASELINE_FAILURE"
  | "FAILURE_FOUND"
  | "NO_FAILURE_WITHIN_BOUND"
  | "BUDGET_EXHAUSTED"
  | "TARGET_PATH_NOT_REACHED";

export interface FaultSearchResult {
  status: FaultSearchStatus;
  minimalCounterexample?: ConsonantFault[];
  violatedInvariants: string[];
  depthReached: number;
  evaluations: number;
  durationMs: number;
  deterministicFingerprint?: string;
  allFindings?: Finding[];
  targetPathNotice?: string;
  uniqueStatesExplored?: number;
  swarmProfile?: {
    seed: number;
    enabledAxes: string[];
    disabledAxes: string[];
    intensities: Record<string, number>;
  };
}

export interface CliffSearchOptions {
  low: number;
  high: number;
  tolerance: number;
  maxIterations?: number;  // default 30
}

export type CollapseCliffStatus =
  | "CLIFF_FOUND"
  | "NO_CLIFF_IN_RANGE"
  | "NON_MONOTONIC"
  | "BUDGET_EXHAUSTED";

export interface CollapseCliffResult {
  status: CollapseCliffStatus;
  parameter: string;
  testedRange: { low: number; high: number };
  lowerSafeBound?: number;
  upperFailureBound?: number;
  estimatedThreshold?: number;
  tolerance: number;
  iterations: number;
  evaluations: number;
}

export interface WorkflowReliabilityResult {
  faultSearch: FaultSearchResult;
  cliffs: CollapseCliffResult[];
}

