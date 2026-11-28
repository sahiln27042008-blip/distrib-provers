import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditCausalHistory, type SimLogEntry } from "./causal-history-checker.ts";
import { createWorkflow, insertNode, clearWorkflows } from "../../../compiler/workflow-store.ts";
import { auditWorkflowReliabilityTool } from "../../../mcp/tools/causal-audit.ts";

describe("Causal History Verifier (Elle-style)", () => {
  it("1. detects LOST_UPDATE when W2 overwrites W1 without an intervening read by writer2", () => {
    const log: SimLogEntry[] = [
      {
        id: "e1",
        t: 10,
        kind: "history.write",
        corr: "reg-balance",
        data: { op: "write", targetVowelId: "reg-balance", targetName: "Ledger Register", key: "balance", value: 100, actorId: "worker-A", txnId: "T1" },
      },
      {
        id: "e2",
        t: 20,
        kind: "history.write",
        corr: "reg-balance",
        data: { op: "write", targetVowelId: "reg-balance", targetName: "Ledger Register", key: "balance", value: 200, actorId: "worker-B", txnId: "T2" },
      },
    ];

    const findings = auditCausalHistory(log);
    const lost = findings.find((f) => f.kind === "LOST_UPDATE");
    assert.ok(lost, "Expected LOST_UPDATE finding");
    assert.equal(lost.targetVowelId, "reg-balance");
    assert.equal(lost.businessTarget, "Ledger Register");
    assert.deepEqual(lost.params.eventIds, ["e1", "e2"]);
    assert.equal(lost.params.violatedRule, "LOST_UPDATE");
  });

  it("2. detects DIRTY_READ when another actor reads an uncommitted write before txn commits", () => {
    const log: SimLogEntry[] = [
      {
        id: "e1",
        t: 10,
        kind: "history.write",
        corr: "reg-orders",
        data: { op: "write", targetVowelId: "reg-orders", targetName: "Orders DB", key: "status", value: "PAID", actorId: "svc-A", txnId: "T1" },
      },
      {
        id: "e2",
        t: 15,
        kind: "history.read",
        corr: "reg-orders",
        data: { op: "read", targetVowelId: "reg-orders", targetName: "Orders DB", key: "status", value: "PAID", actorId: "svc-B", txnId: "T2" },
      },
      {
        id: "e3",
        t: 30,
        kind: "history.commit",
        corr: "reg-orders",
        data: { op: "commit", targetVowelId: "reg-orders", txnId: "T1" },
      },
    ];

    const findings = auditCausalHistory(log);
    const dirty = findings.find((f) => f.kind === "DIRTY_READ");
    assert.ok(dirty, "Expected DIRTY_READ finding");
    assert.equal(dirty.targetVowelId, "reg-orders");
    assert.ok(dirty.params.eventIds.includes("e1") && dirty.params.eventIds.includes("e2"));
    assert.equal(dirty.params.violatedRule, "DIRTY_READ");
  });

  it("3. detects SPLIT_BRAIN when two actors write different values under overlapping lease windows", () => {
    const log: SimLogEntry[] = [
      {
        id: "e1",
        t: 0,
        kind: "lease.acquire",
        corr: "lease-leader",
        data: { op: "acquire_lease", leaseId: "lease-leader", targetVowelId: "lease-leader", targetName: "Primary Lease", actorId: "node-A", until: 100, epoch: 1 },
      },
      {
        id: "e2",
        t: 10,
        kind: "lease.acquire",
        corr: "lease-leader",
        data: { op: "acquire_lease", leaseId: "lease-leader", targetVowelId: "lease-leader", targetName: "Primary Lease", actorId: "node-B", until: 120, epoch: 1 },
      },
      {
        id: "e3",
        t: 25,
        kind: "history.write",
        corr: "reg-config",
        data: { op: "write", targetVowelId: "reg-config", targetName: "Cluster Config", key: "leader", value: "node-A", actorId: "node-A" },
      },
      {
        id: "e4",
        t: 30,
        kind: "history.write",
        corr: "reg-config",
        data: { op: "write", targetVowelId: "reg-config", targetName: "Cluster Config", key: "leader", value: "node-B", actorId: "node-B" },
      },
    ];

    const findings = auditCausalHistory(log);
    const split = findings.find((f) => f.kind === "SPLIT_BRAIN");
    assert.ok(split, "Expected SPLIT_BRAIN finding");
    assert.deepEqual(split.params.eventIds, ["e3", "e4"]);
    assert.equal(split.params.violatedRule, "SPLIT_BRAIN");
  });

  it("4. detects STALE_LEASE_COMMIT when a commit occurs after the holding lease expired", () => {
    const log: SimLogEntry[] = [
      {
        id: "e1",
        t: 0,
        kind: "lease.acquire",
        corr: "lease-lock",
        data: { op: "acquire_lease", leaseId: "lease-lock", targetVowelId: "lease-lock", targetName: "Settlement Lock", actorId: "worker-1", until: 50, epoch: 1 },
      },
      {
        id: "e2",
        t: 85,
        kind: "history.commit",
        corr: "lease-lock",
        data: { op: "commit", leaseId: "lease-lock", targetVowelId: "reg-settlement", actorId: "worker-1", epoch: 1 },
      },
    ];

    const findings = auditCausalHistory(log);
    const stale = findings.find((f) => f.kind === "STALE_LEASE_COMMIT");
    assert.ok(stale, "Expected STALE_LEASE_COMMIT finding");
    assert.equal(stale.targetVowelId, "lease-lock");
    assert.deepEqual(stale.params.eventIds, ["e1", "e2"]);
    assert.equal(stale.params.violatedRule, "STALE_LEASE_COMMIT");
  });

  it("5. detects CAUSAL_VIOLATION when an effect tick precedes its parent cause tick", () => {
    const log: SimLogEntry[] = [
      {
        id: "e1",
        t: 50,
        kind: "channel.send",
        corr: "chan-pay",
        data: { targetVowelId: "chan-pay", targetName: "Payment Channel" },
      },
      {
        id: "e2",
        t: 20,
        kind: "channel.ack",
        corr: "chan-pay",
        parent: "e1",
        data: { targetVowelId: "chan-pay", targetName: "Payment Channel" },
      },
    ];

    const findings = auditCausalHistory(log);
    const causal = findings.find((f) => f.kind === "CAUSAL_VIOLATION");
    assert.ok(causal, "Expected CAUSAL_VIOLATION finding");
    assert.deepEqual(causal.params.eventIds, ["e1", "e2"]);
    assert.equal(causal.params.violatedRule, "CAUSAL_VIOLATION");
  });

  it("6. detects READ_SKEW when a transaction reads k1 before a concurrent commit and k2 after it", () => {
    const log: SimLogEntry[] = [
      {
        id: "e1",
        t: 5,
        kind: "history.write",
        corr: "reg-bank",
        data: { op: "write", targetVowelId: "reg-bank", targetName: "Bank Accounts", key: "checking", value: 500, txnId: "T0" },
      },
      {
        id: "e2",
        t: 6,
        kind: "history.commit",
        corr: "reg-bank",
        data: { op: "commit", targetVowelId: "reg-bank", txnId: "T0" },
      },
      {
        id: "e3",
        t: 10,
        kind: "history.read",
        corr: "reg-bank",
        data: { op: "read", targetVowelId: "reg-bank", targetName: "Bank Accounts", key: "checking", value: 500, txnId: "T1" },
      },
      {
        id: "e4",
        t: 15,
        kind: "history.write",
        corr: "reg-bank",
        data: { op: "write", targetVowelId: "reg-bank", targetName: "Bank Accounts", key: "checking", value: 400, txnId: "T2" },
      },
      {
        id: "e5",
        t: 16,
        kind: "history.write",
        corr: "reg-bank",
        data: { op: "write", targetVowelId: "reg-bank", targetName: "Bank Accounts", key: "savings", value: 1100, txnId: "T2" },
      },
      {
        id: "e6",
        t: 20,
        kind: "history.commit",
        corr: "reg-bank",
        data: { op: "commit", targetVowelId: "reg-bank", txnId: "T2" },
      },
      {
        id: "e7",
        t: 25,
        kind: "history.read",
        corr: "reg-bank",
        data: { op: "read", targetVowelId: "reg-bank", targetName: "Bank Accounts", key: "savings", value: 1100, txnId: "T1" },
      },
    ];

    const findings = auditCausalHistory(log);
    const skew = findings.find((f) => f.kind === "READ_SKEW");
    assert.ok(skew, "Expected READ_SKEW finding");
    assert.equal(skew.params.violatedRule, "READ_SKEW");
    assert.ok(skew.params.eventIds.includes("e3") && skew.params.eventIds.includes("e7"));
  });

  it("7. detects ABORTED_READ when a read observes a value written by a transaction that later aborts", () => {
    const log: SimLogEntry[] = [
      {
        id: "e1",
        t: 10,
        kind: "history.write",
        corr: "reg-inv",
        data: { op: "write", targetVowelId: "reg-inv", targetName: "Inventory Register", key: "stock", value: 0, txnId: "T1" },
      },
      {
        id: "e2",
        t: 15,
        kind: "history.read",
        corr: "reg-inv",
        data: { op: "read", targetVowelId: "reg-inv", targetName: "Inventory Register", key: "stock", value: 0, txnId: "T2" },
      },
      {
        id: "e3",
        t: 25,
        kind: "history.abort",
        corr: "reg-inv",
        data: { op: "abort", targetVowelId: "reg-inv", txnId: "T1" },
      },
    ];

    const findings = auditCausalHistory(log);
    const aborted = findings.find((f) => f.kind === "ABORTED_READ");
    assert.ok(aborted, "Expected ABORTED_READ finding");
    assert.deepEqual(aborted.params.eventIds, ["e1", "e2", "e3"]);
    assert.equal(aborted.params.violatedRule, "ABORTED_READ");
  });

  it("8. returns zero findings for a clean, properly serialized log", () => {
    const log: SimLogEntry[] = [
      {
        id: "e1",
        t: 0,
        kind: "lease.acquire",
        corr: "lease-1",
        data: { op: "acquire_lease", leaseId: "lease-1", targetVowelId: "lease-1", actorId: "worker-A", until: 100, epoch: 1 },
      },
      {
        id: "e2",
        t: 10,
        kind: "history.write",
        corr: "reg-1",
        parent: "e1",
        data: { op: "write", targetVowelId: "reg-1", key: "balance", value: 100, actorId: "worker-A", txnId: "T1" },
      },
      {
        id: "e3",
        t: 20,
        kind: "history.commit",
        corr: "reg-1",
        parent: "e2",
        data: { op: "commit", leaseId: "lease-1", targetVowelId: "reg-1", actorId: "worker-A", txnId: "T1", epoch: 1 },
      },
      {
        id: "e4",
        t: 30,
        kind: "history.read",
        corr: "reg-1",
        parent: "e3",
        data: { op: "read", targetVowelId: "reg-1", key: "balance", value: 100, actorId: "worker-B", txnId: "T2" },
      },
      {
        id: "e5",
        t: 40,
        kind: "history.write",
        corr: "reg-1",
        parent: "e4",
        data: { op: "write", targetVowelId: "reg-1", key: "balance", value: 150, actorId: "worker-B", txnId: "T2" },
      },
      {
        id: "e6",
        t: 50,
        kind: "history.commit",
        corr: "reg-1",
        parent: "e5",
        data: { op: "commit", leaseId: "lease-1", targetVowelId: "reg-1", actorId: "worker-B", txnId: "T2", epoch: 1 },
      },
    ];

    const findings = auditCausalHistory(log);
    assert.equal(findings.length, 0, `Expected 0 findings, got: ${JSON.stringify(findings)}`);
  });

  it("9. gracefully skips anomaly checks when optional fields like txnId are missing", () => {
    const log: SimLogEntry[] = [
      {
        id: "e1",
        t: 10,
        kind: "history.write",
        corr: "reg-sparse",
        data: { op: "write", targetVowelId: "reg-sparse", key: "x", value: 1 },
      },
      {
        id: "e2",
        t: 20,
        kind: "history.read",
        corr: "reg-sparse",
        data: { op: "read", targetVowelId: "reg-sparse", key: "x", value: 1 },
      },
    ];

    const findings = auditCausalHistory(log);
    assert.equal(findings.length, 0);
  });

  it("10. integration: auditWorkflowReliabilityTool surfaces causal-history checker findings", async () => {
    clearWorkflows();
    const workflowId = "causal-history-integration-wf";
    createWorkflow(workflowId, "Causal History Integration Test", ["no_lost_update"]);
    insertNode(workflowId, {
      nodeName: "settlement-service",
      nodeDescription: "Concurrent settlement workers sharing an unlocked lease state",
      substrates: [
        {
          vowel: "LEASE",
          params: { maxCapacity: 2, ttlMs: 5000, overflowPolicy: "WAIT_TIMEOUT" },
        },
      ],
      consonants: [{ kind: "STALE_READ_WITHOUT_LOCK", params: {} }],
      outboundEdges: [],
    });

    const result = await auditWorkflowReliabilityTool.handler({
      workflowId,
      maxDepth: 2,
      seed: 42817,
    });

    assert.equal(result.success, true);
    assert.equal(result.verdict, "BLOCKED");
    const findings = result.findings as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(findings) && findings.length > 0, "Expected findings array in audit output");
    const causalFinding = findings.find((f) => f.kind === "LOST_UPDATE" || String(f.rule_id).startsWith("causal-history-"));
    assert.ok(causalFinding, `Expected a causal-history finding in audit output, got: ${JSON.stringify(findings)}`);
  });
});
