// enterpriseee/enterprise-simulator/src/physics/alphabet/consonants/strip-on-retry.ts

import type { Sim, Rng } from "../../../kernel.ts";
import type { Vowel, ConsonantResult } from "../types.ts";
import { Channel } from "../vowels/channel.ts";
import type { Cell } from "../vowels/cell.ts";

export interface StripOnRetryOpts {
  strippedHeader?: string;
  intermediary?: string;
  newReceiverKey?: string;
  payload?: unknown;
  targetCell?: Cell;
  autoAdvance?: boolean;
}

export function applyStripOnRetry(
  sim: Sim,
  target: Vowel,
  opts: StripOnRetryOpts = {},
  _rng?: Rng,
): ConsonantResult {
  if (!(target instanceof Channel)) {
    throw new Error(`STRIP_ON_RETRY consonant cannot be applied to target kind: ${target.kind}`);
  }

  const strippedHeader = opts.strippedHeader ?? "Idempotency-Key";
  const intermediary = opts.intermediary ?? "envoy-gateway";
  const originalSenderKey = target.senderKey ?? "keel_payment_id";
  const initialReceiverDedupKey = target.receiverDedupKey ?? "carrier_invoice_id_1";
  const newReceiverKey = opts.newReceiverKey ?? "carrier_invoice_id_2";
  const payload = opts.payload ?? { action: "carrier_booking", senderKey: originalSenderKey };

  sim.emit("consonant.strip_on_retry.start", target.id, {
    channelId: target.id,
    intermediary,
    strippedHeader,
    senderKey: originalSenderKey,
  });

  // Attempt 1: Normal send with header intact, but simulates client timeout before response arrives
  const res1 = target.send(sim, payload, opts.targetCell, {
    senderKey: originalSenderKey,
    receiverDedupKey: initialReceiverDedupKey,
    autoAdvance: opts.autoAdvance ?? true,
    severPhase: "POST_COMMIT", // commits at receiver, but caller times out
  });

  // Intermediary strips header on retry
  sim.emit("channel.header_stripped", target.id, {
    channelId: target.id,
    intermediary,
    strippedHeader,
    reason: "gateway_retry_header_removal",
  });

  sim.emit("channel.retry", target.id, {
    channelId: target.id,
    retryAttempt: 1,
    targetActorId: target.targetActorId,
    payload,
    intermediary,
    strippedHeader,
  });

  // Attempt 2 (Retry): If channel idempotency is enforced with matching two-keys, the transport layer preserves the key.
  // Otherwise, sent WITHOUT stripped header -> receiver treats as new request and mints newReceiverKey.
  const transportDedupEnforced = Boolean(target.idempotencyEnabled && target.senderKey && target.receiverDedupKey === target.senderKey);
  const effectiveRetrySenderKey = transportDedupEnforced ? target.senderKey : undefined;
  const effectiveRetryReceiverKey = transportDedupEnforced ? target.receiverDedupKey : newReceiverKey;

  const res2 = target.send(sim, payload, opts.targetCell, {
    retryAttempt: 1,
    senderKey: effectiveRetrySenderKey,
    receiverDedupKey: effectiveRetryReceiverKey,
    autoAdvance: opts.autoAdvance ?? true,
  });

  sim.emit("consonant.strip_on_retry.complete", target.id, {
    channelId: target.id,
    intermediary,
    strippedHeader,
    originalSenderKey,
    newReceiverKey,
    attempt1: res1,
    attempt2: res2,
  });

  return {
    ok: true,
    consonant: "STRIP_ON_RETRY",
    targetId: target.id,
    details: {
      intermediary,
      strippedHeader,
      originalSenderKey,
      newReceiverKey,
      results: [res1, res2],
    },
  };
}
