/**
 * GitHub High Primary DB Load Outage (Nov 25, 2026): Deterministic Prover Test Harness
 *
 * Executes:
 * 1. Native Code Reproduction of Shared Primary DB Starvation Across 8 Surfaces
 * 2. Native Code Verification of Per-Surface Bulkheads + Idempotent Webhook Replay
 * 3. Formal DISTRIB Bounded Model Proof (BLOCKED baseline -> BLOCKED partial -> APPROVED compound)
 */

import assert from "node:assert";
import { resolve } from "node:path";
import { GitHubClusterUnpatched, type GitHubSurface } from "./github-surfaces.ts";
import { GitHubClusterPatched } from "./github-surfaces.patched.ts";
import { runAuditOnConfig, runVerifyOnConfig } from "../../../packages/distrib-core/src/api.ts";

const COUPLED_SURFACES: GitHubSurface[] = [
  "pull_requests",
  "issues",
  "git_ops",
  "packages",
  "pages",
  "api",
];

async function run() {
  console.log("=".repeat(78));
  console.log(" BOUNDED PROVER 25: GITHUB SHARED PRIMARY DB CASCADE (Nov 25, 2026)");
  console.log("=".repeat(78));

  // --------------------------------------------------------------------------
  // PHASE 1: NATIVE CODE REPRODUCTION
  // --------------------------------------------------------------------------
  console.log("\n[PHASE 1] Executing Unpatched Shared-DB Cascade Simulation...");
  const unpatched = new GitHubClusterUnpatched(16);
  unpatched.saturateActionsAndWebhooks(32);

  for (let i = 0; i < COUPLED_SURFACES.length; i++) {
    unpatched.handleRequest(COUPLED_SURFACES[i]!, `core-req-${i + 1}`);
  }
  for (let i = 1; i <= 4; i++) {
    unpatched.handleRequest("webhooks", `wh-${i}`);
  }
  unpatched.handleRequest("copilot", "copilot-1");
  unpatched.handleRequest("codespaces", "codespace-1");

  console.log(`  - Shared DB Active Connections: ${unpatched.sharedDbActiveConnections}/16`);
  console.log(`  - Starved Core Surfaces (PR/Issues/Git/Packages/Pages/API): ${unpatched.starvedCoreRequests}/6`);
  console.log(`  - Dropped Webhooks: ${unpatched.droppedWebhooks}/4`);
  console.log(`  - Isolated Plane (Copilot + Codespaces) Healthy: ${unpatched.isolatedPlaneSuccesses}/2`);
  assert.strictEqual(unpatched.starvedCoreRequests, 6, "All 6 coupled core surfaces must starve");
  assert.strictEqual(unpatched.droppedWebhooks, 4, "Webhooks must drop under DB saturation");
  assert.strictEqual(unpatched.isolatedPlaneSuccesses, 2, "Copilot & Codespaces stay isolated and healthy");
  console.log("  -> [VERIFIED FAILURE] Shared DB saturation choked all 8 coupled surfaces while isolated planes stayed green.");

  // --------------------------------------------------------------------------
  // PHASE 2: NATIVE PATCHED VERIFICATION
  // --------------------------------------------------------------------------
  console.log("\n[PHASE 2] Executing Patched Bulkhead + Idempotent Replay Verification...");
  const patched = new GitHubClusterPatched(16, 6);
  patched.saturateActionsAndWebhooks(32);

  for (let i = 0; i < COUPLED_SURFACES.length; i++) {
    const res = patched.handleRequest(COUPLED_SURFACES[i]!, `core-req-${i + 1}`);
    assert.strictEqual(res.ok, true, `${COUPLED_SURFACES[i]} must stay healthy under bulkhead`);
  }
  // Duplicate retry of core-req-1
  patched.handleRequest("pull_requests", "core-req-1");
  patched.handleRequest("copilot", "copilot-1");
  patched.handleRequest("codespaces", "codespace-1");

  console.log(`  - Actions/Webhooks Clamped Active Slots: ${patched.actionsWebhookActive}/6 (Shed: ${patched.shedExcessActions})`);
  console.log(`  - Core Surfaces Succeeded: ${patched.coreSuccesses}/6`);
  console.log(`  - Deduplicated Retries: ${patched.deduplicatedRetries}`);
  console.log(`  - Isolated Plane Healthy: ${patched.isolatedPlaneSuccesses}/2`);
  assert.strictEqual(patched.coreSuccesses, 6, "All 6 core surfaces must stay operational");
  assert.strictEqual(patched.deduplicatedRetries, 1, "Duplicate retry must be deduplicated");
  console.log("  -> [VERIFIED RESOLUTION] Per-surface bulkheads + idempotency isolate burst load and prevent cascade.");

  // --------------------------------------------------------------------------
  // PHASE 3: DISTRIB FORMAL STATE-SPACE PROOF
  // --------------------------------------------------------------------------
  console.log("\n[PHASE 3] Running Formal Bounded State-Space Verification...");
  const configPath = resolve(import.meta.dirname, "../baseline.config.json");

  const auditResult = await runAuditOnConfig(configPath, { seed: 42817 });
  console.log(`  - Baseline Audit Verdict: [ GATE: ${auditResult.verdict} ] (Evaluations: ${auditResult.evaluationsCount ?? 0}, Duration: ${(auditResult.durationMs ?? 0).toFixed(2)}ms)`);
  assert.strictEqual(auditResult.verdict, "BLOCKED", "Baseline must be formally BLOCKED");

  const partialVerify = await runVerifyOnConfig(configPath, ["enforce_idempotency"], { seed: 42817 });
  console.log(`  - Partial Fix (idempotency only) Verdict: [ GATE: ${partialVerify.verdict} ] (Violated: ${JSON.stringify(partialVerify.violatedInvariants)})`);
  assert.strictEqual(partialVerify.verdict, "BLOCKED", "Idempotency alone must remain BLOCKED without bulkheading/lease fixes");

  const fullVerify = await runVerifyOnConfig(
    configPath,
    ["enforce_idempotency", "zero_hold_lease", "fencing_token_enabled", "shed_at_threshold"],
    { seed: 42817 },
  );
  console.log(`  - Hardened Verify Verdict: [ GATE: ${fullVerify.verdict} ] (Evaluations: ${fullVerify.evaluationsCount ?? 0}, Duration: ${(fullVerify.durationMs ?? 0).toFixed(2)}ms)`);
  console.log(`  - Invariant Status: ${fullVerify.status}`);
  assert.strictEqual(fullVerify.verdict, "APPROVED", "Hardened verification must be APPROVED");
  assert.strictEqual(fullVerify.status, "NO_FAILURE_WITHIN_BOUND");

  console.log("\n" + "=".repeat(78));
  console.log(" BOUNDED VERIFICATION COMPLETE: NATIVE CODE & STATE-SPACE PROOF CONFIRMED");
  console.log("=".repeat(78));
}

run().catch((err) => {
  console.error("\nPROVER FAILED WITH ERROR:", err);
  process.exit(1);
});
