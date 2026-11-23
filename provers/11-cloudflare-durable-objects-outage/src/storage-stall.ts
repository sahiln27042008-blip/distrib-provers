/**
 * Cloudflare Durable Objects & D1 Elevated Storage Errors: Unpatched Simulation
 * 
 * Demonstrates:
 * 1. Stateless Workers returning HTTP 200 while underlying actor storage hangs/fails.
 * 2. Orphaned actor mutex locks when storage timeouts lack atomic zero-hold lease reclamation.
 * 3. State desynchronization, duplicate partial writes, and Cloudflare Access JWT claim omission.
 */

export interface AgentRequest {
  requestId: string
  sessionId: string
  actorId: string
  mutationKey: string
  mutationValue: string
  authToken: {
    tokenString: string
    sub?: string // Cloudflare Access release dropped this claim
    issuer: string
  }
}

export interface SimulationResult {
  totalRequests: number
  successfulWrites: number
  failedWrites: number
  orphanedLocksCount: number
  unauthorizedBypasses: number
  duplicateMutationsCount: number
  status: 'COLLAPSED' | 'STABILIZED'
}

export class DurableObjectActorUnpatched {
  public actorId: string
  public heldLock: boolean = false
  public lockHolderSessionId: string | null = null
  public storageState: Map<string, string> = new Map()
  public writeHistory: string[] = []

  constructor(actorId: string) {
    this.actorId = actorId
  }

  // Production Note: In production, replace in-memory Map with an atomic distributed store (e.g., Redis SET NX or PostgreSQL unique constraints) with monotonic epoch row versions.

  /**
   * Unpatched execute: Acquires lock without lease epoch and does not clear
   * on unhandled storage subsystem exception.
   */
  public async executeMutation(
    req: AgentRequest,
    storageStalled: boolean
  ): Promise<{ success: boolean; error?: string }> {
    if (this.heldLock) {
      return { success: false, error: 'LOCK_HELD_TIMEOUT: Actor mutex occupied by stalled session' }
    }

    // Acquire lock naively without monotonic epoch or lease expiration timer
    this.heldLock = true
    this.lockHolderSessionId = req.sessionId

    if (storageStalled) {
      // Simulate 35-minute storage stall: Storage throws timeout / I/O error
      // UNPATCHED BUG: Lock is never released in a finally block; becomes orphaned zombie lock!
      throw new Error(`D1_STORAGE_TIMEOUT: Storage subsystem failed to commit write for key ${req.mutationKey}`)
    }

    // Naive write without idempotency check
    this.storageState.set(req.mutationKey, req.mutationValue)
    this.writeHistory.push(req.mutationValue)
    this.heldLock = false
    this.lockHolderSessionId = null
    return { success: true }
  }
}

export class CloudflareEdgeClusterUnpatched {
  public actors: Map<string, DurableObjectActorUnpatched> = new Map()

  public getOrCreateActor(actorId: string): DurableObjectActorUnpatched {
    let actor = this.actors.get(actorId)
    if (!actor) {
      actor = new DurableObjectActorUnpatched(actorId)
      this.actors.set(actorId, actor)
    }
    return actor
  }

  public async handleRequest(
    req: AgentRequest,
    storageStalled: boolean
  ): Promise<{ httpStatus: number; body: string; error?: string }> {
    // UNPATCHED BUG 1: Access JWT bug - missing 'sub' claim is ignored, allowing anonymous execution
    let unauthorized = false
    if (!req.authToken.sub) {
      unauthorized = true // Marked for tracking, but request is allowed to proceed!
    }

    const actor = this.getOrCreateActor(req.actorId)

    try {
      // UNPATCHED BUG 2: Stateless Worker assumes edge actor is healthy and delegates blindly
      const result = await actor.executeMutation(req, storageStalled)
      if (!result.success) {
        return { httpStatus: 500, body: 'Actor Error', error: result.error }
      }
      return { httpStatus: 200, body: 'Write Committed' }
    } catch (err: any) {
      // Storage timed out, but actor's this.heldLock was left permanently true!
      return { httpStatus: 504, body: 'Storage Gateway Timeout', error: err.message }
    }
  }

  public runWorkload(requests: AgentRequest[], simulateStall: boolean): SimulationResult {
    let successfulWrites = 0
    let failedWrites = 0
    let unauthorizedBypasses = 0
    let duplicateMutationsCount = 0

    // Run workload
    for (const req of requests) {
      if (!req.authToken.sub) {
        unauthorizedBypasses++
      }

      const actor = this.getOrCreateActor(req.actorId)
      const currentHistoryLength = actor.writeHistory.length

      try {
        if (actor.heldLock) {
          failedWrites++
          continue
        }

        actor.heldLock = true
        actor.lockHolderSessionId = req.sessionId

        if (simulateStall) {
          // In-flight storage failure
          failedWrites++
          // Notice: heldLock is NOT cleared! Simulates unhandled exception in actor runtime
          continue
        }

        actor.storageState.set(req.mutationKey, req.mutationValue)
        actor.writeHistory.push(req.mutationValue)
        if (actor.writeHistory.length > currentHistoryLength + 1) {
          duplicateMutationsCount++
        }
        actor.heldLock = false
        actor.lockHolderSessionId = null
        successfulWrites++
      } catch (err) {
        failedWrites++
      }
    }

    // Count orphaned locks across actors
    let orphanedLocksCount = 0
    for (const actor of this.actors.values()) {
      if (actor.heldLock) {
        orphanedLocksCount++
      }
    }

    return {
      totalRequests: requests.length,
      successfulWrites,
      failedWrites,
      orphanedLocksCount,
      unauthorizedBypasses,
      duplicateMutationsCount,
      status: orphanedLocksCount > 0 || failedWrites > requests.length * 0.5 ? 'COLLAPSED' : 'STABILIZED'
    }
  }
}
