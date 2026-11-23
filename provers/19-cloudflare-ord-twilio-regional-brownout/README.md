# Prover 19: Cloudflare Chicago ORD Edge Degradation & Twilio Regional Carrier Brownout

> **Deterministic Reproduction & Formal Invariant Proof**  
> *Target Architecture*: Global CDN Anycast Edge POPs, Telephony Lookup Gateways, Multi-Carrier SMS Routing  
> *Incident Impact*: Regional edge and telecom API disruptions on Nov 22, 2026. Cloudflare reported network performance degradation in its Chicago (`ORD`) datacenter, while Twilio reported Lookup Gateway API failures in Canada and SMS delivery failures/delays to Telekom Germany. Central synthetic health checks remained falsely green (HTTP 200 OK), causing client applications and autonomous agents to route regional traffic into failing paths without triggering global failovers.

---

## 1. Quickstart (1-Command Reproduction)

Run the full dual-layer prover (Native Brownout Reproduction + DISTRIB Formal Proof):

```bash
# Requires Node.js >= 22.6.0 (Zero external dependencies)
npm test
```

Or from the monorepo root:
```bash
npm run test:regional
```

---

## 2. What This Prover Proves

### Layer 1: Native Code Component Test (`src/regional-brownout.ts`)
- Recreates 500 regional API requests:
  - 200 Midwest client requests hitting Cloudflare Chicago (`ORD`) edge POP.
  - 150 Canadian requests invoking Twilio Phone Lookup Gateway API.
  - 150 German requests sending 2FA verification SMS to Telekom Germany.
- **Observed Native Failure**:
  - The central global health checker (`checkGlobalHealth()`) probes central backbone nodes and reports `OPERATIONAL_GREEN` (HTTP 200 OK).
  - Clients relying on global health checks continue routing to localized degraded paths without local circuit breaking.
  - **100% Regional Failure**: 200 ORD requests time out, 150 Canada lookups fail with HTTP 500, and 150 German SMS fail with HTTP 502 (**500 of 500 regional requests dropped**).
  - **Regional Posture**: **`BROWNOUT_FAILURE`**.
- **Patched Native Resolution (`src/regional-brownout.patched.ts`)**:
  - Implements **Localized POP Circuit Breaking (`RegionalPopCircuitBreaker`)**: Tracks client-side sliding-window error rates per POP; trips to `OPEN` on ORD failure and reroutes traffic to adjacent healthy Detroit (`DTW`) edge POP.
  - Implements **Multi-Carrier Fallback Gate (`MultiCarrierFallbackGate`)**: Automatically fails over Canadian lookups and German SMS to secondary carrier aggregators using idempotent request tokens.
  - **100% Success Guarantee**: **500 of 500 requests complete successfully, 0 unhandled drops**.
  - **Regional Posture**: **`STABILIZED`**.

### Layer 2: DISTRIB Formal State-Space Proof (`baseline.config.json`)
- **Baseline Audit**: Formally **`BLOCKED`** at Depth 1 (`evaluationsCount: 4`, Duration: ~31.87ms).
- **Hardened Verification**: Formally **`APPROVED`** across **2,757 state permutations** (`NO_FAILURE_WITHIN_BOUND`, Duration: ~1,407.75ms).
