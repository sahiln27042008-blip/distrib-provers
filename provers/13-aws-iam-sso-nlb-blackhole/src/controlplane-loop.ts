/**
 * AWS us-east-1 IAM Identity Center & Single-AZ NLB Blackhole: Unpatched Simulation
 * 
 * Demonstrates:
 * 1. Control-Plane Circular Dependency: SSO failure locks engineers out of diagnostic console.
 * 2. Single-AZ NLB Pinning: Traffic routed into dead use1-az1 cell without automated cross-zone failover.
 * 3. 3-hour 16-minute operational paralysis of downstream services (Step Functions, OpenSearch).
 */

export interface AuthSessionRequest {
  requestId: string
  operatorId: string
  targetService: string
  authMethod: 'IAM_IDENTITY_CENTER_SSO' | 'EMERGENCY_BREAK_GLASS'
  assignedZone: 'use1-az1' | 'use1-az2' | 'use1-az4'
}

export interface SimulationResult {
  totalRequests: number
  successfulAuths: number
  failedAuths: number
  lockedOutOperatorsCount: number
  blackholedPacketsCount: number
  automatedZonalShifts: number
  status: 'COLLAPSED' | 'STABILIZED'
}

export class AwsControlPlaneClusterUnpatched {
  public ssoServiceDegraded: boolean = false
  public az1CellBlackholed: boolean = false

  // Production Note: In production, replace in-memory Map with an atomic distributed store (e.g., Redis SET NX or PostgreSQL unique constraints) with monotonic epoch row versions.

  public runWorkload(requests: AuthSessionRequest[], simulateOutage: boolean): SimulationResult {
    this.ssoServiceDegraded = simulateOutage
    this.az1CellBlackholed = simulateOutage

    let successfulAuths = 0
    let failedAuths = 0
    let blackholedPacketsCount = 0
    const lockedOutOperators = new Set<string>()

    for (const req of requests) {
      // UNPATCHED BUG 1: Complete reliance on IAM Identity Center SSO
      // When SSO degrades, no out-of-band break-glass path exists
      if (this.ssoServiceDegraded && req.authMethod === 'IAM_IDENTITY_CENTER_SSO') {
        failedAuths++
        lockedOutOperators.add(req.operatorId)
        if (this.az1CellBlackholed && req.assignedZone === 'use1-az1') {
          blackholedPacketsCount++
        }
        continue
      }

      // UNPATCHED BUG 2: Single-AZ NLB cell pinning
      // When use1-az1 drops, all traffic pinned to that single cell is blackholed
      if (this.az1CellBlackholed && req.assignedZone === 'use1-az1') {
        blackholedPacketsCount++
        failedAuths++
        continue
      }

      successfulAuths++
    }

    return {
      totalRequests: requests.length,
      successfulAuths,
      failedAuths,
      lockedOutOperatorsCount: lockedOutOperators.size,
      blackholedPacketsCount,
      automatedZonalShifts: 0, // Unpatched has ZERO automated zonal shifting
      status: failedAuths > requests.length * 0.5 ? 'COLLAPSED' : 'STABILIZED'
    }
  }
}
