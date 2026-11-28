import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shrinkTrace, type FaultStep } from "./trace-shrinker.ts";
import { auditCausalHistory, type SimLogEntry } from "../alphabet/invariants/causal-history-checker.ts";
import { searchFaults } from "./fault-search.ts";
import { executeFaultSequence } from "./execute-faults.ts";
import { SCENARIO_DEFINITIONS } from "../distrib/distrib-scenarios.ts";
import type { Finding } from "../alphabet/invariants/finding.ts";

function makeNoiseStep(index: number): FaultStep {
  return {
    consonantKind: "DELAY",
    targetVowelId: `noise-channel-${index}`,
    params: { durationMs: 1 },
    tick: index * 10,
    nodeId: `noise-node-${index % 4}`,
    action: "read",
    key: `noise_key_${index}`,
    value: index,
    actorId: `noise-actor-${index % 3}`,
    txnId: `noise-txn-${index}`,
  };
}

function stepsToCausalLog(steps: FaultStep[]): SimLogEntry[] {
  return steps.map((s, idx) => ({
    id: `e${idx + 1}`,
    t: typeof s.tick === "number" ? s.tick : (idx + 1) * 10,
    kind: s.action === "acquire_lease"
      ? "lease.acquire"
      : s.action === "commit"
        ? "history.commit"
        : s.action === "read"
          ? "history.read"
          : "history.write",
    corr: s.targetVowelId,
    data: {
      op: s.action ?? "write",
      targetVowelId: s.targetVowelId,
      targetName: (s.targetName as string | undefined) ?? s.targetVowelId,
      key: s.key,
      value: s.value,
      actorId: s.actorId,
      txnId: s.txnId,
      leaseId: s.leaseId,
      until: s.until,
      epoch: s.epoch,
    },
  }));
}

