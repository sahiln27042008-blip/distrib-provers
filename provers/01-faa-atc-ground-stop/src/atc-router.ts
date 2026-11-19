/**
 * FAA ERAM National Airspace System Message Router (Unpatched Baseline)
 * 
 * Demonstrates the Nov 13, 2026 router storm failure mode:
 * - Fixed 50-slot FIFO queue without active backpressure.
 * - Non-idempotent flight plan distribution to 17 Air Route Traffic Control Centers (ARTCCs).
 * - Saturated buffer silently drops overflow packets, leading to cross-center state drift.
 */

export interface FlightStripUpdate {
  flightId: string
  altitudeFeet: number
  headingDegrees: number
  squawkCode: string
  sequenceId: number
}

export interface ARTCCNodeState {
  centerCode: string
  activeFlightStrips: Map<string, FlightStripUpdate>
  receivedCount: number
}

export class ATCRouterUnpatched {
  private queueCapacity: number = 50
  private buffer: FlightStripUpdate[] = []
  private centers: Map<string, ARTCCNodeState> = new Map()

  public droppedPackets: number = 0

  constructor(centerCodes: string[]) {
    for (const code of centerCodes) {
      this.centers.set(code, {
        centerCode: code,
        activeFlightStrips: new Map(),
        receivedCount: 0,
      })
    }
  }

  /**
   * Submit an incoming flight strip update into the router queue
   */
  submitUpdate(update: FlightStripUpdate): boolean {
    if (this.buffer.length >= this.queueCapacity) {
      // Buffer full! Silent packet drop without backpressure or downstream notification
      this.droppedPackets++
      return false
    }
    this.buffer.push(update)
    return true
  }

  /**
   * Flush and broadcast buffered messages to all 17 ARTCC centers
   */
  drainAndBroadcast(): void {
    while (this.buffer.length > 0) {
      const update = this.buffer.shift()!
      for (const center of this.centers.values()) {
        center.activeFlightStrips.set(update.flightId, update)
        center.receivedCount++
      }
    }
  }

  /**
   * Check for state drift across ARTCC centers
   */
  getDesynchronizedCenters(expectedTotal: number): string[] {
    const desynced: string[] = []
    for (const [code, state] of this.centers.entries()) {
      if (state.receivedCount !== expectedTotal) {
        desynced.push(code)
      }
    }
    return desynced
  }
}
