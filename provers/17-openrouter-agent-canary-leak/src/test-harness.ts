/**
 * OpenRouter Canary-Token Breach & AI Agent Public Commit Leak: Prover Test Harness
 * 
 * Executes:
 * 1. Native Code Reproduction of Multi-Hop Reseller Privacy Leaks & AI Agent Git Commits
 * 2. Native Code Verification of Egress Trust Boundaries & Pre-Commit Secret Gates
 * 3. Formal DISTRIB Bounded Model Proof across 1,100+ State Permutations
 */

import assert from 'node:assert'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MultiHopRouterPlatformUnpatched } from './router-leak.ts'
import type { GitCommitPayload, LLMPromptRequest } from './router-leak.ts'
import { MultiHopRouterPlatformPatched } from './router-leak.patched.ts'

// Import DISTRIB Core engine
import { runAuditOnConfig, runVerifyOnConfig } from '../../../packages/distrib-core/src/api.ts'

async function run() {
  console.log('='.repeat(78))
  console.log(' BOUNDED PROVER: OPENROUTER CANARY LEAK & AI AGENT SECRET COMMIT (2026)')
  console.log('='.repeat(78))

  const TOTAL_PROMPTS = 200
  const CANARY_COUNT = 20

  console.log(`\nGenerating batch of ${TOTAL_PROMPTS} prompts (${CANARY_COUNT} Dragos canary tokens)...`)
  const prompts: LLMPromptRequest[] = []

  for (let i = 1; i <= TOTAL_PROMPTS; i++) {
    const isCanary = i <= CANARY_COUNT
    prompts.push({
      requestId: `req-prompt-${i}`,
      clientTenantId: `tenant-${(i % 10) + 1}`,
      promptText: isCanary
        ? `Analyze system telemetry with AWS key AKIA_CANARY_DRAGOS_${i} and beacon https://canary.dragos.io/token/${i}`
        : `Summarize quarterly infrastructure health report for cluster ${i}`,
      zeroDataRetentionRequested: true,
      canaryCredential: isCanary ? {
        accessKeyId: `AKIA_CANARY_DRAGOS_${i}`,
        secretAccessKey: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY${i}`,
        canaryBeaconUrl: `https://canary.dragos.io/token/${i}`
      } : undefined
    })
  }

  const agentCommitPayload: GitCommitPayload = {
    commitId: 'commit-agent-44a9f',
    author: 'AUTONOMOUS_CODING_AGENT',
    repository: 'togethercomputer/public-evaluation-benchmarks',
    isPublicRepo: true,
    filesChanged: {
      'eval_benchmarks.py': 'import os\nprint("Running automated benchmarks...")',
      'dataset_config.json': '{\n  "private_hf_token": "hf_private_repo_token_archive_june_july_prompts_9182",\n  "repo": "togethercomputer/eval-archive-private"\n}'
    }
  }

  // --------------------------------------------------------------------------
  // PHASE 1: NATIVE CODE REPRODUCTION (UNPATCHED MULTI-HOP PRIVACY BLEED & GIT LEAK)
  // --------------------------------------------------------------------------
  console.log('\n[PHASE 1] Executing Unpatched Multi-Hop Router & Agent Git Simulation...')
  const unpatchedRouter = new MultiHopRouterPlatformUnpatched()

  // Route 200 prompts across unverified reseller pool
  for (const prompt of prompts) {
    unpatchedRouter.routePrompt(prompt)
  }

  // Agent pushes commit directly to public repository
  unpatchedRouter.agentCommitCode(agentCommitPayload)

  // Evaluate attacker harvesting
  const unpatchedResult = unpatchedRouter.evaluateExposure(TOTAL_PROMPTS, CANARY_COUNT)

  console.log(`  - Dispatched LLM Prompts: ${unpatchedResult.totalPromptsDispatched}`)
  console.log(`  - Seeded Dragos Canary Tokens: ${unpatchedResult.canaryTokensDispatched}`)
  console.log(`  - Reseller Providers Offboarded for Leaking: ${unpatchedResult.offboardedProvidersCount} of 3 Resellers`)
  console.log(`  - Canary AWS Keys Harvested by Attackers: ${unpatchedResult.canaryTokensHarvestedByAttacker}`)
  console.log(`  - Unauthorized AWS STS Calls Triggered: ${unpatchedResult.unauthorizedStsExecutions}`)
  console.log(`  - Agent Commits Pushed to Public GitHub: ${unpatchedResult.publicCommitsPushed}`)
  console.log(`  - Private Hugging Face Credentials Exposed: ${unpatchedResult.secretsExposedInPublicRepo}`)
  console.log(`  - Supply Chain Posture: [ ${unpatchedResult.status} ]`)

  assert.strictEqual(unpatchedResult.status, 'COMPROMISED', 'Unpatched router must suffer privacy compromise')
  assert.ok(unpatchedResult.canaryTokensHarvestedByAttacker > 0, 'Must harvest canary tokens across leaking resellers')
  assert.strictEqual(unpatchedResult.secretsExposedInPublicRepo, 1, 'Must leak 1 private Hugging Face credential to public GitHub')
  console.log('  -> [VERIFIED FAILURE] Multi-hop resellers violated ZDR and agent leaked private credential.')

  // --------------------------------------------------------------------------
  // PHASE 2: NATIVE CODE PATCH VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n[PHASE 2] Executing Patched Router with Egress Boundaries & Pre-Commit Gates...')
  const patchedRouter = new MultiHopRouterPlatformPatched()

  // Route 200 prompts through certified non-retention endpoints
  for (const prompt of prompts) {
    patchedRouter.routePrompt(prompt)
  }

  // Agent attempts commit with credential
  patchedRouter.agentCommitCode(agentCommitPayload)

  const patchedResult = patchedRouter.evaluateExposure(TOTAL_PROMPTS, CANARY_COUNT, 1)

  console.log(`  - Dispatched LLM Prompts: ${patchedResult.totalPromptsDispatched}`)
  console.log(`  - Seeded Dragos Canary Tokens: ${patchedResult.canaryTokensDispatched}`)
  console.log(`  - Certified Hardware-ZDR Endpoints: ${patchedResult.activeZdrCompliantEndpoints}`)
  console.log(`  - Canary Tokens Harvested by Attackers: ${patchedResult.canaryTokensHarvestedByAttacker}`)
  console.log(`  - Blocked Leaking Git Commits: ${patchedResult.blockedLeakingCommits}`)
  console.log(`  - Secrets Exposed in Public Repositories: ${patchedResult.secretsExposedInPublicRepo}`)
  console.log(`  - Supply Chain Posture: [ ${patchedResult.status} ]`)

  assert.strictEqual(patchedResult.status, 'SECURED', 'Patched router must remain fully secured')
  assert.strictEqual(patchedResult.canaryTokensHarvestedByAttacker, 0, 'Zero canary tokens must be harvested')
  assert.strictEqual(patchedResult.blockedLeakingCommits, 1, 'Must block 1 leaking commit at pre-commit gate')
  assert.strictEqual(patchedResult.secretsExposedInPublicRepo, 0, 'Zero credentials exposed in public repos')
  console.log('  -> [VERIFIED RESOLUTION] Egress boundary gate and pre-commit scanner preserved complete privacy.')

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
  const verifyEvals = verifyResult.evaluationsCount ?? 0
  const verifyDuration = verifyResult.durationMs ?? 0
  console.log(`  - Hardened Verify Verdict: [ GATE: ${verifyResult.verdict} ] (Evaluations: ${verifyEvals}, Duration: ${verifyDuration.toFixed(2)}ms)`)
  console.log(`  - Invariant Status: ${verifyResult.status}`)
  assert.strictEqual(verifyResult.verdict, 'APPROVED', 'DISTRIB Hardened model must be formally APPROVED')
  assert.strictEqual(verifyResult.status, 'NO_FAILURE_WITHIN_BOUND', 'Must find zero invariant violations within bound')

  // Freeze artifact receipts
  writeFileSync(resolve(import.meta.dirname, '../audit.json'), JSON.stringify(auditResult, null, 2))
  writeFileSync(resolve(import.meta.dirname, '../verify.json'), JSON.stringify(verifyResult, null, 2))
  console.log('  -> [VERIFIED FORMAL PROOF] Formal state-space gate passed with zero invariant violations.')

  console.log('\n' + '='.repeat(78))
  console.log(' PROVER 17 RUN COMPLETE: ALL ASSERTIONS PASSED')
  console.log('='.repeat(78))
}

run().catch((err) => {
  console.error('PROVER EXECUTION FAILED:', err)
  process.exit(1)
})
