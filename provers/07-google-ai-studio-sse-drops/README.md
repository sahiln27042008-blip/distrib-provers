# Prover 07: Google AI Studio & Antigravity SSE Drops & Quota Burn

> **Deterministic Reproduction & Formal Invariant Proof**  
> *Target Architecture*: Server-Sent Events (SSE) Proxy, Long-Context Ephemeral Cache, LLM Agent Runtimes  
> *Incident Impact*: Mid-stream EOF drops during multi-minute 500k context agent turns trigger unpatched clients to blindly re-dispatch full context from token 0, wiping ephemeral cache leases and burning 100% redundant prompt quota.

---

## 1. Quickstart (1-Command Reproduction)

Run the full dual-layer prover (Native SSE Drop Reproduction + DISTRIB State-Space Verification):

```bash
# Requires Node.js >= 22.6.0 (Zero external dependencies)
npm test
```

---

## 2. What This Prover Proves

### Layer 1: Native Code Component Test (`src/sse-stream.ts`)
- Recreates an autonomous agent turn with 500,000 prompt context tokens streaming response chunks.
- Mid-stream network interruption or inference worker restart occurs at chunk #12 (premature EOF).
- **Observed Native Failure**:
  - The unpatched client lacks a chunk resumption buffer and drops 1,100 previously generated output tokens.
  - The ephemeral prompt cache lease on the gateway is wiped.
  - The unpatched client re-dispatches the full 500,000 token prompt from token 0.
  - **Prompt tokens billed**: Double the expected quota (1,000,000 prompt tokens billed, burning an extra 500k tokens at full price).
- **Patched Native Resolution (`src/sse-stream.patched.ts`)**:
  - Implements a chunk-level resumption buffer preserving chunks 1–11.
  - Secures an epoch-fenced prompt cache lease token that remains active across reconnections.
  - Re-connects and resumes streaming from chunk #12 with **0 re-billed prompt tokens** and **0 wasted output tokens**.

### Layer 2: DISTRIB Formal State-Space Proof (`baseline.config.json`)
- **Baseline Audit**: Formally **`BLOCKED`** at Depth 1 due to post-commit channel severance and un-idempotent re-dispatching.
- **Hardened Verification**: Formally **`APPROVED`** across **1,261 exhaustive state permutations** (`NO_FAILURE_WITHIN_BOUND`).
