/**
 * Spike.sh API Outage (Nov 25, 2026): Deterministic Prover Test Harness
 *
 * Executes:
 * 1. Native Code Reproduction of Poison-Pill Recursion + Lying Health Checks
 * 2. Native Code Verification of Bounded Recursion + Readiness Shedding + Idempotency
 * 3. Formal DISTRIB Bounded Model Proof (BLOCKED baseline -> APPROVED hardened)
 */

import assert from "node:assert";
import { resolve } from "node:path";
import { SpikeFleetUnpatched } from "./spike-fleet.ts";
import { SpikeFleetPatched } from "./spike-fleet.patched.ts";
import { runAuditOnConfig, runVerifyOnConfig } from "../../../packages/distrib-core/src/api.ts";

async function run() {
  console.log("=".repeat(78));
  console.log(" BOUNDED PROVER 24: SPIKE.SH RECURSIVE ROTATION & LYING PROBES (Nov 25, 2026)");
  console.log("=".repeat(78));

  // --------------------------------------------------------------------------
  // PHASE 1: NATIVE CODE REPRODUCTION
  // --------------------------------------------------------------------------
  console.log("\n[PHASE 1] Executing Unpatched Fleet Simulation...");
  const unpatched = new SpikeFleetUnpatched(4, 8);

  // 4 cyclic poison-pill stress requests freeze all 4 API workers
  for (let i = 1; i <= 4; i++) {
    unpatched.dispatchRequest({ id: `stress-poison-${i}`, isCyclicPoisonPill: true });
  }
  // 20 legitimate customer monitoring alerts arrive during the 8-minute window
  for (let i = 1; i <= 20; i++) {
    unpatched.dispatchRequest({ id: `prod-alert-${i}`, isCyclicPoisonPill: false });
  }

  const frozenCount = unpatched.workers.filter((w) => w.frozen).length;
  console.log(`  - Frozen Workers: ${frozenCount}/4`);
  console.log(`  - Processed Legitimate Alerts: ${unpatched.processedAlerts}/20`);
  console.log(`  - Dropped Alerts (routed to frozen workers): ${unpatched.droppedAlerts}`);
  assert.strictEqual(frozenCount, 4, "All 4 workers must freeze at 100% CPU");
  assert.strictEqual(unpatched.processedAlerts, 0, "100% blackout: 0 legitimate alerts processed");
  assert.ok(unpatched.droppedAlerts >= 20, "Load balancer must drop alerts into frozen fleet");
  console.log("  -> [VERIFIED FAILURE] Lying health checks routed 100% of traffic into frozen fleet.");

  // --------------------------------------------------------------------------
  // PHASE 2: NATIVE PATCHED VERIFICATION
  // --------------------------------------------------------------------------
  console.log("\n[PHASE 2] Executing Patched Fleet Verification...");
  const patched = new SpikeFleetPatched(4, 8);

  for (let i = 1; i <= 4; i++) {
    patched.dispatchRequest({ id: `stress-poison-${i}`, isCyclicPoisonPill: true });
  }
  for (let i = 1; i <= 20; i++) {
    patched.dispatchRequest({ id: `prod-alert-${i}`, isCyclicPoisonPill: false });
  }
  // Replay duplicate retry of prod-alert-1
  patched.dispatchRequest({ id: "prod-alert-1", isCyclicPoisonPill: false });

  const patchedFrozen = patched.workers.filter((w) => w.frozen).length;
  console.log(`  - Frozen Workers: ${patchedFrozen}/4`);
  console.log(`  - Poison Pills Cleanly Rejected: ${patched.rejectedPoisonPills}/4`);
  console.log(`  - Processed Legitimate Alerts: ${patched.processedAlerts}/20`);
  console.log(`  - Deduplicated Retries: ${patched.deduplicatedRetries}`);
  assert.strictEqual(patchedFrozen, 0, "0 workers should freeze");
  assert.strictEqual(patched.rejectedPoisonPills, 4, "All 4 cyclic schedules must be rejected");
  assert.strictEqual(patched.processedAlerts, 20, "All 20 legitimate alerts must succeed");
  assert.strictEqual(patched.deduplicatedRetries, 1, "Retry must be deduplicated");
  console.log("  -> [VERIFIED RESOLUTION] Bounded recursion + readiness checks preserve 100% fleet availability.");

  // --------------------------------------------------------------------------
  // PHASE 3: DISTRIB FORMAL STATE-SPACE PROOF
  // --------------------------------------------------------------------------
  console.log("\n[PHASE 3] Running Formal Bounded State-Space Verification...");
  const configPath = resolve(import.meta.dirname, "../baseline.config.json");

  const auditResult = await runAuditOnConfig(configPath, { seed: 42817 });
  console.log(`  - Baseline Audit Verdict: [ GATE: ${auditResult.verdict} ] (Evaluations: ${auditResult.evaluationsCount ?? 0}, Duration: ${(auditResult.durationMs ?? 0).toFixed(2)}ms)`);
  assert.strictEqual(auditResult.verdict, "BLOCKED", "Baseline must be formally BLOCKED");

  const verifyResult = await runVerifyOnConfig(
    configPath,
    ["enforce_idempotency", "zero_hold_lease", "fencing_token_enabled", "shed_at_threshold"],
    { seed: 42817 },
  );
  console.log(`  - Hardened Verify Verdict: [ GATE: ${verifyResult.verdict} ] (Evaluations: ${verifyResult.evaluationsCount ?? 0}, Duration: ${(verifyResult.durationMs ?? 0).toFixed(2)}ms)`);
  console.log(`  - Invariant Status: ${verifyResult.status}`);
  assert.strictEqual(verifyResult.verdict, "APPROVED", "Hardened verification must be APPROVED");
  assert.strictEqual(verifyResult.status, "NO_FAILURE_WITHIN_BOUND");

  console.log("\n" + "=".repeat(78));
  console.log(" BOUNDED VERIFICATION COMPLETE: NATIVE CODE & STATE-SPACE PROOF CONFIRMED");
  console.log("=".repeat(78));
}

run().catch((err) => {
  console.error("\nPROVER FAILED WITH ERROR:", err);
  process.exit(1);
});
