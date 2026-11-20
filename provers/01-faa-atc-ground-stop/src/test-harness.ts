/**
 * FAA ERAM Nationwide Ground Stop: Prover Test Harness
 * 
 * Executes:
 * 1. Native Code Reproduction of Buffer Overflow & ARTCC Desync
 * 2. Native Code Verification of Hardened Token Bucket Router
 * 3. Formal DISTRIB Bounded Model Proof across 1,191 State Perturbations
 */

import assert from 'node:assert'
import { ATCRouterUnpatched } from './atc-router.ts'
import type { FlightStripUpdate } from './atc-router.ts'
import { ATCRouterPatched } from './atc-router.patched.ts'
import { resolve } from 'node:path'

// Import DISTRIB Core engine
import { runAuditOnConfig, runVerifyOnConfig } from '../../../packages/distrib-core/src/api.ts'

const ALL_ARTCC_CENTERS = [
  'ZBW', 'ZNY', 'ZDC', 'ZTL', 'ZAU', 'ZMP', 'ZKC', 'ZME',
  'ZHU', 'ZFW', 'ZDV', 'ZLC', 'ZSE', 'ZOA', 'ZLA', 'ZAB', 'ZJX',
  'ZOB', 'ZID', 'ZMA', 'ZAN', 'ZHN'
]

const AFFECTED_TRANSIT_CENTERS = [
  'ZBW', 'ZNY', 'ZDC', 'ZTL', 'ZAU', 'ZMP', 'ZKC', 'ZME',
  'ZHU', 'ZFW', 'ZDV', 'ZLC', 'ZSE', 'ZOA', 'ZLA', 'ZAB', 'ZJX'
]

async function run() {
  console.log('='.repeat(78))
  console.log(' BOUNDED INGRESS PROVER: FAA NATIONWIDE GROUND STOP (Nov 13, 2026)')
  console.log('='.repeat(78))

  // --------------------------------------------------------------------------
  // PHASE 1: NATIVE CODE REPRODUCTION (UNPATCHED BUFFER OVERFLOW)
  // --------------------------------------------------------------------------
  console.log('\n[PHASE 1] Executing Native Component Failure Simulation...')
  const unpatchedRouter = new ATCRouterUnpatched(ALL_ARTCC_CENTERS, AFFECTED_TRANSIT_CENTERS)
  const TOTAL_PACKETS = 1000

  for (let i = 1; i <= TOTAL_PACKETS; i++) {
    const update: FlightStripUpdate = {
      flightId: `UAL${100 + (i % 200)}`,
      altitudeFeet: 30000 + (i * 10),
      headingDegrees: (i * 15) % 360,
      squawkCode: `12${(i % 80).toString().padStart(2, '0')}`,
      sequenceId: i,
    }
    unpatchedRouter.submitUpdate(update)
  }

  unpatchedRouter.drainAndBroadcast()
  const desyncedCenters = unpatchedRouter.getDesynchronizedCenters(TOTAL_PACKETS)

  console.log(`  - Dispatched Packets: ${TOTAL_PACKETS}`)
  console.log(`  - Dropped Packets: ${unpatchedRouter.droppedPackets} (${(unpatchedRouter.droppedPackets / TOTAL_PACKETS * 100).toFixed(1)}% loss)`)
  console.log(`  - Desynchronized ARTCC Centers: ${desyncedCenters.length} of ${ALL_ARTCC_CENTERS.length}`)

  assert.strictEqual(unpatchedRouter.droppedPackets, 950, 'Buffer must overflow and drop exactly 950 packets')
  assert.strictEqual(desyncedCenters.length, 17, '17 transit-connected ARTCC centers must desynchronize under unpatched router')
  console.log('  -> [VERIFIED FAILURE] Unpatched ERAM router reproduces nationwide state drift.')

  // --------------------------------------------------------------------------
  // PHASE 2: NATIVE CODE PATCH VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n[PHASE 2] Executing Patched Component Verification (Token Bucket + Fences)...')
  const patchedRouter = new ATCRouterPatched(ALL_ARTCC_CENTERS)

  for (let i = 1; i <= TOTAL_PACKETS; i++) {
    const update: FlightStripUpdate = {
      flightId: `UAL${100 + (i % 200)}`,
      altitudeFeet: 30000 + (i * 10),
      headingDegrees: (i * 15) % 360,
      squawkCode: `12${(i % 80).toString().padStart(2, '0')}`,
      sequenceId: i,
    }
    patchedRouter.submitUpdate(update)
  }

  patchedRouter.drainAndBroadcast()
  const patchedDesynced = patchedRouter.getDesynchronizedCenters(TOTAL_PACKETS)

  console.log(`  - Dispatched Packets: ${TOTAL_PACKETS}`)
  console.log(`  - Dropped Packets: ${patchedRouter.droppedPackets}`)
  console.log(`  - Desynchronized ARTCC Centers: ${patchedDesynced.length} of ${ALL_ARTCC_CENTERS.length}`)

  assert.strictEqual(patchedRouter.droppedPackets, 0, 'Patched router must not silently drop flight strips')
  assert.strictEqual(patchedDesynced.length, 0, 'Zero ARTCC centers desynchronized under patched router')
  console.log('  -> [VERIFIED RESOLUTION] Concrete TypeScript patch maintains linearizable national air state.')

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
  console.error('\nPROVER FAILED WITH ERROR:', err)
  process.exit(1)
})
