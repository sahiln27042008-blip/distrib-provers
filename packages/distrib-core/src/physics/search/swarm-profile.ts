import { Rng } from "../../kernel.ts";
import type { ConsonantFault } from "./search-types.ts";

export type FaultAxis =
  | "DELAY"
  | "SEVER"
  | "DUPLICATE"
  | "SATURATE"
  | "WIPE"
  | "CORRUPT";

const ALL_FAULT_AXES: readonly FaultAxis[] = [
  "DELAY",
  "SEVER",
  "DUPLICATE",
  "SATURATE",
  "WIPE",
  "CORRUPT",
] as const;

export interface SwarmProfile {
  seed: number;
  enabledAxes: FaultAxis[];
  disabledAxes: FaultAxis[];
  intensities: {
    delayMultiplier: number;
    duplicateBurstCount: number;
    saturateLoadMultiplier: number;
    buggifyProbability: number;
  };
}

/**
 * Generates a deterministic Swarm Testing profile (Groce et al., ISSTA 2012):
 * randomly disables half of the fault axes for a given seed while cranking
 * the active axes to extreme values so background noise doesn't mask deep bugs.
 */
export function createSwarmProfile(seed: number): SwarmProfile {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const shuffled = [...ALL_FAULT_AXES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }

  const splitIndex = Math.ceil(shuffled.length / 2);
  const enabledAxes = shuffled.slice(0, splitIndex);
  const disabledAxes = shuffled.slice(splitIndex);

  return {
    seed,
    enabledAxes,
    disabledAxes,
    intensities: {
      delayMultiplier: rng.int(2, 5),
      duplicateBurstCount: rng.int(3, 6),
      saturateLoadMultiplier: rng.int(2, 4),
      buggifyProbability: Number((0.15 + rng.next() * 0.2).toFixed(2)),
    },
  };
}

/**
 * Filters candidate faults to the active Swarm axes and scales intensities.
 * Falls back to unfiltered candidates if a graph has zero candidates in the enabled axes.
 */
export function applySwarmProfile(
  candidates: ConsonantFault[],
  profile: SwarmProfile,
): ConsonantFault[] {
  const enabled = new Set<string>(profile.enabledAxes);
  const filtered = candidates.filter((c) => {
    // Keep specialized protocol consonants (STRIP_ON_RETRY, STALE_READ_WITHOUT_LOCK) active
    if (!ALL_FAULT_AXES.includes(c.consonantKind as FaultAxis)) return true;
    return enabled.has(c.consonantKind);
  });

  const base = filtered.length > 0 ? filtered : candidates;
  return base.map((c) => {
    const params = { ...c.params };
    if (c.consonantKind === "DELAY" && typeof params.durationMs === "number") {
      params.durationMs = Math.max(1, Math.round(params.durationMs * profile.intensities.delayMultiplier));
    } else if (c.consonantKind === "DUPLICATE") {
      params.count = Math.max(Number(params.count) || 2, profile.intensities.duplicateBurstCount);
    } else if (c.consonantKind === "SATURATE" && typeof params.loadUnits === "number") {
      params.loadUnits = Math.max(1, Math.round(params.loadUnits * profile.intensities.saturateLoadMultiplier));
    }
    return {
      ...c,
      params,
    };
  });
}
