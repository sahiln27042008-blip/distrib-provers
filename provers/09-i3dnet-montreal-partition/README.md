# Prover 09: i3D.net Smartdc Montreal Post-Partition Coordination Deadlock

Deterministic reproduction and formal state-space verification prover for the **i3D.net Smartdc Montreal (camtr6) Post-Partition Deadlock** (November 17–18, 2026).

---

## Failure Scenario Summary

* **Incident:** Network partition severed external and internal transit paths. Five hours later, physical Layer 3 connectivity was restored (BGP converged, ICMP pings succeeded, TCP handshakes established).
* **The Coordination Trap:** Despite full Layer 3 recovery, internal microservices (VM hypervisors, hosting APIs, storage nodes, game servers) remained unreachable and deadlocked for **11 hours**.
* **Root Cause:** Surviving cluster nodes had diverged in term states and expired split-brain leases. When services reconnected, the lack of an automated standalone mode fallback left the daemons waiting indefinitely on broken RPC pairings. Daemons launched an unthrottled reconnect storm (`DUPLICATION count: 3`), saturating the coordinator ingress buffer and locking the datacenter in a thundering-herd feedback loop.
* **Resolution:** In production, engineers had to manually override the central coordinator on individual servers after 11 hours and boot in isolated "standalone mode". The patch automates this fallback upon discovery lease expiration.

---

## Architecture & Verification Phases

1. **Phase 1: Native Failure Reproduction (`src/cluster-coordinator.ts`)**
   - Simulates 50 datacenter daemons across hypervisors, APIs, and game server controllers.
   - Induces partition, then restores Layer 3 transit.
   - Shows that unpatched daemons deadlock awaiting central consensus, dropping reconnect packets and leaving 100% of services offline for 11 simulated hours.

2. **Phase 2: Native Resolution Verification (`src/cluster-coordinator.patched.ts`)**
   - Implements automated discovery lease expiration and fallback to standalone mode.
   - Daemons detect consensus discovery timeout, decouple from central coordination leases, and boot locally with deduplicated nonces.
   - Verifies 100% of services boot successfully with 0 deadlocks and immediate (<5s) recovery.

3. **Phase 3: Formal DISTRIB Bounded Model Proof (`packages/distrib-core`)**
   - Baseline Audit (`runAuditOnConfig`): Formally **`BLOCKED`** violating invariant `r04-network-idempotency`.
   - Verified Patch (`runVerifyOnConfig`): Formally **`APPROVED`** across 1,123 state perturbations (`NO_FAILURE_WITHIN_BOUND`) under ablations `enforce_idempotency`, `zero_hold_lease`, `fencing_token_enabled`, `shed_at_threshold`.

---

## How to Run

```bash
# Run standalone test harness
node src/test-harness.ts

# Or via npm script
npm test
```
