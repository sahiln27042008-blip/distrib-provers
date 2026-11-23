# Prover 15: PlayStation Network GTA VI Pre-Launch Mandatory Update Thundering Herd

> **Deterministic Reproduction & Formal Invariant Proof**  
> *Target Architecture*: Global Gaming Edge Ingress Gateways, Binary Firmware CDN Distribution, Digital Entitlement Verification, Multi-Generation Platform Routing  
> *Incident Impact*: Nearly 3-hour global outage (12:58 p.m.–3:45 p.m. ET on Nov 18, 2026). Hours ahead of the GTA VI midnight unlock, a mandatory PS5 system software update caused a global synchronized thundering herd. Shared ingress connection queues saturated, starving critical account authentication and license verification across all console generations (PS5, PS4, PS3, PS Vita, and Cloud Game Streaming).

---

## 1. Quickstart (1-Command Reproduction)

Run the full dual-layer prover (Native Thundering Herd Reproduction + DISTRIB Formal Proof):

```bash
# Requires Node.js >= 22.6.0 (Zero external dependencies)
npm test
```

---

## 2. What This Prover Proves

### Layer 1: Native Code Component Test (`src/thundering-herd.ts`)
- Recreates 1,000 gaming and authentication requests: 500 heavy PS5 mandatory firmware chunk downloads and 500 lightweight core auth / license checks from legacy platforms (PS4, PS3, Vita, Streaming).
- Simulates the synchronized midnight pre-launch deadline driving millions of consoles to download firmware simultaneously.
- **Observed Native Failure**:
  - The unpatched gateway routes heavy binary downloads and lightweight authentication through a monolithic shared ingress queue.
  - **100% queue exhaustion**: Binary chunk downloads monopolize all gateway connection slots.
  - **Collateral cascade**: 500 of 500 legacy platform requests are starved and dropped, taking down unrelated platforms (PS3, PS4, Vita, and game streaming).
- **Patched Native Resolution (`src/thundering-herd.patched.ts`)**:
  - Implements **Ingress Bulkheading**: Enforces dedicated, isolated capacity pools for critical core authentication.
  - Implements **Adaptive Jitter & Rate Limiting** for binary firmware chunks.
  - Implements **Priority Load Shedding**: Sheds low-priority background downloads during surges while guaranteeing 100% entitlement throughput.
  - Preserves 100% availability: **1,000 of 1,000 requests complete, 0 legacy platform failures, bounded queue saturation at 42.5%**.

### Layer 2: DISTRIB Formal State-Space Proof (`baseline.config.json`)
- **Baseline Audit**: Formally **`BLOCKED`** at Depth 1 (`evaluationsCount: 3`, `SATURATE` on `psn-shared-ingress-gateway`).
- **Hardened Verification**: Formally **`APPROVED`** across **1,123 state permutations** (`NO_FAILURE_WITHIN_BOUND`).
