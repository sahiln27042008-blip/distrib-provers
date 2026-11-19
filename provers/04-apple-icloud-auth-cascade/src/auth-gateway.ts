/**
 * Apple Edge API Gateway & Synchronous IdP Client (Unpatched Baseline)
 * 
 * Demonstrates the Nov 17, 2026 Apple iCloud identity collapse:
 * - Every downstream request (App Store, Apple Music) requires synchronous live IdP verification.
 * - When the IdP suffers a latency spike, edge gateways drop client requests with HTTP 504.
 * - Healthy downstream services are completely starved by upstream auth coupling.
 */

export interface ClientAPIRequest {
  requestId: string
  service: 'AppStore' | 'AppleMusic' | 'AppleCare'
  sessionToken: string
}

export class AuthGatewayUnpatched {
  private idpLatencyMs: number = 45
  private gatewayTimeoutMs: number = 5000

  public successfulDispatches: number = 0
  public gatewayTimeouts: number = 0

  setIdpLatency(latencyMs: number) {
    this.idpLatencyMs = latencyMs
  }

  /**
   * Process a client API request. Unpatched: Synchronously awaits IdP on every call!
   */
  processRequest(req: ClientAPIRequest): { success: boolean; statusCode: number; error?: string } {
    if (this.idpLatencyMs > this.gatewayTimeoutMs) {
      // Synchronous timeout exceeded! Hard failure drops downstream request
      this.gatewayTimeouts++
      return {
        success: false,
        statusCode: 504,
        error: 'GATEWAY_TIMEOUT: iCloud Account & Sign In failed to respond within 5000ms deadline',
      }
    }

    this.successfulDispatches++
    return { success: true, statusCode: 200 }
  }
}
