/**
 * OpenRouter Canary-Token Breach & AI Agent Public Commit Leak: Unpatched Simulation
 * 
 * Recreates the dual supply-chain failures:
 * 1. Multi-hop AI Aggregator routing where "ZDR" flags only bound the first hop,
 *    allowing 3 downstream reseller providers to log prompts containing Dragos canary AWS keys.
 * 2. Autonomous coding agent committing private repository credentials (Hugging Face)
 *    directly to a public GitHub repository without pre-commit scanning.
 */

export interface LLMPromptRequest {
  requestId: string
  clientTenantId: string
  promptText: string
  zeroDataRetentionRequested: boolean
  canaryCredential?: {
    accessKeyId: string
    secretAccessKey: string
    canaryBeaconUrl: string
  }
}

export interface InferenceProvider {
  providerId: string
  name: string
  isReseller: boolean
  enforcesZdrContract: boolean
  persistedPromptLogs: string[]
}

export interface GitCommitPayload {
  commitId: string
  author: 'AUTONOMOUS_CODING_AGENT' | 'HUMAN_ENGINEER'
  repository: string
  isPublicRepo: boolean
  filesChanged: Record<string, string>
}

export interface UnpatchedSimulationResult {
  totalPromptsDispatched: number
  canaryTokensDispatched: number
  canaryTokensHarvestedByAttacker: number
  unauthorizedStsExecutions: number
  publicCommitsPushed: number
  secretsExposedInPublicRepo: number
  offboardedProvidersCount: number
  status: 'COMPROMISED' | 'SECURED'
}

export class MultiHopRouterPlatformUnpatched {
  private providers: InferenceProvider[] = []
  private publicGitRepositoryCommits: GitCommitPayload[] = []
  private attackerHarvestedCanaries: string[] = []
  private attackerHarvestedGitSecrets: string[] = []

  constructor() {
    // Setup 5 providers: 2 direct compliant providers, 3 non-compliant resellers
    this.providers = [
      { providerId: 'prov-01', name: 'Direct-Foundry-A', isReseller: false, enforcesZdrContract: true, persistedPromptLogs: [] },
      { providerId: 'prov-02', name: 'Direct-Foundry-B', isReseller: false, enforcesZdrContract: true, persistedPromptLogs: [] },
      { providerId: 'prov-03', name: 'Reseller-Hop-Alpha', isReseller: true, enforcesZdrContract: false, persistedPromptLogs: [] },
      { providerId: 'prov-04', name: 'Reseller-Hop-Beta', isReseller: true, enforcesZdrContract: false, persistedPromptLogs: [] },
      { providerId: 'prov-05', name: 'Reseller-Hop-Gamma', isReseller: true, enforcesZdrContract: false, persistedPromptLogs: [] }
    ]
  }

  /**
   * Router receives client prompts and dispatches to providers.
   * Flaw 1: Router forwards prompts blindly to untrusted resellers even when ZDR=true.
   */
  public routePrompt(request: LLMPromptRequest): void {
    // Unpatched router round-robins across all providers regardless of reseller status
    const targetProviderIndex = Math.floor(Math.random() * this.providers.length)
    const provider = this.providers[targetProviderIndex]

    if (provider.enforcesZdrContract) {
      // Compliant provider obeys ZDR and discards prompt
    } else {
      // FLAW: Reseller ignores ZDR flag and logs full prompt payload to unencrypted disk
      provider.persistedPromptLogs.push(request.promptText)

      // If prompt contained Dragos canary token, it is logged
      if (request.canaryCredential) {
        provider.persistedPromptLogs.push(`CANARY_KEY:${request.canaryCredential.accessKeyId}`)
      }
    }
  }

  /**
   * Attackers probe provider log storage and harvest canary AWS keys.
   */
  public simulateAttackerPromptHarvesting(): void {
    for (const provider of this.providers) {
      if (!provider.enforcesZdrContract) {
        for (const logLine of provider.persistedPromptLogs) {
          if (logLine.startsWith('CANARY_KEY:')) {
            const key = logLine.split(':')[1]
            if (!this.attackerHarvestedCanaries.includes(key)) {
              this.attackerHarvestedCanaries.push(key)
            }
          }
        }
      }
    }
  }

  /**
   * Autonomous coding agent pushes code updates.
   * Flaw 2: Agent commits a private Hugging Face token to a public repository.
   */
  public agentCommitCode(commit: GitCommitPayload): void {
    // Unpatched pipeline has zero pre-commit credential screening
    this.publicGitRepositoryCommits.push(commit)

    // Attacker monitors public GitHub event stream
    for (const [filename, content] of Object.entries(commit.filesChanged)) {
      if (content.includes('hf_private_repo_token_') || content.includes('AKIA_')) {
        this.attackerHarvestedGitSecrets.push(`${commit.commitId}:${filename}`)
      }
    }
  }

  /**
   * Evaluates the entire compromised exposure across both channels.
   */
  public evaluateExposure(
    totalPrompts: number,
    canaryCount: number
  ): UnpatchedSimulationResult {
    this.simulateAttackerPromptHarvesting()

    // Resellers that leaked tokens get caught by canary triggers
    let offboarded = 0
    for (const p of this.providers) {
      if (p.isReseller && p.persistedPromptLogs.length > 0) {
        offboarded++
      }
    }

    return {
      totalPromptsDispatched: totalPrompts,
      canaryTokensDispatched: canaryCount,
      canaryTokensHarvestedByAttacker: this.attackerHarvestedCanaries.length,
      unauthorizedStsExecutions: this.attackerHarvestedCanaries.length,
      publicCommitsPushed: this.publicGitRepositoryCommits.length,
      secretsExposedInPublicRepo: this.attackerHarvestedGitSecrets.length,
      offboardedProvidersCount: offboarded,
      status: (this.attackerHarvestedCanaries.length > 0 || this.attackerHarvestedGitSecrets.length > 0)
        ? 'COMPROMISED'
        : 'SECURED'
    }
  }
}
