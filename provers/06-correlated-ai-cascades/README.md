# Prover 06: Correlated AI API Cascades & Multi-Provider Failover Illusion (Nov 13-17, 2026)

> **Deterministic Reproduction & Formal Invariant Proof**  
> *Target Architecture*: Multi-Provider LLM Routing, Fallback Cascades & Shared Cloud Infrastructure  
> *Incident Impact*: 4 major AI API outages in 5 days; algorithmic trading desks, healthcare diagnostic tools, and enterprise chatbots collapsed due to naive automated failover creating an uncapped thundering herd.

---

## 1. Quickstart (1-Command Reproduction)

Run the full dual-layer prover (Native Thundering Herd Knockdown + DISTRIB State-Space Verification):

```bash
# Requires Node.js >= 22.6.0 (Zero external dependencies)
npm test
```

---

## 2. What This Prover Proves

### Layer 1: Native Code Component Test (`src/failover-router.ts`)
- Recreates a multi-provider router where the fallback provider is operating at 80% baseline capacity (24/30 active slots).
- Primary provider degrades; naive failover instantly diverts 30 failed requests to the fallback.
- **Observed Native Failure**:
  - Secondary provider capacity is breached ($24 + 30 = 54 > 30$).
  - **24 out of 30 failover requests crash** with HTTP 429 / 502, deadlocking both providers simultaneously.
- **Patched Native Resolution (`src/failover-router.patched.ts`)**:
  - Implements Bulkhead Rate-Capping and adaptive shedding.
  - Fallback in-flight load is strictly capped at capacity (30/30) with **0 crashes**. Remaining load is shed cleanly with backpressure.

### Layer 2: DISTRIB Formal State-Space Proof (`baseline.config.json`)
- **Baseline Audit**: Formally **`BLOCKED`** at Depth 1 due to provider saturation cascading across channels.
- **Hardened Verification**: Formally **`APPROVED`** across **1,483 exhaustive state permutations** (`NO_FAILURE_WITHIN_BOUND`).
