/**
 * Exchange Online Cluster Health Checker & Load Balancer (Unpatched Baseline)
 * 
 * Demonstrates the Nov 12-14, 2026 Microsoft 365 PIR failure:
 * - High-core lock contention on TLS handshake setup delays health probes.
 * - Automated fail-closed health check drops lagging nodes from rotation.
 * - Remaining nodes absorb shifted load, contend on locks, and get sequentially
 *   ejected in a self-inflicted death spiral until the entire cluster is dead.
 */

export interface ClusterNode {
  nodeId: string
  activeConnections: number
  lockContentionMs: number
  isHealthy: boolean
}

export class HealthCheckBalancerUnpatched {
  private nodes: Map<string, ClusterNode> = new Map()
  public healthProbeThresholdMs: number = 500

  constructor(nodeIds: string[]) {
    for (const id of nodeIds) {
      this.nodes.set(id, {
        nodeId: id,
        activeConnections: 0,
        lockContentionMs: 50, // Normal latency
        isHealthy: true,
      })
    }
  }

  simulateLoadShift(incomingSurge: number) {
    const healthyNodes = Array.from(this.nodes.values()).filter((n) => n.isHealthy)
    if (healthyNodes.length === 0) return

    const loadPerNode = Math.floor(incomingSurge / healthyNodes.length)
    for (const node of healthyNodes) {
      node.activeConnections += loadPerNode
      // High-core lock contention scales quadratically with concurrent connections!
      node.lockContentionMs = 50 + (node.activeConnections * 15)
    }
  }

  /**
   * Run automated fail-closed health probe
   */
  runHealthProbes(): { healthyCount: number; evictedCount: number } {
    let evicted = 0
    for (const node of this.nodes.values()) {
      if (node.isHealthy && node.lockContentionMs > this.healthProbeThresholdMs) {
        // Unpatched: Fail-closed ejection without minimum quorum guard!
        node.isHealthy = false
        evicted++
      }
    }
    const healthyCount = Array.from(this.nodes.values()).filter((n) => n.isHealthy).length
    return { healthyCount, evictedCount: evicted }
  }

  getHealthyCount(): number {
    return Array.from(this.nodes.values()).filter((n) => n.isHealthy).length
  }
}
