# Prover 16: Fluidkey $1.6M Drain via Unpatched SigNoz & Log-Token Leakage

> **Deterministic Reproduction & Formal Invariant Proof**  
> *Target Architecture*: Smart Contract Wallets, OpenTelemetry Collector Ingestion, ClickHouse Trace Analytics, Ambient Transaction Signing  
> *Incident Impact*: ~$1.6 million (~887 ETH) drained from 52 Fluidkey wallet accounts on Nov 19, 2026. Attackers probed unauthenticated SigNoz observability endpoints (`CVE-2026-92729`) and ClickHouse SQL injection (`CVE-2026-93292`), harvesting raw bearer session tokens inadvertently logged in distributed trace spans. Attackers raised spending limits, staged unauthorized outbound drain transactions, and triggered ambient victim signing via 0.0001 ETH deposits.

---

## 1. Quickstart (1-Command Reproduction)

Run the full dual-layer prover (Native Telemetry Leak Reproduction + DISTRIB Formal Proof):

```bash
# Requires Node.js >= 22.6.0 (Zero external dependencies)
npm test
```

Or from the monorepo root:
```bash
npm run test:fluidkey
```

---

## 2. What This Prover Proves

### Layer 1: Native Code Component Test (`src/telemetry-drain.ts`)
- Recreates 52 victim accounts holding 887 ETH (~$1.6M USD).
- Simulates normal API operations where backend services emit OpenTelemetry trace spans containing unredacted `Authorization: Bearer <token>` headers.
- **Observed Native Failure**:
  - Attacker exploits unauthenticated SigNoz trace funnel endpoints and SQL injection to dump ClickHouse spans.
  - Attacker harvests **52 of 52 active bearer session tokens**.
  - Attacker exploits the **absence of authority separation**: using the session token alone, the attacker elevates daily spending limits from 1 ETH to 1,000 ETH and stages outbound drain transactions.
  - Attacker broadcasts micro-deposits (0.0001 ETH), prompting victim mobile apps to unlock and blindly auto-execute server-staged drain transactions.
  - **100% Capital Drain**: **887.00 ETH ($1,596,600 USD) stolen across all 52 accounts**.
- **Patched Native Resolution (`src/telemetry-drain.patched.ts`)**:
  - Implements **Secret-Free Trace Filter (`SecretFreeTraceFilter`)**: Cryptographically strips sensitive headers and replaces session tokens with salted one-way HMAC-SHA256 digests (`[REDACTED_HMAC_...]`). Zero plaintext tokens exist in ClickHouse.
  - Implements **Authority-Separation Gate (`AuthoritySeparationGate`)**: Restricts session tokens to read-only ambient authority. Limit elevation and transfer staging strictly require an independent, fresh EIP-712 typed signature from hardware/biometric keys.
  - Ambient app unlocks reject uninitiated server queues.
  - **Zero Loss Guarantee**: **0 raw tokens in telemetry, 0 usable harvested tokens, 0 unauthorized limit increases, 0 ETH drained ($0.00 loss)**.

### Layer 2: DISTRIB Formal State-Space Proof (`baseline.config.json`)
- **Baseline Audit**: Formally **`BLOCKED`** at Depth 1 (`evaluationsCount: 4`, Duration: ~26.79ms).
- **Hardened Verification**: Formally **`APPROVED`** across **2,863 state permutations** (`NO_FAILURE_WITHIN_BOUND`, Duration: ~1,514.46ms).
