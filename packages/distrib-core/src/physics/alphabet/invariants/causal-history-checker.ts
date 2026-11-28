import type { SimEvent } from "../../../kernel.ts";
import type { Finding } from "./finding.ts";

export type CausalAnomalyKind =
  | "LOST_UPDATE"
  | "DIRTY_READ"
  | "SPLIT_BRAIN"
  | "STALE_LEASE_COMMIT"
  | "CAUSAL_VIOLATION"
  | "READ_SKEW"
  | "ABORTED_READ"
  | "NON_MONOTONIC_READ";

export type SimLogEntry = SimEvent | (SimEvent & Record<string, unknown>);

export interface CausalHistoryFinding extends Finding {
  kind: CausalAnomalyKind;
  targetVowelId: string;
  targetName: string;
  businessTarget: string;
  params: {
    eventIds: string[];
    violatedRule: CausalAnomalyKind;
    [key: string]: unknown;
  };
  description: string;
}

interface NormalizedOp {
  seq: number;
  id: string;
  t: number;
  invokeTick: number;
  completeTick: number;
  version: number | null;
  kind: string;
  opType: "read" | "write" | "acquire_lease" | "release_lease" | "commit" | "abort" | "other";
  targetVowelId: string;
  targetName: string;
  key: string | null;
  value: unknown;
  actorId: string | null;
  txnId: string | null;
  leaseId: string | null;
  epoch: number | null;
  until: number | null;
  parentId: string | null;
  raw: SimLogEntry;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function canonValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonValue).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonValue(obj[k])}`)
    .join(",")}}`;
}

function classifyOp(entry: SimLogEntry): NormalizedOp["opType"] {
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const explicitOp = asString(data.op ?? (entry as Record<string, unknown>).op)?.toLowerCase();
  const kind = String(entry.kind ?? "").toLowerCase();

  if (explicitOp === "read" || kind === "history.read" || kind === "lease.read_with_lock" || kind === "lease.read_without_lock" || kind === "cell.read") {
    return "read";
  }
  if (explicitOp === "write" || kind === "history.write" || kind === "lease.write_state" || kind === "cell.write") {
    return "write";
  }
  if (explicitOp === "acquire_lease" || kind === "lease.acquire" || kind === "history.acquire_lease") {
    return "acquire_lease";
  }
  if (explicitOp === "release_lease" || kind === "lease.release" || kind === "lease.epoch_expired" || kind === "history.release_lease") {
    return "release_lease";
  }
  if (explicitOp === "commit" || kind === "history.commit" || kind === "txn.commit") {
    return "commit";
  }
  if (explicitOp === "abort" || explicitOp === "rollback" || kind === "history.abort" || kind === "txn.abort" || kind === "txn.rollback") {
    return "abort";
  }
  return "other";
}

