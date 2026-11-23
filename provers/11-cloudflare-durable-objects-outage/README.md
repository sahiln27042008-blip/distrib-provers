# Prover 11: Cloudflare Durable Objects & D1 Elevated Storage Errors with Stateless Ingress Decoupling

> **Deterministic Reproduction & Formal Invariant Proof**  
> *Target Architecture*: Stateless Edge Workers, Stateful Edge Actors (Durable Objects), Embedded Storage (D1 SQLite), Edge Object Store (R2), Cloudflare Access Identity Tokens  
> *Incident Impact*: Storage operations on Durable Objects and D1 failed or experienced elevated latencies for 32–35 minutes while stateless Workers remained green with HTTP 200 OK. Autonomous agents experienced frozen session locks, state desynchronization, and authentication claim omissions.

---

## 1. Quickstart (1-Command Reproduction)

Run the full dual-layer prover (Native Storage Stall & Lock Freeze Reproduction + DISTRIB Formal Proof):

```bash
# Requires Node.js >= 22.6.0 (Zero external dependencies)
npm test
```

---

## 2. What This Prover Proves

### Layer 1: Native Code Component Test (`src/storage-stall.ts`)
- Recreates a cluster of 100 stateful Durable Object actors handling 1,000 state mutations from autonomous AI agents.
- Simulates the 35-minute storage stall where D1/DO storage write calls hang or fail.
- Simulates Cloudflare Access release bug dropping `sub` claims on service token JWTs.
- **Observed Native Failure**:
  - Stateless edge Workers return HTTP 200 OK or dispatch to Durable Objects while storage is stalled.
  - Durable Object actors acquire locks without lease timers; uncaught storage timeouts leave actor locks permanently orphaned.
  - **100% actor freeze**: All 100 actors are locked indefinitely, blocking subsequent turns.
  - **Unauthorized token execution**: Requests missing `sub` claims are accepted and processed.
- **Patched Native Resolution (`src/storage-stall.patched.ts`)**:
  - Implements **Monotonic Lease Epoch Fencing** with bounded lock timers (zero-hold lease safety).
  - Implements **Ingress Idempotency Registry** preventing duplicate mutations across client retries.
  - Enforces **Strict JWT Claim Invariants** at ingress, immediately rejecting tokens missing `sub` claim.
  - Adds **Fail-Fast Adaptive Load Shedding** (HTTP 503 + Retry-After) when storage latency exceeds threshold.
  - Preserves 100% boundary safety: **0 orphaned locks, 0 duplicate mutations, 0 unauthorized executions**.

### Layer 2: DISTRIB Formal State-Space Proof (`baseline.config.json`)
- **Baseline Audit**: Formally **`BLOCKED`** at Depth 1 (`evaluationsCount: 3`).
- **Hardened Verification**: Formally **`APPROVED`** across **1,123 state permutations** (`NO_FAILURE_WITHIN_BOUND`).
