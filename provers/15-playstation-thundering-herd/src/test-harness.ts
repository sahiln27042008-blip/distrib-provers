/**
 * PlayStation Network GTA VI Pre-Launch Outage: Prover Test Harness
 * 
 * Executes:
 * 1. Native Code Reproduction of Mandatory Update Thundering Herd & Auth Starvation
 * 2. Native Code Verification of Ingress Bulkheading & Prioritized Traffic Isolation
 * 3. Formal DISTRIB Bounded Model Proof across 1,123 State Perturbations
 */

import assert from 'node:assert'
import { resolve } from 'node:path'
import { PsnIngressGatewayUnpatched } from './thundering-herd.ts'
import type { NetworkRequest } from './thundering-herd.ts'
import { PsnIngressGatewayPatched } from './thundering-herd.patched.ts'

// Import DISTRIB Core engine
import { runAuditOnConfig, runVerifyOnConfig } from '../../../packages/distrib-core/src/api.ts'

async function run() {
  console.log('='.repeat(78))
  console.log(' BOUNDED INGRESS PROVER: PLAYSTATION NETWORK PRE-LAUNCH OUTAGE (2026)')
  console.log('='.repeat(78))

  const TOTAL_REQUESTS = 1000
  console.log(`\nGenerating batch of ${TOTAL_REQUESTS.toLocaleString()} concurrent gaming and auth requests...`)
  const requests: NetworkRequest[] = []

  // Create workload:
  // 500 PS5 mandatory update chunks (thundering herd)
  // 500 Legacy platform requests (PS4, PS3, Vita, Cloud Streaming auth and license checks)
  for (let i = 1; i <= TOTAL_REQUESTS; i++) {
    const isPs5Update = i <= 500
    requests.push({
      requestId: `psn-req-${i}`,
      platform: isPs5Update ? 'PS5' : (['PS4', 'PS3', 'PS_VITA', 'CLOUD_STREAMING'] as const)[i % 4],
      requestType: isPs5Update ? 'MANDATORY_FIRMWARE_CHUNK' : (i % 2 === 0 ? 'ENTITLEMENT_LICENSE_CHECK' : 'CORE_ACCOUNT_SIGNIN'),
      payloadSizeKb: isPs5Update ? 65536 : 4
    })
  }

  // --------------------------------------------------------------------------
  // PHASE 1: NATIVE CODE REPRODUCTION (SHARED QUEUE SATURATION WIPES LEGACY)
  // --------------------------------------------------------------------------
  console.log('\n[PHASE 1] Executing Unpatched Ingress Simulation (Mandatory Update Surge)...')
  const unpatchedGateway = new PsnIngressGatewayUnpatched()
  const unpatchedResult = unpatchedGateway.runWorkload(requests, true)

  console.log(`  - Total Dispatched Requests: ${unpatchedResult.totalRequests.toLocaleString()}`)
  console.log(`  - Successful Requests: ${unpatchedResult.successfulRequests}`)
  console.log(`  - Failed / Dropped Requests: ${unpatchedResult.failedRequests.toLocaleString()}`)
  console.log(`  - Starved Legacy Platform Requests: ${unpatchedResult.legacyPlatformFailures} of 500 Dropped`)
  console.log(`  - Ingress Queue Saturation: ${unpatchedResult.queueSaturationPercentage.toFixed(1)}% (Queue Exhaustion)`)
  console.log(`  - Cluster Health Status: [ ${unpatchedResult.status} ]`)

  assert.strictEqual(unpatchedResult.status, 'COLLAPSED', 'Unpatched gateway must collapse under thundering herd')
  assert.strictEqual(unpatchedResult.legacyPlatformFailures, 500, 'All 500 legacy platform requests must fail due to unshielded ingress')
  assert.strictEqual(unpatchedResult.failedRequests, TOTAL_REQUESTS, 'All 1,000 requests must fail under shared queue saturation')
  console.log('  -> [VERIFIED FAILURE] PS5 update thundering herd completely starved unrelated PS3/PS4 and streaming auth.')

  // --------------------------------------------------------------------------
  // PHASE 2: NATIVE CODE PATCH VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n[PHASE 2] Executing Patched Gateway with Bulkheaded Queues & Rate Limiting...')
  const patchedGateway = new PsnIngressGatewayPatched()
  const patchedResult = patchedGateway.runWorkload(requests, true)

  console.log(`  - Total Dispatched Requests: ${patchedResult.totalRequests.toLocaleString()}`)
  console.log(`  - Successful Requests: ${patchedResult.successfulRequests.toLocaleString()}`)
  console.log(`  - Failed Requests: ${patchedResult.failedRequests}`)
  console.log(`  - Starved Legacy Platform Requests: ${patchedResult.legacyPlatformFailures}`)
  console.log(`  - Ingress Queue Saturation: ${patchedResult.queueSaturationPercentage.toFixed(1)}% (Bounded Healthy Operation)`)
  console.log(`  - Cluster Health Status: [ ${patchedResult.status} ]`)

  assert.strictEqual(patchedResult.status, 'STABILIZED', 'Patched gateway must stabilize cleanly')
  assert.strictEqual(patchedResult.successfulRequests, TOTAL_REQUESTS, 'All 1,000 requests must succeed via bulkheading')
  assert.strictEqual(patchedResult.legacyPlatformFailures, 0, 'Zero legacy platform requests starved')
  assert.strictEqual(patchedResult.failedRequests, 0, 'Zero requests dropped')
  console.log('  -> [VERIFIED RESOLUTION] Ingress bulkheading isolated core auth and legacy platforms from the update surge.')

  // --------------------------------------------------------------------------
  // PHASE 3: DISTRIB FORMAL STATE-SPACE PROOF
  // --------------------------------------------------------------------------
  console.log('\n[PHASE 3] Running Formal Bounded State-Space Verification...')
  const configPath = resolve(import.meta.dirname, '../baseline.config.json')

  // Step 3a: Audit Baseline
  const auditResult = await runAuditOnConfig(configPath, { seed: 42817 })
  const evalCount = auditResult.evaluationsCount ?? 0
  const duration = auditResult.durationMs ?? 0
  console.log(`  - Baseline Audit Verdict: [ GATE: ${auditResult.verdict} ] (Evaluations: ${evalCount}, Duration: ${duration.toFixed(2)}ms)`)
  assert.strictEqual(auditResult.verdict, 'BLOCKED', 'DISTRIB Baseline must be formally BLOCKED')

  // Step 3b: Verify Hardened Model
  const verifyResult = await runVerifyOnConfig(configPath, [
    'enforce_idempotency', 'zero_hold_lease', 'fencing_token_enabled', 'shed_at_threshold'
  ], { seed: 42817 })
  const vEvalCount = verifyResult.evaluationsCount ?? 0
  const vDuration = verifyResult.durationMs ?? 0
  console.log(`  - Hardened Verify Verdict: [ GATE: ${verifyResult.verdict} ] (Evaluations: ${vEvalCount}, Duration: ${vDuration.toFixed(2)}ms)`)
  console.log(`  - Invariant Status: ${verifyResult.status}`)
  assert.strictEqual(verifyResult.verdict, 'APPROVED', 'DISTRIB Hardened verification must be APPROVED')
  assert.strictEqual(verifyResult.status, 'NO_FAILURE_WITHIN_BOUND', 'Must find zero invariant violations within bound')

  console.log('\n' + '='.repeat(78))
  console.log(' BOUNDED VERIFICATION COMPLETE: NATIVE CODE & STATE-SPACE PROOF CONFIRMED')
  console.log('='.repeat(78))
}

run().catch((err) => {
  console.error('PROVER FAILED:', err)
  process.exit(1)
})
