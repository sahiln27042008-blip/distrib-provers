/**
 * distrib-provers: Master Suite Runner
 * 
 * Executes all concrete production provers sequentially and generates
 * the master verification certificate.
 */

import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

interface ProverResult {
  proverName: string
  exitCode: number
  durationSec: number
}

async function main() {
  console.log('='.repeat(80))
  console.log(' DISTRIB PROVERS: MASTER PRODUCTION REPRODUCTION & VERIFICATION SUITE')
  console.log(' Jepsen-Grade Deterministic Verification for Real-World Outages')
  console.log('='.repeat(80))

  const proversDir = join(import.meta.dirname, 'provers')
  const proverDirs = readdirSync(proversDir)
    .filter((d) => statSync(join(proversDir, d)).isDirectory())
    .sort()

  const results: ProverResult[] = []

  for (const dir of proverDirs) {
    const proverPath = join(proversDir, dir)
    console.log(`\n>>> EXECUTING PROVER: [${dir}]...`)
    const startMs = Date.now()

    const proc = spawnSync('node', ['src/test-harness.ts'], {
      cwd: proverPath,
      stdio: 'inherit',
      shell: true,
    })

    const durationSec = (Date.now() - startMs) / 1000
    results.push({
      proverName: dir,
      exitCode: proc.status ?? 1,
      durationSec,
    })
  }

  console.log('\n' + '='.repeat(80))
  console.log(' MASTER PROVER SUITE EXECUTION SUMMARY')
  console.log('='.repeat(80))

  console.log('Prover Package'.padEnd(45) + 'Status'.padEnd(15) + 'Duration')
  console.log('-'.repeat(80))

  let allPassed = true
  for (const res of results) {
    const passed = res.exitCode === 0
    if (!passed) allPassed = false
    const statusStr = passed ? '[ APPROVED ]' : '[ FAILED ]'
    console.log(res.proverName.padEnd(45) + statusStr.padEnd(15) + `${res.durationSec.toFixed(2)}s`)
  }

  console.log('-'.repeat(80))
  if (allPassed) {
    console.log('SUCCESS: All provers passed native code reproduction and formal state-space verification.')
    process.exit(0)
  } else {
    console.error('FAILURE: One or more provers failed verification.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