describe("Trace Shrinker (Delta Debugging ddmin)", () => {
  it("1. shrinks a 100-step schedule triggering LOST_UPDATE to <= 5 steps in < 5s", async () => {
    const schedule: FaultStep[] = [];
    for (let i = 0; i < 100; i++) {
      if (i === 17) {
        schedule.push({
          consonantKind: "DUPLICATE",
          targetVowelId: "reg-ledger",
          params: {},
          tick: 170,
          nodeId: "worker-A",
          action: "write",
          key: "balance",
          value: 100,
          actorId: "worker-A",
          txnId: "T1",
        });
      } else if (i === 73) {
        schedule.push({
          consonantKind: "DUPLICATE",
          targetVowelId: "reg-ledger",
          params: {},
          tick: 730,
          nodeId: "worker-B",
          action: "write",
          key: "balance",
          value: 200,
          actorId: "worker-B",
          txnId: "T2",
        });
      } else {
        schedule.push(makeNoiseStep(i));
      }
    }

    const initialFindings = auditCausalHistory(stepsToCausalLog(schedule));
    const targetFinding = initialFindings.find((f) => f.kind === "LOST_UPDATE");
    assert.ok(targetFinding, "Initial 100-step schedule must trigger LOST_UPDATE");

    const t0 = performance.now();
    const res = await shrinkTrace(schedule, targetFinding, {
      evaluate: (steps) => auditCausalHistory(stepsToCausalLog(steps)),
    });
    const elapsedMs = performance.now() - t0;

    assert.equal(res.originalStepCount, 100);
    assert.ok(res.minimalStepCount <= 5, `Expected <= 5 steps, got ${res.minimalStepCount}`);
    assert.equal(res.minimalStepCount, 2);
    assert.ok(res.shrinkRatio >= 20);
    assert.ok(res.finding !== null);
    assert.ok(elapsedMs < 5000, `Expected < 5000ms, took ${elapsedMs}ms`);
    // Relative order preserved: worker-A (tick 170) before worker-B (tick 730)
    assert.equal(res.minimalSteps[0]!.actorId, "worker-A");
    assert.equal(res.minimalSteps[1]!.actorId, "worker-B");
  });

  it("2. shrinks a 100-step schedule triggering SPLIT_BRAIN to <= 6 steps", async () => {
    const schedule: FaultStep[] = [];
    for (let i = 0; i < 100; i++) {
      if (i === 12) {
        schedule.push({
          consonantKind: "SATURATE",
          targetVowelId: "lease-primary",
          params: {},
          tick: 120,
          action: "acquire_lease",
          leaseId: "lease-primary",
          actorId: "node-A",
          until: 900,
          epoch: 1,
        });
      } else if (i === 18) {
        schedule.push({
          consonantKind: "SATURATE",
          targetVowelId: "lease-primary",
          params: {},
          tick: 180,
          action: "acquire_lease",
          leaseId: "lease-primary",
          actorId: "node-B",
          until: 950,
          epoch: 1,
        });
      } else if (i === 55) {
        schedule.push({
          consonantKind: "CORRUPT",
          targetVowelId: "reg-cluster",
          params: {},
          tick: 550,
          action: "write",
          key: "leader",
          value: "node-A",
          actorId: "node-A",
        });
      } else if (i === 81) {
        schedule.push({
          consonantKind: "CORRUPT",
          targetVowelId: "reg-cluster",
          params: {},
          tick: 810,
          action: "write",
          key: "leader",
          value: "node-B",
          actorId: "node-B",
        });
      } else {
        schedule.push(makeNoiseStep(i));
      }
    }

    const initialFindings = auditCausalHistory(stepsToCausalLog(schedule));
    const targetFinding = initialFindings.find((f) => f.kind === "SPLIT_BRAIN");
    assert.ok(targetFinding, "Initial 100-step schedule must trigger SPLIT_BRAIN");

    const res = await shrinkTrace(schedule, targetFinding, {
      evaluate: (steps) => auditCausalHistory(stepsToCausalLog(steps)),
    });

    assert.equal(res.originalStepCount, 100);
    assert.ok(res.minimalStepCount <= 6, `Expected <= 6 steps, got ${res.minimalStepCount}`);
    assert.equal(res.minimalStepCount, 4);
    assert.ok(res.finding !== null);
  });

  it("3. shrinks a 100-step schedule triggering STALE_LEASE_COMMIT to <= 4 steps", async () => {
    const schedule: FaultStep[] = [];
    for (let i = 0; i < 100; i++) {
      if (i === 9) {
        schedule.push({
          consonantKind: "SATURATE",
          targetVowelId: "lease-lock",
          params: {},
          tick: 90,
          action: "acquire_lease",
          leaseId: "lease-lock",
          actorId: "worker-1",
          until: 200,
          epoch: 1,
        });
      } else if (i === 88) {
        schedule.push({
          consonantKind: "DELAY",
          targetVowelId: "lease-lock",
          params: {},
          tick: 880,
          action: "commit",
          leaseId: "lease-lock",
          actorId: "worker-1",
          epoch: 1,
        });
      } else {
        schedule.push(makeNoiseStep(i));
      }
    }

    const initialFindings = auditCausalHistory(stepsToCausalLog(schedule));
    const targetFinding = initialFindings.find((f) => f.kind === "STALE_LEASE_COMMIT");
    assert.ok(targetFinding, "Initial 100-step schedule must trigger STALE_LEASE_COMMIT");

    const res = await shrinkTrace(schedule, targetFinding, {
      evaluate: (steps) => auditCausalHistory(stepsToCausalLog(steps)),
    });

    assert.equal(res.originalStepCount, 100);
    assert.ok(res.minimalStepCount <= 4, `Expected <= 4 steps, got ${res.minimalStepCount}`);
    assert.equal(res.minimalStepCount, 2);
    assert.ok(res.finding !== null);
  });

  it("4. returns original unchanged and finding=null when schedule does not trigger failure", async () => {
    const schedule: FaultStep[] = [makeNoiseStep(0), makeNoiseStep(1), makeNoiseStep(2)];
    const targetFinding: Finding = {
      rule_id: "causal-history-lost-update",
      pillar: "causal-history-verifier",
      status: "proven",
      severity: "critical",
      message: "Lost update",
      evidence: { span_ids: ["e1", "e2"], resource: "reg-ledger" },
      repro: "repro",
      suggested_fix: "fix",
    };

    const res = await shrinkTrace(schedule, targetFinding, {
      evaluate: (steps) => auditCausalHistory(stepsToCausalLog(steps)),
    });

    assert.equal(res.originalStepCount, 3);
    assert.equal(res.minimalStepCount, 3);
    assert.equal(res.minimalSteps.length, 3);
    assert.equal(res.finding, null);
    assert.equal(res.shrinkRatio, 1);
  });

  it("5. handles empty schedule safely with empty minimalSteps", async () => {
    const targetFinding: Finding = {
      rule_id: "causal-history-lost-update",
      pillar: "causal-history-verifier",
      status: "proven",
      severity: "critical",
      message: "Lost update",
      evidence: { span_ids: [], resource: "reg-ledger" },
      repro: "repro",
      suggested_fix: "fix",
    };

    const res = await shrinkTrace([], targetFinding, {
      evaluate: () => [],
    });

    assert.equal(res.originalStepCount, 0);
    assert.equal(res.minimalStepCount, 0);
    assert.deepEqual(res.minimalSteps, []);
    assert.equal(res.finding, null);
  });

  it("6. shrinks a schedule where minimal is exactly 1 step (single-fault trigger)", async () => {
    const schedule: FaultStep[] = [];
    for (let i = 0; i < 32; i++) {
      if (i === 19) {
        schedule.push({
          consonantKind: "SEVER",
          targetVowelId: "chan-pay",
          params: { phase: "POST_COMMIT" },
        });
      } else {
        schedule.push(makeNoiseStep(i));
      }
    }

    const fakeFinding: Finding = {
      rule_id: "native-network-idempotency",
      pillar: "network",
      status: "proven",
      severity: "critical",
      message: "Duplicate mutation",
      evidence: { span_ids: ["e1"], resource: "chan-pay" },
      repro: "repro",
      suggested_fix: "fix",
    };

    const res = await shrinkTrace(schedule, fakeFinding, {
      evaluate: (steps) =>
        steps.some((s) => s.consonantKind === "SEVER" && s.targetVowelId === "chan-pay")
          ? [fakeFinding]
          : [],
    });

    assert.equal(res.minimalStepCount, 1);
    assert.equal(res.minimalSteps[0]!.consonantKind, "SEVER");
    assert.equal(res.minimalSteps[0]!.targetVowelId, "chan-pay");
    assert.equal(res.shrinkRatio, 32);
  });

  it("7. does not over-prune when 2 specific steps are both required (binary fault)", async () => {
    const schedule: FaultStep[] = Array.from({ length: 16 }, (_, i) => {
      if (i === 3) return { consonantKind: "DELAY", targetVowelId: "chan-a", params: { durationMs: 5000 } };
      if (i === 11) return { consonantKind: "DUPLICATE", targetVowelId: "chan-b", params: { count: 2 } };
      return makeNoiseStep(i);
    });

    const binaryFinding: Finding = {
      rule_id: "binary-fault",
      pillar: "composition",
      status: "proven",
      severity: "critical",
      message: "Requires both chan-a DELAY and chan-b DUPLICATE",
      evidence: { span_ids: ["e1", "e2"], resource: "chan-b" },
      repro: "repro",
      suggested_fix: "fix",
    };

    const res = await shrinkTrace(schedule, binaryFinding, {
      evaluate: (steps) => {
        const hasA = steps.some((s) => s.targetVowelId === "chan-a");
        const hasB = steps.some((s) => s.targetVowelId === "chan-b");
        return hasA && hasB ? [binaryFinding] : [];
      },
    });

    assert.equal(res.minimalStepCount, 2);
    assert.equal(res.minimalSteps[0]!.targetVowelId, "chan-a");
    assert.equal(res.minimalSteps[1]!.targetVowelId, "chan-b");
  });

  it("8. end-to-end: searchFaults populates minimalSteps on Finding and re-execution triggers same Finding", async () => {
    const scenarioA = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-A");
    assert.ok(scenarioA, "Expected scenario-A in SCENARIO_DEFINITIONS");
    const graph = scenarioA.buildGraph();

    const searchResult = await searchFaults(graph, { maxDepth: 2 }, 42817);
    assert.equal(searchResult.status, "FAILURE_FOUND");
    assert.ok(searchResult.allFindings && searchResult.allFindings.length > 0);

    const proven = searchResult.allFindings.find((f) => f.status === "proven");
    assert.ok(proven, "Expected a proven Finding");
    assert.ok(Array.isArray(proven.minimalSteps) && proven.minimalSteps.length > 0, "Expected minimalSteps on Finding");
    assert.ok(typeof proven.shrinkRatio === "number" && proven.shrinkRatio >= 1);

    // Re-execute minimalSteps alone and verify it triggers the same Finding rule_id
    const reExec = await executeFaultSequence(graph, proven.minimalSteps as any, 42817);
    assert.ok(
      reExec.findings.some((f) => f.rule_id === proven.rule_id),
      `Expected re-executing minimalSteps to trigger ${proven.rule_id}`,
    );
  });
});
