// enterpriseee/enterprise-simulator/src/physics/alphabet/invariants/rules/stale-read-double-action.ts

import type { SimEvent } from "../../../../kernel.ts";
import type { Finding } from "../finding.ts";
import type { NativeRule } from "../types.ts";
import type { Vowel } from "../../types.ts";

const RULE_ID = "native-stale-read-double-action";

export function evaluateStaleReadDoubleAction(
  events: SimEvent[],
  _vowels?: Map<string, Vowel>,
): Finding[] {
  const findings: Finding[] = [];

  // Look for direct stale_read_double_action events or paired read_without_lock events
  const doubleActionEvents = events.filter((e) => e.kind === "lease.stale_read_double_action");
  for (const event of doubleActionEvents) {
    const data = event.data as Record<string, unknown> | undefined;
    const leaseId = String(data?.leaseId ?? event.corr ?? "");
    const actor1 = String(data?.actor1 ?? "ach-poller");
    const actor2 = String(data?.actor2 ?? "settlement-job");
    const stateKey = String(data?.stateKey ?? "settled_at");

    findings.push({
      rule_id: RULE_ID,
      pillar: "concurrency-isolation",
      status: "proven",
      severity: "critical",
      message: `Two independent actors (${actor1}, ${actor2}) read ${stateKey}=null on lease ${leaseId} without a lock and both performed downstream actions.`,
      evidence: {
        span_ids: [event.id],
        resource: leaseId,
        details: {
          leaseId,
          actors: [actor1, actor2],
          stateKey,
        },
      },
      repro: `Execute concurrent read of uncommitted state ${stateKey} on ${leaseId} by ${actor1} and ${actor2} without acquiring row lock.`,
      suggested_fix: "Acquire an exclusive lock (e.g. SELECT FOR UPDATE or zero_hold_lease) before reading settlement state.",
    });
  }

  // Also evaluate when read_without_lock events occur from multiple actors on the same lease
  if (doubleActionEvents.length === 0) {
    const readsWithoutLock = events.filter((e) => e.kind === "lease.read_without_lock");
    const readsByLease = new Map<string, SimEvent[]>();
    for (const read of readsWithoutLock) {
      const leaseId = String(read.data?.leaseId ?? read.corr ?? "");
      if (!leaseId) continue;
      const list = readsByLease.get(leaseId) ?? [];
      list.push(read);
      readsByLease.set(leaseId, list);
    }

    for (const [leaseId, reads] of readsByLease.entries()) {
      const readers = new Set<string>();
      const readEvents: SimEvent[] = [];
      for (const r of reads) {
        const reader = String(r.data?.readerActorId ?? "");
        const val = r.data?.value;
        if (reader && (val === null || val === undefined)) {
          readers.add(reader);
          readEvents.push(r);
        }
      }

      if (readers.size >= 2) {
        // Check if multiple actors performed downstream actions (channel.send)
        const sends = events.filter((e) => e.kind === "channel.send");
        const sendingActors = new Set(sends.map((s) => String(s.data?.sourceActorId ?? "")).filter(Boolean));
        const overlappingActors = [...readers].filter((actor) => sendingActors.has(actor));

        if (overlappingActors.length >= 2) {
          findings.push({
            rule_id: RULE_ID,
            pillar: "concurrency-isolation",
            status: "proven",
            severity: "critical",
            message: `Two independent actors (${overlappingActors.join(", ")}) read state on lease ${leaseId} without a lock and both performed downstream actions.`,
            evidence: {
              span_ids: readEvents.map((r) => r.id),
              resource: leaseId,
              details: {
                leaseId,
                actors: overlappingActors,
              },
            },
            repro: `Concurrent read of unset state on ${leaseId} by multiple actors without a lock followed by downstream action.`,
            suggested_fix: "Acquire exclusive lease/lock before checking status.",
          });
        }
      }
    }
  }

  return findings;
}

export const staleReadDoubleActionRule: NativeRule = {
  rule_id: RULE_ID,
  evaluate: evaluateStaleReadDoubleAction,
};
