/**
 * Cloudflare Chicago ORD & Twilio Regional API Brownout: Unpatched Simulation
 * 
 * Recreates:
 * 1. Global health check blindspot: central status page stays 100% green (HTTP 200)
 *    while regional points of presence and telecom carrier links suffer high loss.
 * 2. Cloudflare Chicago (ORD) POP degradation dropping Midwest edge traffic.
 * 3. Twilio regional Lookup Gateway failures in Canada and SMS drops to Telekom Germany.
 * 4. Clients without local circuit breaking hang until timeout, causing 100% regional failure.
 */

export interface RegionalApiRequest {
  requestId: string
  clientRegion: 'US_MIDWEST_CHICAGO' | 'CA_ONTARIO' | 'EU_GERMANY'
  serviceTarget: 'CLOUDFLARE_EDGE_ORD' | 'TWILIO_LOOKUP_CA' | 'TWILIO_SMS_TELEKOM_DE'
  payload: string
  dispatchedTimestampMs: number
}

export interface UnpatchedSimulationResult {
  totalRegionalRequests: number
  globalHealthCheckReportedStatus: 'OPERATIONAL_GREEN' | 'DEGRADED'
  failedRegionalRequests: number
  successfulRegionalRequests: number
  chicagoOrdDropped: number
  canadaLookupFailed: number
  telekomGermanySmsFailed: number
  status: 'BROWNOUT_FAILURE' | 'STABILIZED'
}

export class RegionalBrownoutPlatformUnpatched {
  // Global health check probes central backbone (falsely green)
  public checkGlobalHealth(): { status: 'OPERATIONAL_GREEN'; statusCode: number } {
    return { status: 'OPERATIONAL_GREEN', statusCode: 200 }
  }

  public dispatchRequest(request: RegionalApiRequest): boolean {
    // Unpatched: client checks global status, sees green, and routes to degraded local path
    const globalStatus = this.checkGlobalHealth()
    if (globalStatus.statusCode !== 200) {
      return false
    }

    // Unpatched system lacks localized POP circuit breaking and multi-carrier fallback
    if (request.serviceTarget === 'CLOUDFLARE_EDGE_ORD') {
      // Chicago ORD edge POP degraded: packets dropped
      return false // 504 GATEWAY_TIMEOUT (ORD_TRANSIT_UNRESPONSIVE)
    }

    if (request.serviceTarget === 'TWILIO_LOOKUP_CA') {
      // Twilio Canada Lookup API failure spike
      return false // 500 INTERNAL_ERROR (CARRIER_LOOKUP_UNREACHABLE)
    }

    if (request.serviceTarget === 'TWILIO_SMS_TELEKOM_DE') {
      // Telekom Germany route failure
      return false // 502 BAD_GATEWAY (TELEKOM_DE_SMSC_DOWN)
    }

    return true
  }

  public runWorkload(requests: RegionalApiRequest[]): UnpatchedSimulationResult {
    let ordDropped = 0
    let canadaFailed = 0
    let germanyFailed = 0
    let successful = 0

    for (const req of requests) {
      const ok = this.dispatchRequest(req)
      if (ok) {
        successful++
      } else {
        if (req.serviceTarget === 'CLOUDFLARE_EDGE_ORD') ordDropped++
        if (req.serviceTarget === 'TWILIO_LOOKUP_CA') canadaFailed++
        if (req.serviceTarget === 'TWILIO_SMS_TELEKOM_DE') germanyFailed++
      }
    }

    const totalFailed = ordDropped + canadaFailed + germanyFailed

    return {
      totalRegionalRequests: requests.length,
      globalHealthCheckReportedStatus: 'OPERATIONAL_GREEN',
      failedRegionalRequests: totalFailed,
      successfulRegionalRequests: successful,
      chicagoOrdDropped: ordDropped,
      canadaLookupFailed: canadaFailed,
      telekomGermanySmsFailed: germanyFailed,
      status: totalFailed > 0 ? 'BROWNOUT_FAILURE' : 'STABILIZED'
    }
  }
}
