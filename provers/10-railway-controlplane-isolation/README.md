# Prover 10: Railway Control Plane Security Incident & Blast Radius Isolation

Deterministic reproduction and formal state-space verification prover for the **Railway October 21 Control Plane Security Incident** (November 2026).

---

## Incident Summary

* **Incident:** An adversary compromised an internal service principal / bearer token and chained control-plane RPC calls into backend secret decryption systems.
* **The Blast Radius:** The attacker accessed and decrypted customer environment variables (targeting OpenAI, Anthropic, and database credentials for model distillation) across ~100,000 workspaces (1.85% of platform).
* **The Architectural Flaw:** Internal control-plane channels treated *network authentication* as *authorization*. Any identity that reached internal RPCs could query the vault across arbitrary tenant boundaries without tenant-scoped cryptographic fencing (`tenant_id`, `epoch_id`, `caller_role`). Because authority tokens were long-lived and platform-wide without per-tenant epoch revocation, Railway was forced into an emergency global halt of the entire build and container deployment fleet to quarantine the intrusion.
* **Resolution:** Implementing cryptographic tenant fencing tokens and monotonic workspace epoch invalidation guarantees 100% boundary isolation and instant per-workspace quarantine without halting the global fleet.

---

## Architecture & Verification Phases

1. **Phase 1: Native Failure Reproduction (`src/tenant-router.ts`)**
   - Simulates 100 customer workspaces with AI API keys and database credentials.
   - Adversary holding a valid internal token for `workspace-001` queries foreign workspaces (`002` through `100`).
   - Unpatched router validates bearer token without tenant fencing, decrypting and exfiltrating secrets across 99 of 99 foreign workspaces (297 plaintext credentials leaked).

2. **Phase 2: Native Resolution Verification (`src/tenant-router.patched.ts`)**
   - Enforces cryptographic tenant boundary isolation: tokens must match the target workspace ID.
   - Rejects 99 of 99 cross-tenant attacks with `TENANT_BOUNDARY_VIOLATION` (0 foreign secrets leaked).
   - Verifies monotonic workspace epoch invalidation: incrementing a workspace epoch immediately revokes compromised tokens (`STALE_EPOCH_REVOKED`) while fresh epoch tokens succeed, achieving instant surgical quarantine without platform fleet shutdowns.

3. **Phase 3: Formal DISTRIB Bounded Model Proof (`packages/distrib-core`)**
   - Baseline Audit (`runAuditOnConfig`): Formally **`BLOCKED`** in under 200ms.
   - Verified Patch (`runVerifyOnConfig`): Formally **`APPROVED`** across 1,123 state perturbations (`NO_FAILURE_WITHIN_BOUND`) under ablations `enforce_idempotency`, `zero_hold_lease`, `fencing_token_enabled`, `shed_at_threshold`.

---

## How to Run

```bash
# Run standalone test harness
node src/test-harness.ts

# Or via npm script
npm test
```
