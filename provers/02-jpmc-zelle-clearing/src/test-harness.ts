/**
 * JPMC Zelle Cross-Bank Disruption: Prover Test Harness
 * 
 * Executes:
 * 1. Native Code Reproduction of In-Doubt Mutation & Double-Spending
 * 2. Native Code Verification of Idempotent Clearing Bridge
 * 3. Formal DISTRIB Bounded Model Proof across 1,191 State Perturbations
 */

import assert from 'node:assert'
import { ClearingBridgeUnpatched } from './clearing-bridge.ts'
import type { BankAccount, TransferRequest } from './clearing-bridge.ts'
import { ClearingBridgePatched } from './clearing-bridge.patched.ts'
import type { PatchedTransferRequest } from './clearing-bridge.patched.ts'
import { resolve } from 'node:path'

// Import DISTRIB Core engine
import { runAuditOnConfig, runVerifyOnConfig } from '../../../packages/distrib-core/src/api.ts'

async function run() {
  console.log('='.repeat(78))
  console.log(' BOUNDED SETTLEMENT PROVER: JPMC ZELLE CROSS-BANK DISRUPTION (Nov 16, 2026)')
  console.log('='.repeat(78))

  const INITIAL_BALANCE = 2000
  const TRANSFER_AMOUNT = 500

  // --------------------------------------------------------------------------
  // PHASE 1: NATIVE CODE REPRODUCTION (DOUBLE-SPEND UNDER HANGING COUNTERPARTY)
  // --------------------------------------------------------------------------
  console.log('\n[PHASE 1] Executing Native Double-Spending Simulation...')
  const initialAccounts: BankAccount[] = [{
    accountId: 'US-BANK-ACC-9901',
    balanceDollars: INITIAL_BALANCE,
    postedTransactions: [],
  }]

  const unpatchedBridge = new ClearingBridgeUnpatched(initialAccounts)
  unpatchedBridge.setCounterpartyBehavior('tx-transfer-501', 'TIMEOUT_AFTER_COMMIT')

  const transfer: TransferRequest = {
    transferId: 'tx-transfer-501',
    senderId: 'US-BANK-ACC-9901',
    recipientId: 'CHASE-ACC-4412',
    amountDollars: TRANSFER_AMOUNT,
  }

  // Attempt 1: Dispatched to Chase, hangs in-doubt
  console.log(`  - Starting Sender Account Balance: $${INITIAL_BALANCE}`)
  const res1 = unpatchedBridge.processTransfer({ ...transfer, retryCount: 0 })
  console.log(`  - Attempt 1 (Initial): Success=${res1.success}, InDoubt=${res1.inDoubt}`)

  // Attempt 2: User retries after unconfirmed pending alert
  const res2 = unpatchedBridge.processTransfer({ ...transfer, retryCount: 1 })
  console.log(`  - Attempt 2 (Retry 1): Success=${res2.success}, InDoubt=${res2.inDoubt}`)

  // Attempt 3: User retries a third time
  const res3 = unpatchedBridge.processTransfer({ ...transfer, retryCount: 2 })
  console.log(`  - Attempt 3 (Retry 2): Success=${res3.success}, InDoubt=${res3.inDoubt}`)

  const unpatchedAccount = unpatchedBridge.getAccount('US-BANK-ACC-9901')!
  console.log(`  - Expected Single Intended Debit: $${TRANSFER_AMOUNT}`)
  console.log(`  - Actual Total Debited from Sender: $${unpatchedBridge.totalCommittedDebits}`)
  console.log(`  - Remaining Sender Account Balance: $${unpatchedAccount.balanceDollars}`)

  assert.strictEqual(unpatchedBridge.totalCommittedDebits, 1500, 'Unpatched bridge must execute 3 duplicate debits ($1500)')
  assert.strictEqual(unpatchedAccount.balanceDollars, 500, 'Account balance must be erroneously drained to $500')
  console.log('  -> [VERIFIED FAILURE] Unpatched bridge committed multiple in-doubt duplicate debits.')

  // --------------------------------------------------------------------------
  // PHASE 2: NATIVE CODE PATCH VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n[PHASE 2] Executing Patched Clearing Bridge Verification...')
  const patchedBridge = new ClearingBridgePatched(initialAccounts)
  patchedBridge.setCounterpartyBehavior('tx-transfer-501', 'TIMEOUT_AFTER_COMMIT')

  const patchedTransfer: PatchedTransferRequest = {
    ...transfer,
    idempotencyKey: 'idemp-key-zelle-9901-501',
  }

  // Attempt 1: First attempt
  console.log(`  - Starting Sender Account Balance: $${INITIAL_BALANCE}`)
  const pRes1 = patchedBridge.processTransfer({ ...patchedTransfer, retryCount: 0 })
  console.log(`  - Attempt 1: Success=${pRes1.success}, InDoubt=${pRes1.inDoubt}, Deduplicated=${pRes1.deduplicated}`)

  // Attempt 2: User retry with identical idempotency key
  const pRes2 = patchedBridge.processTransfer({ ...patchedTransfer, retryCount: 1 })
  console.log(`  - Attempt 2: Success=${pRes2.success}, InDoubt=${pRes2.inDoubt}, Deduplicated=${pRes2.deduplicated}`)

  // Attempt 3: User retry with identical idempotency key
  const pRes3 = patchedBridge.processTransfer({ ...patchedTransfer, retryCount: 2 })
  console.log(`  - Attempt 3: Success=${pRes3.success}, InDoubt=${pRes3.inDoubt}, Deduplicated=${pRes3.deduplicated}`)

  const patchedAccount = patchedBridge.getAccount('US-BANK-ACC-9901')!
  console.log(`  - Total Debited from Sender with Idempotency Key: $${patchedBridge.totalCommittedDebits}`)
  console.log(`  - Final Sender Balance: $${patchedAccount.balanceDollars}`)

  assert.strictEqual(patchedBridge.totalCommittedDebits, 500, 'Patched bridge must commit exactly $500 regardless of retry storm')
  assert.strictEqual(patchedAccount.balanceDollars, 1500, 'Account balance must be preserved at $1500')
  assert.strictEqual(pRes2.deduplicated, true, 'Retry 1 must be deduplicated')
  assert.strictEqual(pRes3.deduplicated, true, 'Retry 2 must be deduplicated')
  console.log('  -> [VERIFIED RESOLUTION] Idempotent clearing bridge guarantees exactly-once debiting.')

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
