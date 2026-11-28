import type { Sim, SimEvent } from "../../../kernel.ts";
import type { CompiledAlphabetGraph, Vowel } from "../types.ts";
import type { Cell } from "../vowels/cell.ts";
import type { Channel } from "../vowels/channel.ts";
import type { Lease } from "../vowels/lease.ts";

export type ProtocolTriggerKind =
  | "ON_POST_COMMIT_PRE_ACK"
  | "ON_LEASE_EXPIRE_TRANSITION"
  | "ON_QUEUE_HIGH_WATER";

export interface ProtocolTriggerSpec {
  kind: ProtocolTriggerKind;
  targetVowelId?: string;
  delayMs?: number;
}

/**
 * Derives default TigerBeetle VOPR-style protocol-aware triggers from a graph's vowels.
 */
export function deriveProtocolTriggers(graph: CompiledAlphabetGraph): ProtocolTriggerSpec[] {
  const triggers: ProtocolTriggerSpec[] = [];
  if (graph.channels.length > 0) {
    triggers.push({ kind: "ON_POST_COMMIT_PRE_ACK", targetVowelId: graph.channels[0]!.id });
  }
  const lease = graph.vowels.find((v) => v.kind === "LEASE");
  if (lease) {
    triggers.push({ kind: "ON_LEASE_EXPIRE_TRANSITION", targetVowelId: lease.id });
    triggers.push({ kind: "ON_QUEUE_HIGH_WATER", targetVowelId: lease.id, delayMs: 2500 });
  }
  return triggers;
}

/**
 * Attaches deterministic state-transition hooks to `sim` that fire faults on the exact
 * virtual tick critical protocol transitions occur (e.g., storage commit before ACK,
 * lease expiration boundary, or queue high-water mark).
 */
export function attachProtocolTriggers(
  sim: Sim,
  triggers: ProtocolTriggerSpec[],
  vowels: Map<string, Vowel>,
): void {
  if (triggers.length === 0) return;

  const firedOnce = new Set<string>();
  const cells = Array.from(vowels.values()).filter((v): v is Cell => v.kind === "CELL");
  const channels = Array.from(vowels.values()).filter((v): v is Channel => v.kind === "CHANNEL");
  const leases = Array.from(vowels.values()).filter((v): v is Lease => v.kind === "LEASE");

  sim.registerEmitHook((ev: SimEvent) => {
    for (const trig of triggers) {
      const dedupKey = `${trig.kind}\u0000${trig.targetVowelId ?? "*"}`;
      if (firedOnce.has(dedupKey)) continue;

      if (trig.kind === "ON_POST_COMMIT_PRE_ACK" && ev.kind === "cell.mutate") {
        // Storage mutated before ACK completes: wipe volatile sibling cells or emit pre-ACK sever
        firedOnce.add(dedupKey);
        const targetChannel = trig.targetVowelId
          ? channels.find((c) => c.id === trig.targetVowelId)
          : channels[0];
        const volatileCell = cells.find((c) => c.persistence === "VOLATILE");

        sim.emit("trigger.fired", targetChannel?.id ?? ev.corr, {
          triggerKind: trig.kind,
          sourceEventId: ev.id,
          t: sim.now,
        }, ev.id);

        if (volatileCell) {
          volatileCell.wipeVolatile(sim);
        } else if (targetChannel) {
          sim.emit("channel.sever", targetChannel.id, {
            channelId: targetChannel.id,
            phase: "POST_COMMIT",
            triggeredBy: trig.kind,
          }, ev.id);
        }
      } else if (trig.kind === "ON_LEASE_EXPIRE_TRANSITION" && ev.kind === "lease.epoch_expired") {
        const leaseId = String(ev.data?.leaseId ?? ev.corr);
        if (trig.targetVowelId && trig.targetVowelId !== leaseId) continue;

        firedOnce.add(dedupKey);
        sim.emit("trigger.fired", leaseId, {
          triggerKind: trig.kind,
          sourceEventId: ev.id,
          t: sim.now,
        }, ev.id);

        // Stale holder attempts commit using pre-expiry epoch right on transition tick
        const targetCell = cells[0];
        if (targetCell) {
          const newEpoch = typeof ev.data?.newEpoch === "number" ? ev.data.newEpoch : 1;
          const staleEpoch = Math.max(0, newEpoch - 1);
          targetCell.mutate(
            { action: "stale_lease_transition_write", staleEpoch },
            { epoch: staleEpoch, dedupKey: `trigger-stale-${sim.now}` },
            sim,
          );
        }
      } else if (trig.kind === "ON_QUEUE_HIGH_WATER" && ev.kind === "lease.acquire") {
        const leaseId = String(ev.data?.leaseId ?? ev.corr);
        if (trig.targetVowelId && trig.targetVowelId !== leaseId) continue;
        const lease = leases.find((l) => l.id === leaseId);
        if (!lease) continue;

        if (lease.currentLoad >= Math.max(1, lease.maxCapacity - 1)) {
          firedOnce.add(dedupKey);
          sim.emit("trigger.fired", leaseId, {
            triggerKind: trig.kind,
            sourceEventId: ev.id,
            currentLoad: lease.currentLoad,
            maxCapacity: lease.maxCapacity,
            t: sim.now,
          }, ev.id);
          // Inject saturation burst at high-water boundary
          lease.acquire("high-water-flood", sim.now, sim);
        }
      }
    }
  });
}
