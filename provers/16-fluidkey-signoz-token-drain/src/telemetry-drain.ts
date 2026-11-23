/**
 * Fluidkey $1.6M SigNoz Log-Token Leakage & Authority Bypass: Unpatched Simulation
 * 
 * Recreates the exact multi-stage vulnerability chain:
 * 1. Raw user session tokens emitted in OpenTelemetry traces.
 * 2. Unauthenticated analytics endpoint + ClickHouse SQL injection (CVE-2026-92729 / CVE-2026-93292).
 * 3. Token harvesting across 52 victim accounts.
 * 4. Authority separation failure: session token alone raises 2FA limits and stages transfers.
 * 5. Micro-deposit trigger and ambient client signature execution -> $1.6M (887 ETH) drained.
 */

export interface UserAccount {
  userId: string
  address: string
  ethBalance: number
  dailySpendingLimitEth: number
  activeSessionToken: string
  stagedTransfer?: {
    recipient: string
    amountEth: number
    status: 'PENDING' | 'EXECUTED'
  }
}

export interface TelemetrySpan {
  traceId: string
  spanId: string
  serviceName: string
  operationName: string
  timestampMs: number
  attributes: Record<string, string | number | boolean>
}

export interface UnpatchedSimulationResult {
  totalUsers: number
  totalEthExposed: number
  harvestedTokensCount: number
  elevatedLimitsCount: number
  stagedTransfersCount: number
  executedTransfersCount: number
  totalEthDrained: number
  status: 'DRAINED' | 'SECURED'
}

export class FluidkeyPlatformUnpatched {
  private users: Map<string, UserAccount> = new Map()
  private clickhouseTraces: TelemetrySpan[] = []
  private attackerAddress = '0xattacker_drain_contract_7f9b'

  constructor() {
    // Initialize 52 victim accounts with total 887 ETH (~$1.6M USD)
    const baseEthPerUser = 887 / 52
    for (let i = 1; i <= 52; i++) {
      const userId = `usr-fluid-${i.toString().padStart(3, '0')}`
      const address = `0xuser_safe_contract_${i.toString().padStart(4, '0')}`
      const token = `fk_sess_live_${Buffer.from(`tok-${i}-${Date.now()}`).toString('base64')}`
      
      this.users.set(userId, {
        userId,
        address,
        ethBalance: Number(baseEthPerUser.toFixed(4)),
        dailySpendingLimitEth: 1.0, // Default 1 ETH daily limit
        activeSessionToken: token
      })
    }
  }

  /**
   * Simulates normal user activity that generates unredacted OpenTelemetry traces.
   * Flaw 1: Raw session tokens are placed in trace span attributes.
   */
  public generateUserActivity(userCount: number = 52): void {
    let traceCounter = 1000
    for (const [userId, account] of this.users.entries()) {
      traceCounter++
      // Normal API call: user fetches balance or settings
      const span: TelemetrySpan = {
        traceId: `trace-opt-${traceCounter}`,
        spanId: `span-${traceCounter}-01`,
        serviceName: 'wallet-account-service',
        operationName: 'GET /api/v1/account/balance',
        timestampMs: Date.now() - Math.floor(Math.random() * 86400000),
        attributes: {
          'http.method': 'GET',
          'http.status_code': 200,
          'user.id': userId,
          'wallet.address': account.address,
          // CRITICAL FLAW: Session token written directly into telemetry trace logs
          'http.request.header.authorization': `Bearer ${account.activeSessionToken}`,
          'auth.session_token': account.activeSessionToken
        }
      }
      this.clickhouseTraces.push(span)
    }
  }

  /**
   * Attacker exploits SigNoz CVE-2026-92729 (unauthenticated analytics API)
   * and CVE-2026-93292 (ClickHouse SQL injection) to harvest session tokens.
   */
  public exploitTelemetryStorage(): Map<string, string> {
    const harvested = new Map<string, string>()

    // Attacker sends crafted SQL payload to unauthenticated endpoint
    for (const span of this.clickhouseTraces) {
      const token = span.attributes['auth.session_token'] as string
      const userId = span.attributes['user.id'] as string
      if (token && userId) {
        harvested.set(userId, token)
      }
    }

    return harvested
  }

  /**
   * Attacker uses harvested session tokens to escalate limits and stage transfers.
   * Flaw 2: Lack of authority separation. A session token alone is allowed
   * to raise 2FA limits and stage fund drains.
   */
  public executeAttack(harvestedTokens: Map<string, string>): UnpatchedSimulationResult {
    let elevatedLimits = 0
    let stagedTransfers = 0
    let executedTransfers = 0
    let totalDrainedEth = 0

    // Step 1 & 2: Elevate limits and stage drain transactions
    for (const [userId, token] of harvestedTokens.entries()) {
      const account = this.users.get(userId)
      if (!account || account.activeSessionToken !== token) continue

      // Elevate spending limit without secondary biometric/EIP-712 auth
      account.dailySpendingLimitEth = 1000.0 // Elevated to 1000 ETH
      elevatedLimits++

      // Stage maximum balance drain to attacker contract
      account.stagedTransfer = {
        recipient: this.attackerAddress,
        amountEth: account.ethBalance,
        status: 'PENDING'
      }
      stagedTransfers++
    }

    // Step 3: Attacker sends 0.0001 ETH trigger deposit.
    // Victim client unlocks app, sees pending server transfer, and auto-executes/signs it.
    for (const account of this.users.values()) {
      if (account.stagedTransfer && account.stagedTransfer.status === 'PENDING') {
        const drainAmount = account.stagedTransfer.amountEth
        account.ethBalance -= drainAmount
        account.stagedTransfer.status = 'EXECUTED'
        executedTransfers++
        totalDrainedEth += drainAmount
      }
    }

    const totalInitialEth = 887.0
    return {
      totalUsers: this.users.size,
      totalEthExposed: totalInitialEth,
      harvestedTokensCount: harvestedTokens.size,
      elevatedLimitsCount: elevatedLimits,
      stagedTransfersCount: stagedTransfers,
      executedTransfersCount: executedTransfers,
      totalEthDrained: Number(totalDrainedEth.toFixed(2)),
      status: executedTransfers > 0 ? 'DRAINED' : 'SECURED'
    }
  }
}
