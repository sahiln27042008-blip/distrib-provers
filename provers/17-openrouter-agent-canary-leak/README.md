# Prover 17: OpenRouter Canary Prompt Breach & AI Agent Public Git Secret Leakage

> **Deterministic Reproduction & Formal Invariant Proof**  
> *Target Architecture*: Multi-Hop AI Inference Aggregators, Zero Data Retention (ZDR) Egress Routing, Autonomous Coding Agent Git Pipelines  
> *Incident Impact*: Dragos seeded ~2M LLM prompts with canary AWS credentials and detected attackers stealing prompts across 3 upstream AI inference providers (including requests flagged Zero Data Retention). On Nov 22, 2026, OpenRouter off-boarded 3 reseller providers and stripped 125 endpoints of ZDR eligibility. Concurrently on Nov 21, Together AI disclosed an autonomous coding agent committed a private Hugging Face repository token to its public GitHub repo, exposing stored prompt archives.

---

## 1. Quickstart (1-Command Reproduction)

Run the full dual-layer prover (Native Reseller & Agent Leak Reproduction + DISTRIB Formal Proof):

```bash
# Requires Node.js >= 22.6.0 (Zero external dependencies)
npm test
```

Or from the monorepo root:
```bash
npm run test:openrouter
```

---

## 2. What This Prover Proves

### Layer 1: Native Code Component Test (`src/router-leak.ts`)
- Recreates 200 LLM inference requests, including 20 prompts containing Dragos canary AWS credentials.
- Simulates multi-hop routing across direct providers and downstream inference resellers.
- Simulates an autonomous coding agent executing automated repository updates.
- **Observed Native Failure**:
  - Unpatched router forwards prompts to downstream resellers who ignore the `X-Zero-Data-Retention: true` flag and persist prompts to disk logs.
  - Attackers probe reseller logs, harvest canary AWS credentials, and execute unauthorized AWS STS `GetCallerIdentity` calls.
  - The autonomous coding agent commits `dataset_config.json` containing a private Hugging Face token directly to a public GitHub repository.
  - **Supply Chain Compromise**: **Canary AWS keys harvested across resellers, 1 private Hugging Face credential exposed in public git history**.
- **Patched Native Resolution (`src/router-leak.patched.ts`)**:
  - Implements **Egress Trust Boundary Gate (`EgressTrustBoundaryFilter`)**: Strips uncertified resellers from ZDR pools and scrubs accidental credentials from outgoing prompts.
  - Implements **Pre-Commit Secret Quarantine Gate (`PreCommitSecretGate`)**: Intercepts autonomous agent git payloads and blocks leaking commits fail-closed (`BLOCKED: SECRET_LEAK_PREVENTED`).
  - **Zero Leak Guarantee**: **0 canary tokens harvested, 1 leaking commit blocked, 0 secrets exposed in public repositories**.

### Layer 2: DISTRIB Formal State-Space Proof (`baseline.config.json`)
- **Baseline Audit**: Formally **`BLOCKED`** at Depth 1 (`evaluationsCount: 4`, Duration: ~30.97ms).
- **Hardened Verification**: Formally **`APPROVED`** across **3,907 state permutations** (`NO_FAILURE_WITHIN_BOUND`, Duration: ~2,181.97ms).
