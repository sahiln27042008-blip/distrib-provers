import { createHash } from "node:crypto";
import type { Rng, Sim } from "../../kernel.ts";
import type { Vowel } from "../alphabet/types.ts";
import type { ConsonantFault } from "./search-types.ts";

export interface CorpusEntry {
  stateHash: string;
  faultPrefix: ConsonantFault[];
  depth: number;
  discoveryOrder: number;
}

function canonJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonJson(o[k])}`)
    .join(",")}}`;
}

/**
 * Computes a deterministic canonical SHA-256 hash of all vowel states and pending kernel work.
 */
export function hashWorldState(sim: Sim, vowels: Iterable<Vowel>): string {
  const vowelSnapshots = Array.from(vowels)
    .map((v) => ({ id: v.id, kind: v.kind, snapshot: v.snapshot() }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const canonical = canonJson({
    pending: sim.pending(),
    links: Array.from(sim.links).sort(),
    vowels: vowelSnapshots,
  });

  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Coverage-guided corpus of unique canonical world-state hashes discovered during exploration.
 */
export class StateCorpus {
  readonly #entries = new Map<string, CorpusEntry>();
  readonly #orderedKeys: string[] = [];
  readonly #maxEntries: number;
  #counter = 0;

  constructor(maxEntries = 2000) {
    this.#maxEntries = Math.max(1, maxEntries);
  }

  has(stateHash: string): boolean {
    return this.#entries.has(stateHash);
  }

  add(entry: Omit<CorpusEntry, "discoveryOrder">): boolean {
    if (this.#entries.has(entry.stateHash)) {
      return false;
    }
    if (this.#entries.size >= this.#maxEntries) {
      return false;
    }
    const stored: CorpusEntry = {
      ...entry,
      discoveryOrder: this.#counter++,
    };
    this.#entries.set(entry.stateHash, stored);
    this.#orderedKeys.push(entry.stateHash);
    return true;
  }

  pick(rng: Rng, maxDepth?: number): CorpusEntry | undefined {
    if (this.#orderedKeys.length === 0) return undefined;
    if (maxDepth === undefined) {
      const idx = rng.int(0, this.#orderedKeys.length - 1);
      return this.#entries.get(this.#orderedKeys[idx]!);
    }
    const eligible = this.#orderedKeys
      .map((k) => this.#entries.get(k)!)
      .filter((e) => e.depth < maxDepth);
    if (eligible.length === 0) return undefined;
    const idx = rng.int(0, eligible.length - 1);
    return eligible[idx];
  }

  size(): number {
    return this.#entries.size;
  }

  entries(): CorpusEntry[] {
    return this.#orderedKeys.map((k) => this.#entries.get(k)!);
  }
}
