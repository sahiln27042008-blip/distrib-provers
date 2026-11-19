import type { SimEvent } from "../../../../kernel.ts";
import type { Finding } from "../finding.ts";
import type { NativeRule } from "../types.ts";
import type { Vowel } from "../../types.ts";

const RULE_ID = "native-network-idempotency";

function canon(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canon(record[key])}`).join(",")}}`;
}

function payloadKey(event: SimEvent): string {
  const data = event.data as Record<string, unknown> | undefined;
  if (data?.body_hash) return String(data.body_hash);
  if (data?.payload !== undefined) return canon(data.payload);
  if (data?.body !== undefined) return canon(data.body);
  return "";
}

export function evaluateNetworkIdempotency(events: SimEvent[], _vowels?: Map<string, Vowel>): Finding[] {
  const sendEvents = events.filter((event) => event.kind === "channel.send");
  const retryEvents = events.filter((event) => event.kind === "channel.retry");
  const findings: Finding[] = [];

  const byChannel = new Map<string, SimEvent[]>();
  for (const send of sendEvents) {
    const channelId = String(send.data?.channelId ?? send.corr ?? "");
    if (!channelId) continue;
    const list = byChannel.get(channelId) ?? [];
    list.push(send);
    byChannel.set(channelId, list);
  }

  for (const [channelId, channelSends] of byChannel.entries()) {
    if (channelSends.length < 2) continue;

    for (let i = 1; i < channelSends.length; i++) {
      const retryCandidate = channelSends[i]!;
      const retryAttempt = retryCandidate.data?.retryAttempt;
      if (typeof retryAttempt !== "number" || retryAttempt < 1) continue;

      // Check ackState from previous send, channel vowel, or ack events: if SETTLED, retry is safe
      const chVowel = _vowels?.get(channelId) as any;
      const prevSend = channelSends[i - 1]!;
      const ackState = prevSend?.data?.ackState ?? chVowel?.ackState;
      if (ackState === "SETTLED") {
        continue;
      }
      const settledAck = events.some((e) =>
        e.kind === "channel.ack" &&
        String(e.data?.channelId ?? e.corr ?? "") === channelId &&
        e.data?.ackState === "SETTLED" &&
        e.t <= retryCandidate.t
      );
      if (settledAck) {
        continue;
      }

      // Check two-key model: senderKey vs receiverDedupKey
      const vSenderKey = chVowel?.senderKey;
      const vReceiverDedupKey = chVowel?.receiverDedupKey;
      const sKey = retryCandidate.data?.senderKey ?? vSenderKey;
      const rKey = retryCandidate.data?.receiverDedupKey ?? vReceiverDedupKey;
      const hasExplicitKeys =
        retryCandidate.data?.senderKey !== undefined ||
        retryCandidate.data?.receiverDedupKey !== undefined ||
        vSenderKey !== undefined ||
        vReceiverDedupKey !== undefined;

      if (hasExplicitKeys) {
        // Safe only when both are defined and equal
        if (sKey !== undefined && rKey !== undefined && sKey === rKey && sKey !== "") {
          continue;
        }
      } else {
        // Backward compatibility: if only idempotencyEnabled is provided, treat as senderKey = receiverDedupKey = undefined
        const dedupKey = retryCandidate.data?.dedupKey ?? retryCandidate.data?.idempotencyKey;
        if (dedupKey !== undefined && dedupKey !== null && dedupKey !== "") {
          continue;
        }
      }

      const retryEvent = retryEvents.find((event) => {
        const eventData = event.data as Record<string, unknown> | undefined;
        const eventChannelId = String(eventData?.channelId ?? event.corr ?? "");
        if (eventChannelId !== channelId) return false;
        if (eventData?.retryAttempt !== retryAttempt) return false;
        const eventPayloadKey = payloadKey(event);
        const candidatePayloadKey = payloadKey(retryCandidate);
        if (!eventPayloadKey || !candidatePayloadKey) return false;
        return eventPayloadKey === candidatePayloadKey && event.t <= retryCandidate.t;
      });

      if (!retryEvent) continue;

      const firstSend = channelSends[i - 1]!;
      const firstPayloadKey = payloadKey(firstSend);
      const retryPayloadKey = payloadKey(retryCandidate);
      if (!firstPayloadKey || !retryPayloadKey || firstPayloadKey !== retryPayloadKey) continue;

      const keyMismatch = hasExplicitKeys && sKey !== rKey;
      const message = keyMismatch
        ? `Channel ${channelId} was retried with mismatched keys (senderKey: "${sKey}", receiverDedupKey: "${rKey}"), creating a duplicate side effect risk.`
        : `Channel ${channelId} was retried without an idempotency key, creating a duplicate side effect risk.`;

      findings.push({
        rule_id: RULE_ID,
        pillar: "network-idempotency",
        status: "proven",
        severity: "critical",
        message,
        evidence: {
          span_ids: [firstSend.id, retryEvent.id],
          resource: channelId,
          details: {
            channelId,
            payloadHash: retryPayloadKey,
            retryAttempt: retryEvent.data?.retryAttempt ?? 1,
            senderKey: sKey,
            receiverDedupKey: rKey,
          },
        },
        repro: keyMismatch
          ? `Retry send on channel ${channelId} where senderKey (${sKey}) does not match receiver dedup key (${rKey}).`
          : `Retry the same send on channel ${channelId} without setting a deduplication key for the second attempt.`,
        suggested_fix: "Generate a deterministic idempotency key from the operation identity and persist it with the side effect.",
      });
    }
  }

  return findings;
}

export const networkIdempotencyRule: NativeRule = {
  rule_id: RULE_ID,
  evaluate: evaluateNetworkIdempotency,
};
