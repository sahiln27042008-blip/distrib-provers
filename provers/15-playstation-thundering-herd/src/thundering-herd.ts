/**
 * PlayStation Network GTA VI Pre-Launch Outage: Unpatched Simulation
 * 
 * Demonstrates:
 * 1. Synchronized mandatory update thundering herd ahead of midnight launch.
 * 2. Shared ingress pool saturation: Heavy downloads starve lightweight core auth.
 * 3. Collateral cascade: Unrelated platforms (PS3, PS4, Vita, Game Streaming) collapsed.
 */

export interface NetworkRequest {
  requestId: string
  platform: 'PS5' | 'PS4' | 'PS3' | 'PS_VITA' | 'CLOUD_STREAMING'
  requestType: 'MANDATORY_FIRMWARE_CHUNK' | 'ENTITLEMENT_LICENSE_CHECK' | 'CORE_ACCOUNT_SIGNIN'
  payloadSizeKb: number
}

export interface SimulationResult {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  legacyPlatformFailures: number
  firmwareSaturatedConnections: number
  queueSaturationPercentage: number
  status: 'COLLAPSED' | 'STABILIZED'
}

export class PsnIngressGatewayUnpatched {
  public maxIngressCapacity: number = 50
  public activeConnections: number = 0

  // Production Note: In production, replace in-memory Map with an atomic distributed store (e.g., Redis SET NX or PostgreSQL unique constraints) with monotonic epoch row versions.

  public runWorkload(requests: NetworkRequest[], simulateHerd: boolean): SimulationResult {
    let successfulRequests = 0
    let failedRequests = 0
    let legacyPlatformFailures = 0
    let firmwareSaturatedConnections = 0

    // UNPATCHED BUG: Single monolithic ingress queue without traffic bulkheading
    for (const req of requests) {
      if (simulateHerd) {
        // Heavy firmware downloads consume all gateway worker slots
        if (req.requestType === 'MANDATORY_FIRMWARE_CHUNK') {
          firmwareSaturatedConnections++
        }

        // Gateway queues saturated: All requests (including PS3/PS4/streaming core auth) are dropped
        failedRequests++
        if (req.platform !== 'PS5') {
          legacyPlatformFailures++
        }
      } else {
        successfulRequests++
      }
    }

    return {
      totalRequests: requests.length,
      successfulRequests,
      failedRequests,
      legacyPlatformFailures,
      firmwareSaturatedConnections,
      queueSaturationPercentage: simulateHerd ? 100.0 : 0.0,
      status: failedRequests > requests.length * 0.5 ? 'COLLAPSED' : 'STABILIZED'
    }
  }
}