function normalizeEntry(entry: SimLogEntry, index: number): NormalizedOp {
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const id = asString(entry.id) ?? `ev-${index + 1}`;
  const t = asNumber(entry.t) ?? 0;
  const kind = String(entry.kind ?? "unknown");
  const opType = classifyOp(entry);

  const targetVowelId =
    asString(data.targetVowelId) ??
    asString(data.cellId) ??
    asString(data.leaseId) ??
    asString(data.channelId) ??
    asString(data.registerId) ??
    asString(entry.corr) ??
    "unknown-target";

  const targetName =
    asString(data.targetName) ??
    asString(data.businessTarget) ??
    targetVowelId;

  let key =
    asString(data.key) ??
    asString(data.stateKey) ??
    null;

  let value =
    data.value !== undefined
      ? data.value
      : data.updates !== undefined
        ? data.updates
        : data.state !== undefined
          ? data.state
          : undefined;

  if (key === null && data.updates && typeof data.updates === "object" && !Array.isArray(data.updates)) {
    const updateKeys = Object.keys(data.updates as Record<string, unknown>);
    if (updateKeys.length === 1) {
      key = updateKeys[0]!;
      value = (data.updates as Record<string, unknown>)[key];
    }
  }

  const actorId =
    asString(data.writerActorId) ??
    asString(data.readerActorId) ??
    asString(data.holderActorId) ??
    asString(data.actorId) ??
    asString((entry as Record<string, unknown>).actorId) ??
    null;

  const txnId =
    asString(data.txnId) ??
    asString(data.transactionId) ??
    asString((entry as Record<string, unknown>).txnId) ??
    null;

  const leaseId =
    asString(data.leaseId) ??
    asString((entry as Record<string, unknown>).leaseId) ??
    null;

  const epoch =
    asNumber(data.epoch) ??
    asNumber(data.incomingEpoch) ??
    asNumber(data.acquiredEpoch) ??
    asNumber(data.newEpoch) ??
    null;

  const explicitUntil = asNumber(data.until) ?? asNumber(data.expiresAt);
  const ttlMs = asNumber(data.ttlMs);
  const until = explicitUntil ?? (ttlMs !== null ? t + ttlMs : null);

  const parentId =
    asString(entry.parent) ??
    asString(data.parent) ??
    asString(data.parentEventId) ??
    null;

  const invokeTick =
    asNumber(data.invokeTick) ??
    asNumber(data.invoke) ??
    asNumber((entry as Record<string, unknown>).invokeTick) ??
    t;
  const completeTick =
    asNumber(data.completeTick) ??
    asNumber(data.complete) ??
    asNumber((entry as Record<string, unknown>).completeTick) ??
    t;
  const version =
    asNumber(data.version) ??
    asNumber(data.mutationCount) ??
    epoch;

  return {
    seq: index,
    id,
    t,
    invokeTick,
    completeTick,
    version,
    kind,
    opType,
    targetVowelId,
    targetName,
    key,
    value,
    actorId,
    txnId,
    leaseId,
    epoch,
    until,
    parentId,
    raw: entry,
  };
}

function makeFinding(params: {
  kind: CausalAnomalyKind;
  targetVowelId: string;
  targetName: string;
  eventIds: string[];
  description: string;
  suggestedFix: string;
  extraParams?: Record<string, unknown>;
  gapMs?: number;
}): CausalHistoryFinding {
  const ruleId = `causal-history-${params.kind.toLowerCase().replace(/_/g, "-")}`;
  return {
    rule_id: ruleId,
    pillar: "causal-history-verifier",
    status: "proven",
    severity: "critical",
    message: params.description,
    evidence: {
      span_ids: params.eventIds,
      resource: params.targetVowelId,
      ...(params.gapMs !== undefined ? { gap_ms: params.gapMs } : {}),
      details: {
        anomalyKind: params.kind,
        targetVowelId: params.targetVowelId,
        targetName: params.targetName,
        ...(params.extraParams ?? {}),
      },
    },
    repro: `Causal history anomaly ${params.kind} on ${params.targetVowelId} involving events [${params.eventIds.join(", ")}]`,
    suggested_fix: params.suggestedFix,
    kind: params.kind,
    targetVowelId: params.targetVowelId,
    targetName: params.targetName,
    businessTarget: params.targetName,
    params: {
      eventIds: params.eventIds,
      violatedRule: params.kind,
      ...(params.extraParams ?? {}),
    },
    description: params.description,
  };
}

/**
 * Elle-style automated Causal History Verifier.
 * Derives concurrency, isolation, lease, and causal ordering anomalies directly from `sim.log`
 * without requiring manual per-test invariants.
 */
