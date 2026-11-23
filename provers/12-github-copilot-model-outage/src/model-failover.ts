/**
 * GitHub Copilot Upstream Model Provider Outage: Unpatched Simulation
 * 
 * Demonstrates:
 * 1. Upstream model degradation (GPT-6 Luna slow-hangs / latency explosions).
 * 2. Copilot gateway lacking automated circuit breakers and dynamic fallback routing.
 * 3. Total failure of "manual model switching" guidance for autonomous background agents.
 */

export interface InferenceRequest {
  requestId: string
  agentId: string
  workflowType: 'INTERACTIVE_IDE' | 'AUTONOMOUS_BACKGROUND_AGENT'
  modelRequested: string
  prompt: string
  maxTokens: number
}

export interface SimulationResult {
  totalRequests: number
  successfulInferences: number
  failedInferences: number
  stalledAgentsCount: number
  automatedFailoversTriggered: number
  humanInterventionsRequired: number
  status: 'COLLAPSED' | 'STABILIZED'
}

export class CopilotInferenceGatewayUnpatched {
  public primaryModelDegraded: boolean = false
  public requestHistory: Array<{ requestId: string; modelUsed: string; success: boolean }> = []

  // Production Note: In production, replace in-memory Map with an atomic distributed store (e.g., Redis SET NX or PostgreSQL unique constraints) with monotonic epoch row versions.

  /**
   * Unpatched inference routing:
   * Blindly routes to the requested model. Does not possess automated circuit breaker.
   * If model hangs, requests time out. Relies on human developer to manually change configuration.
   */
  public async handleInference(
    req: InferenceRequest
  ): Promise<{ success: boolean; modelUsed: string; error?: string }> {
    if (req.modelRequested === 'gpt-6-luna' && this.primaryModelDegraded) {
      // If user is human in interactive IDE, human could theoretically open settings and switch.
      // But if autonomous background agent: CANNOT click GUI menus!
      if (req.workflowType === 'AUTONOMOUS_BACKGROUND_AGENT') {
        return {
          success: false,
          modelUsed: 'gpt-6-luna',
          error: 'TIMEOUT_UPSTREAM_HANG: GPT-6 Luna provider socket hung for 45,000ms. Agent halted.'
        }
      } else {
        // Human interactive session still fails until manual switch is performed
        return {
          success: false,
          modelUsed: 'gpt-6-luna',
          error: 'DEGRADED_PROVIDER: Manual model switch required by user in IDE settings.'
        }
      }
    }

    return {
      success: true,
      modelUsed: req.modelRequested
    }
  }

  public runWorkload(requests: InferenceRequest[], simulateProviderOutage: boolean): SimulationResult {
    this.primaryModelDegraded = simulateProviderOutage
    let successfulInferences = 0
    let failedInferences = 0
    let stalledAgentsCount = 0
    let humanInterventionsRequired = 0

    const agentStallMap = new Set<string>()

    for (const req of requests) {
      if (this.primaryModelDegraded && req.modelRequested === 'gpt-6-luna') {
        failedInferences++
        if (req.workflowType === 'AUTONOMOUS_BACKGROUND_AGENT') {
          agentStallMap.add(req.agentId)
        } else {
          humanInterventionsRequired++
        }
      } else {
        successfulInferences++
      }
    }

    stalledAgentsCount = agentStallMap.size

    return {
      totalRequests: requests.length,
      successfulInferences,
      failedInferences,
      stalledAgentsCount,
      automatedFailoversTriggered: 0, // Unpatched system has ZERO automated failovers
      humanInterventionsRequired,
      status: failedInferences > requests.length * 0.5 || stalledAgentsCount > 0 ? 'COLLAPSED' : 'STABILIZED'
    }
  }
}
