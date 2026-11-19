// enterpriseee/enterprise-simulator/src/physics/alphabet/consonants/stale-read-without-lock.ts

import type { Sim, Rng } from "../../../kernel.ts";
import type { Vowel, ConsonantResult } from "../types.ts";
import { Lease } from "../vowels/lease.ts";
import { Channel } from "../vowels/channel.ts";

export interface StaleReadWithoutLockOpts {
  stateKey?: string;
  actors?: string[];
  downstreamAction?: string;
  targetChannel?: Channel;
  targetActorId?: string;
}

export function applyStaleReadWithoutLock(
  sim: Sim,
  target: Vowel,
  opts: StaleReadWithoutLockOpts = {},
  _rng?: Rng,
): ConsonantResult {
  if (!(target instanceof Lease)) {
    throw new Error(`STALE_READ_WITHOUT_LOCK consonant cannot be applied to target kind: ${target.kind}`);
  }

  const stateKey = opts.stateKey ?? "settled_at";
  const actors = opts.actors && opts.actors.length >= 2
    ? opts.actors
    : ["ach-poller", "settlement-job"];
  const downstreamAction = opts.downstreamAction ?? "pay";
  const actor1 = actors[0]!;
  const actor2 = actors[1]!;

  sim.emit("consonant.stale_read_without_lock.start", target.id, {
    leaseId: target.id,
    actors: [actor1, actor2],
    stateKey,
  });

  if ((target as any).acquireLockBeforeRead === true) {
    target.acquire(actor1, sim.now, sim);
    target.readWithLock(actor1, stateKey, sim);
    target.writeState(actor1, { [stateKey]: sim.now }, sim);
    target.release(actor1, sim.now, sim);

    target.acquire(actor2, sim.now, sim);
    const val2 = target.readWithLock(actor2, stateKey, sim);
    target.release(actor2, sim.now, sim);

    sim.emit("consonant.stale_read_without_lock.complete", target.id, {
      leaseId: target.id,
      actors: [actor1, actor2],
      bothObservedUnset: false,
      serialized: true,
    });

    return {
      ok: true,
      consonant: "STALE_READ_WITHOUT_LOCK",
      targetId: target.id,
      details: {
        leaseId: target.id,
        actors: [actor1, actor2],
        stateKey,
        bothObservedUnset: false,
      },
    };
  }

  // Actor 1 reads state without lock
  const val1 = target.readWithoutLock(actor1, stateKey, sim);

  // Actor 2 reads the same state without lock before Actor 1's commit
  const val2 = target.readWithoutLock(actor2, stateKey, sim);

  // Both observed null / empty / unset
  const bothObservedUnset = (val1 === null || val1 === undefined) && (val2 === null || val2 === undefined);

  // Actor 1 proceeds to perform downstream action and commit
  const action1Payload = {
    action: downstreamAction,
    actorId: actor1,
    traceId: `${actor1}_trace_1`,
    amount: 6240,
  };
  if (opts.targetChannel) {
    opts.targetChannel.send(sim, action1Payload);
  } else {
    sim.emit("channel.send", `channel-${actor1}-bank`, {
      channelId: `channel-${actor1}-bank`,
      sourceActorId: actor1,
      targetActorId: opts.targetActorId ?? "ach-bank",
      payload: action1Payload,
      sentAt: sim.now,
    });
  }
  target.writeState(actor1, { [stateKey]: sim.now }, sim);

  // Actor 2 also proceeds to perform downstream action (double action!)
  const action2Payload = {
    action: downstreamAction,
    actorId: actor2,
    traceId: `${actor2}_trace_2`,
    amount: 4680,
  };
  if (opts.targetChannel) {
    opts.targetChannel.send(sim, action2Payload);
  } else {
    sim.emit("channel.send", `channel-${actor2}-bank`, {
      channelId: `channel-${actor2}-bank`,
      sourceActorId: actor2,
      targetActorId: opts.targetActorId ?? "ach-bank",
      payload: action2Payload,
      sentAt: sim.now,
    });
  }
  target.writeState(actor2, { [stateKey]: sim.now }, sim);

  sim.emit("lease.stale_read_double_action", target.id, {
    leaseId: target.id,
    actor1,
    actor2,
    stateKey,
    bothObservedUnset,
    downstreamAction,
  });

  sim.emit("consonant.stale_read_without_lock.complete", target.id, {
    leaseId: target.id,
    actors: [actor1, actor2],
    bothObservedUnset,
  });

  return {
    ok: true,
    consonant: "STALE_READ_WITHOUT_LOCK",
    targetId: target.id,
    details: {
      leaseId: target.id,
      actors: [actor1, actor2],
      stateKey,
      bothObservedUnset,
    },
  };
}