export function auditCausalHistory(log: SimLogEntry[]): CausalHistoryFinding[] {
  if (!Array.isArray(log) || log.length === 0) return [];

  const ops = log.map((entry, idx) => normalizeEntry(entry, idx));
  const findings: CausalHistoryFinding[] = [];
  const dedup = new Set<string>();

  const pushUnique = (f: CausalHistoryFinding) => {
    const key = `${f.kind}\u0000${f.targetVowelId}\u0000${[...f.params.eventIds].sort().join(",")}`;
    if (!dedup.has(key)) {
      dedup.add(key);
      findings.push(f);
    }
  };

  // Index events by id for causal parent lookup
  const byId = new Map<string, NormalizedOp>();
  for (const op of ops) {
    byId.set(op.id, op);
  }

  // Track transaction lifecycle (first write, commit tick, abort tick)
  const txnCommits = new Map<string, NormalizedOp>();
  const txnAborts = new Map<string, NormalizedOp>();
  const txnReads = new Map<string, NormalizedOp[]>();
  const txnWrites = new Map<string, NormalizedOp[]>();

  for (const op of ops) {
    if (op.txnId) {
      if (op.opType === "commit") txnCommits.set(op.txnId, op);
      if (op.opType === "abort") txnAborts.set(op.txnId, op);
      if (op.opType === "read") {
        const list = txnReads.get(op.txnId) ?? [];
        list.push(op);
        txnReads.set(op.txnId, list);
      }
      if (op.opType === "write") {
        const list = txnWrites.get(op.txnId) ?? [];
        list.push(op);
        txnWrites.set(op.txnId, list);
      }
    }
  }

  // 1. CAUSAL_VIOLATION: effect observed at an earlier virtual tick than its claimed parent cause
  for (const op of ops) {
    if (!op.parentId) continue;
    const parent = byId.get(op.parentId);
    if (!parent) continue;
    if (parent.t > op.t) {
      pushUnique(
        makeFinding({
          kind: "CAUSAL_VIOLATION",
          targetVowelId: op.targetVowelId,
          targetName: op.targetName,
          eventIds: [parent.id, op.id],
          gapMs: parent.t - op.t,
          description: `Causal ordering violation: event ${op.id} (t=${op.t}ms) claims parent ${parent.id} (t=${parent.t}ms), observing effect before its cause.`,
          suggestedFix: "Enforce Lamport/virtual clock monotonicity and causal dependency barriers before emitting downstream events.",
          extraParams: {
            parentId: parent.id,
            parentTick: parent.t,
            childId: op.id,
            childTick: op.t,
          },
        }),
      );
    }
  }

  // Track lease windows per (leaseId, actorId) and globally per leaseId
  interface LeaseWindow {
    leaseId: string;
    actorId: string | null;
    acquiredAt: number;
    until: number | null;
    epoch: number | null;
    acquireEventId: string;
    releasedAt: number | null;
    targetName: string;
  }

  const leaseWindows: LeaseWindow[] = [];
  const latestLeaseEpoch = new Map<string, number>();

  for (const op of ops) {
    if (op.opType === "acquire_lease") {
      const lid = op.leaseId ?? op.targetVowelId;
      if (op.epoch !== null) {
        const prev = latestLeaseEpoch.get(lid) ?? 0;
        if (op.epoch >= prev) latestLeaseEpoch.set(lid, op.epoch);
      }
      leaseWindows.push({
        leaseId: lid,
        actorId: op.actorId,
        acquiredAt: op.t,
        until: op.until,
        epoch: op.epoch,
        acquireEventId: op.id,
        releasedAt: null,
        targetName: op.targetName,
      });
    } else if (op.opType === "release_lease" || op.kind === "lease.epoch_expired") {
      const lid = op.leaseId ?? op.targetVowelId;
      if (op.epoch !== null) {
        const prev = latestLeaseEpoch.get(lid) ?? 0;
        if (op.epoch >= prev) latestLeaseEpoch.set(lid, op.epoch);
      }
      for (let i = leaseWindows.length - 1; i >= 0; i--) {
        const w = leaseWindows[i]!;
        if (w.leaseId === lid && (op.actorId === null || w.actorId === null || w.actorId === op.actorId) && w.releasedAt === null) {
          w.releasedAt = op.t;
          break;
        }
      }
    }
  }

  // 2. STALE_LEASE_COMMIT: commit executed after holding lease expired (t > until) or with stale epoch
  for (const op of ops) {
    const isCommitOp = op.opType === "commit" || op.kind === "cell.mutate";
    if (!isCommitOp) continue;

    // Match by leaseId, or by actorId if leaseId is omitted on commit
    const candidateWindows = leaseWindows.filter((w) => {
      if (op.leaseId && w.leaseId !== op.leaseId) return false;
      if (!op.leaseId && op.actorId && w.actorId !== op.actorId) return false;
      if (!op.leaseId && !op.actorId) return false;
      return w.acquiredAt <= op.t;
    });

    if (candidateWindows.length === 0) continue;
    const latestWindow = candidateWindows[candidateWindows.length - 1]!;

    const expiredByTick = latestWindow.until !== null && op.t > latestWindow.until;
    const expiredByRelease = latestWindow.releasedAt !== null && op.t > latestWindow.releasedAt;
    const staleEpoch =
      op.epoch !== null &&
      latestLeaseEpoch.has(latestWindow.leaseId) &&
      op.epoch < (latestLeaseEpoch.get(latestWindow.leaseId) ?? 0);

    if (expiredByTick || expiredByRelease || staleEpoch) {
      const expiredAt = latestWindow.until ?? latestWindow.releasedAt ?? op.t;
      pushUnique(
        makeFinding({
          kind: "STALE_LEASE_COMMIT",
          targetVowelId: latestWindow.leaseId,
          targetName: latestWindow.targetName,
          eventIds: [latestWindow.acquireEventId, op.id],
          gapMs: Math.max(0, op.t - expiredAt),
          description: `Stale lease commit: ${op.id} committed at t=${op.t}ms after lease ${latestWindow.leaseId} (acquired in ${latestWindow.acquireEventId} at t=${latestWindow.acquiredAt}ms) expired at t=${expiredAt}ms.`,
          suggestedFix: "Enforce monotonic fencing tokens (fencingTokenEnforced: true) on the target REGISTER and reject commits whose lease epoch is stale.",
          extraParams: {
            leaseId: latestWindow.leaseId,
            acquireEventId: latestWindow.acquireEventId,
            commitEventId: op.id,
            leaseUntil: latestWindow.until,
            commitTick: op.t,
          },
        }),
      );
    }
  }

  // Group reads/writes by (targetVowelId, key) for key-level anomalies
  const writesByTargetKey = new Map<string, NormalizedOp[]>();
  const readsByTargetKey = new Map<string, NormalizedOp[]>();

  for (const op of ops) {
    if (!op.key) continue;
    const mapKey = `${op.targetVowelId}\u0000${op.key}`;
    if (op.opType === "write") {
      const list = writesByTargetKey.get(mapKey) ?? [];
      list.push(op);
      writesByTargetKey.set(mapKey, list);
    } else if (op.opType === "read") {
      const list = readsByTargetKey.get(mapKey) ?? [];
      list.push(op);
      readsByTargetKey.set(mapKey, list);
    }
  }

  // 3. LOST_UPDATE: W1(k, v1) then W2(k, v2) with no intervening R(k) by the second writer
  for (const [mapKey, writes] of writesByTargetKey.entries()) {
    if (writes.length < 2) continue;
    const reads = readsByTargetKey.get(mapKey) ?? [];
    for (let i = 1; i < writes.length; i++) {
      const w1 = writes[i - 1]!;
      const w2 = writes[i]!;
      const writer2 = w2.actorId ?? w2.txnId;
      // Require an identifiable second writer/txn to avoid flagging blind single-actor idempotent logs
      if (!writer2) continue;
      // Check if writer2 performed a read on this key strictly after w1 completed and before w2 invoked
      const hasInterveningRead = reads.some((r) => {
        const reader = r.actorId ?? r.txnId;
        if (reader !== writer2) return false;
        const usesIntervals =
          r.invokeTick !== r.completeTick || w1.invokeTick !== w1.completeTick || w2.invokeTick !== w2.completeTick;
        if (usesIntervals) {
          return r.invokeTick >= w1.completeTick && r.completeTick <= w2.invokeTick;
        }
        const afterW1 = r.t > w1.t || (r.t === w1.t && r.seq > w1.seq);
        const beforeW2 = r.t < w2.t || (r.t === w2.t && r.seq < w2.seq);
        return afterW1 && beforeW2;
      });
      if (!hasInterveningRead) {
        pushUnique(
          makeFinding({
            kind: "LOST_UPDATE",
            targetVowelId: w2.targetVowelId,
            targetName: w2.targetName,
            eventIds: [w1.id, w2.id],
            description: `Lost update on ${w2.targetVowelId} key '${w2.key}': write ${w2.id} by ${writer2} overwrote ${w1.id} without an intervening read of the updated value.`,
            suggestedFix: "Use compare-and-set (CAS), optimistic version checks, or pessimistic lease locking around read-modify-write cycles.",
            extraParams: {
              key: w2.key,
              firstWriteId: w1.id,
              secondWriteId: w2.id,
              writer: writer2,
            },
          }),
        );
      }
    }
  }

  // 4. SPLIT_BRAIN: two different actors write different values to the same key within overlapping lease windows
  for (const [, writes] of writesByTargetKey.entries()) {
    if (writes.length < 2) continue;
    for (let i = 0; i < writes.length; i++) {
      for (let j = i + 1; j < writes.length; j++) {
        const w1 = writes[i]!;
        const w2 = writes[j]!;
        if (!w1.actorId || !w2.actorId || w1.actorId === w2.actorId) continue;
        if (canonValue(w1.value) === canonValue(w2.value)) continue;

        // Check if both writers held overlapping lease windows when writing
        const w1Lease = leaseWindows.find(
          (lw) =>
            lw.actorId === w1.actorId &&
            lw.acquiredAt <= w1.t &&
            (lw.until === null || w1.t <= lw.until) &&
            (lw.releasedAt === null || w1.t <= lw.releasedAt),
        );
        const w2Lease = leaseWindows.find(
          (lw) =>
            lw.actorId === w2.actorId &&
            lw.acquiredAt <= w2.t &&
            (lw.until === null || w2.t <= lw.until) &&
            (lw.releasedAt === null || w2.t <= lw.releasedAt),
        );

        const leasesOverlap =
          w1Lease !== undefined &&
          w2Lease !== undefined &&
          w1Lease.acquiredAt <= (w2Lease.until ?? w2Lease.releasedAt ?? Number.POSITIVE_INFINITY) &&
          w2Lease.acquiredAt <= (w1Lease.until ?? w1Lease.releasedAt ?? Number.POSITIVE_INFINITY);

        if (leasesOverlap) {
          pushUnique(
            makeFinding({
              kind: "SPLIT_BRAIN",
              targetVowelId: w1.targetVowelId,
              targetName: w1.targetName,
              eventIds: [w1.id, w2.id],
              description: `Split-brain write on ${w1.targetVowelId} key '${w1.key}': actors '${w1.actorId}' (${w1.id}) and '${w2.actorId}' (${w2.id}) wrote conflicting values under overlapping lease windows.`,
              suggestedFix: "Enforce single-leader quorum or fencing tokens on the lease/register boundary so concurrent leases cannot both mutate state.",
              extraParams: {
                key: w1.key,
                actorA: w1.actorId,
                actorB: w2.actorId,
                valueA: w1.value,
                valueB: w2.value,
              },
            }),
          );
        }
      }
    }
  }

  // 5. DIRTY_READ & 6. ABORTED_READ: read observes uncommitted or later-aborted write from another txn
  for (const [mapKey, reads] of readsByTargetKey.entries()) {
    const writes = writesByTargetKey.get(mapKey) ?? [];
    for (const r of reads) {
      if (r.value === undefined) continue;
      const rVal = canonValue(r.value);
      // Find the most recent write prior to or at r.t that produced this value
      const matchingWrites = writes.filter(
        (w) => w.t <= r.t && w.txnId !== null && w.txnId !== r.txnId && canonValue(w.value) === rVal,
      );
      if (matchingWrites.length === 0) continue;
      const sourceWrite = matchingWrites[matchingWrites.length - 1]!;
      const writerTxn = sourceWrite.txnId!;

      const commitOp = txnCommits.get(writerTxn);
      const abortOp = txnAborts.get(writerTxn);

      if (abortOp && abortOp.t >= sourceWrite.t) {
        pushUnique(
          makeFinding({
            kind: "ABORTED_READ",
            targetVowelId: r.targetVowelId,
            targetName: r.targetName,
            eventIds: [sourceWrite.id, r.id, abortOp.id],
            description: `Aborted read on ${r.targetVowelId} key '${r.key}': read ${r.id} observed uncommitted value written by txn '${writerTxn}' (${sourceWrite.id}), which later aborted in ${abortOp.id}.`,
            suggestedFix: "Isolate uncommitted transaction buffers (Read Committed or Snapshot Isolation) so un-committed writes are invisible to other transactions.",
            extraParams: {
              key: r.key,
              writerTxn,
              readerTxn: r.txnId,
              writeEventId: sourceWrite.id,
              readEventId: r.id,
              abortEventId: abortOp.id,
            },
          }),
        );
      }

      if (!commitOp || commitOp.t > r.t) {
        pushUnique(
          makeFinding({
            kind: "DIRTY_READ",
            targetVowelId: r.targetVowelId,
            targetName: r.targetName,
            eventIds: commitOp ? [sourceWrite.id, r.id, commitOp.id] : [sourceWrite.id, r.id],
            description: `Dirty read on ${r.targetVowelId} key '${r.key}': read ${r.id} observed value from txn '${writerTxn}' (${sourceWrite.id}) before '${writerTxn}' committed.`,
            suggestedFix: "Enforce Read Committed or Snapshot Isolation on the register so readers only observe committed state.",
            extraParams: {
              key: r.key,
              writerTxn,
              readerTxn: r.txnId,
              writeEventId: sourceWrite.id,
              readEventId: r.id,
            },
          }),
        );
      }
    }
  }

  // 7. READ_SKEW: inside the same txn T1, R(k1) and R(k2) observe inconsistent snapshots from concurrent txns
  for (const [txnId, reads] of txnReads.entries()) {
    if (reads.length < 2) continue;

    // Pair up reads of distinct keys within the same transaction
    for (let i = 0; i < reads.length; i++) {
      for (let j = i + 1; j < reads.length; j++) {
        const r1 = reads[i]!;
        const r2 = reads[j]!;
        if (!r1.key || !r2.key || r1.key === r2.key) continue;

        // Find writes that produced r1's value and r2's value from other txns
        const w1List = (writesByTargetKey.get(`${r1.targetVowelId}\u0000${r1.key}`) ?? []).filter(
          (w) => w.t <= r1.t && w.txnId !== null && w.txnId !== txnId && canonValue(w.value) === canonValue(r1.value),
        );
        const w2List = (writesByTargetKey.get(`${r2.targetVowelId}\u0000${r2.key}`) ?? []).filter(
          (w) => w.t <= r2.t && w.txnId !== null && w.txnId !== txnId && canonValue(w.value) === canonValue(r2.value),
        );

        const w1 = w1List[w1List.length - 1];
        const w2 = w2List[w2List.length - 1];

        // Case A: r1 and r2 came from two different writer txns, and one committed between r1 and r2
        if (w1 && w2 && w1.txnId !== w2.txnId) {
          const c1 = txnCommits.get(w1.txnId!);
          const c2 = txnCommits.get(w2.txnId!);
          const w2CommittedAfterR1 = c2 !== undefined && c2.t > r1.t && c2.t <= r2.t;
          const w1CommittedAfterR2 = c1 !== undefined && c1.t > r2.t && c1.t <= r1.t;
          // Also check if another txn updated r1.key between r1 and r2 while w2 committed
          const w2OverlappedT1 = w2.t >= r1.t && w2.t <= r2.t;
          if (w2CommittedAfterR1 || w1CommittedAfterR2 || w2OverlappedT1) {
            pushUnique(
              makeFinding({
                kind: "READ_SKEW",
                targetVowelId: r1.targetVowelId,
                targetName: r1.targetName,
                eventIds: [r1.id, r2.id, w1.id, w2.id],
                description: `Read skew in txn '${txnId}': read ${r1.id}('${r1.key}') and read ${r2.id}('${r2.key}') observed inconsistent snapshots across concurrent txns '${w1.txnId}' and '${w2.txnId}'.`,
                suggestedFix: "Use Snapshot Isolation (MVCC) or Repeatable Read so all reads in a transaction observe a single consistent snapshot.",
                extraParams: {
                  txnId,
                  key1: r1.key,
                  key2: r2.key,
                  writerTxn1: w1.txnId,
                  writerTxn2: w2.txnId,
                },
              }),
            );
          }
        }

        // Case B: r1 saw pre-T2 state on k1, then T2 wrote/committed both k1 and k2 between r1 and r2, and r2 saw post-T2 state on k2
        if (w2 && (!w1 || w1.txnId !== w2.txnId)) {
          const writerTxn = w2.txnId!;
          const c2 = txnCommits.get(writerTxn);
          const sameTxnWroteK1 = (writesByTargetKey.get(`${r1.targetVowelId}\u0000${r1.key}`) ?? []).some(
            (w) => w.txnId === writerTxn && w.t > r1.t && w.t <= r2.t,
          );
          if (sameTxnWroteK1 && (!c2 || (c2.t > r1.t && c2.t <= r2.t))) {
            pushUnique(
              makeFinding({
                kind: "READ_SKEW",
                targetVowelId: r1.targetVowelId,
                targetName: r1.targetName,
                eventIds: [r1.id, r2.id, w2.id],
                description: `Read skew in txn '${txnId}': read ${r1.id}('${r1.key}') saw pre-commit state while read ${r2.id}('${r2.key}') saw post-commit state from concurrent txn '${writerTxn}'.`,
                suggestedFix: "Use Snapshot Isolation (MVCC) or Repeatable Read so a single transaction cannot straddle a concurrent commit.",
                extraParams: {
                  txnId,
                  key1: r1.key,
                  key2: r2.key,
                  concurrentTxn: writerTxn,
                },
              }),
            );
          }
        }
      }
    }
  }

  // 8. NON_MONOTONIC_READ: an actor observes a lower version/write-order on the same key after a higher one
  for (const [mapKey, reads] of readsByTargetKey.entries()) {
    const writes = writesByTargetKey.get(mapKey) ?? [];
    const versionForValue = new Map<string, number>();
    writes.forEach((w, idx) => {
      const ver = w.version ?? idx + 1;
      versionForValue.set(canonValue(w.value), ver);
    });

    const lastSeenByActor = new Map<string, { version: number; readOp: NormalizedOp }>();
    for (const r of reads) {
      const reader = r.actorId ?? r.txnId;
      if (!reader) continue;
      const observedVersion = r.version ?? (r.value !== undefined ? versionForValue.get(canonValue(r.value)) : undefined);
      if (observedVersion === undefined || observedVersion === null) continue;

      const prev = lastSeenByActor.get(reader);
      if (prev && observedVersion < prev.version) {
        pushUnique(
          makeFinding({
            kind: "NON_MONOTONIC_READ",
            targetVowelId: r.targetVowelId,
            targetName: r.targetName,
            eventIds: [prev.readOp.id, r.id],
            description: `Non-monotonic read by '${reader}' on ${r.targetVowelId} key '${r.key}': read ${r.id} observed stale version ${observedVersion} after ${prev.readOp.id} already observed version ${prev.version}.`,
            suggestedFix: "Enforce session consistency / read-your-writes version vectors or monotonic replica routing.",
            extraParams: {
              key: r.key,
              actor: reader,
              previousVersion: prev.version,
              staleVersion: observedVersion,
            },
          }),
        );
      } else if (!prev || observedVersion > prev.version) {
        lastSeenByActor.set(reader, { version: observedVersion, readOp: r });
      }
    }
  }

  return findings;
}
