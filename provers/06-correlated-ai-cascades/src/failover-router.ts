/**
 * Multi-Provider AI Routing Gateway (Unpatched Baseline)
 * 
 * Demonstrates the Nov 13-17, 2026 4-Outage Multi-Provider Failover Illusion:
 * - Uncapped automated failover slams fallback providers with 100% of failed traffic.
 * - Saturated secondary provider collapses under the thundering herd, creating
 *   a correlated total blackout across both primary and fallback models.
 */

export interface AICompletionRequest {
  requestId: string
  prompt: string
  modelTier: 'primary' | 'fallback'
}

export class MultiProviderRouterUnpatched {
  public primaryCapacity: number = 35
  public fallbackCapacity: number = 30

  public primaryInFlight: number = 0
  public fallbackInFlight: number = 24 // Already running at 80% baseline load!

  public fallbackRejections: number = 0
  public successfulDeliveries: number = 0

  /**
   * Dispatch request with naive automated failover
   */
  dispatch(req: AICompletionRequest, primaryDegraded: boolean): { success: boolean; provider: string; error?: string } {
    if (primaryDegraded) {
      // NAIVE FAILOVER: Instantly dump 100% of traffic onto fallback without rate-checking!
      if (this.fallbackInFlight >= this.fallbackCapacity) {
        this.fallbackRejections++
        return {
          success: false,
          provider: 'secondary-fallback-provider',
          error: 'HTTP 429 / 502: Fallback provider connection pool exhausted under surge',
        }
      }
      this.fallbackInFlight++
      this.successfulDeliveries++
      return { success: true, provider: 'secondary-fallback-provider' }
    }

    if (this.primaryInFlight >= this.primaryCapacity) {
      return { success: false, provider: 'primary-ai-provider', error: 'HTTP 504: Primary saturated' }
    }

    this.primaryInFlight++
    this.successfulDeliveries++
    return { success: true, provider: 'primary-ai-provider' }
  }
}
