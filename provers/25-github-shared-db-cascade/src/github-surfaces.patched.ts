import type { GitHubSurface, SurfaceResponse } from "./github-surfaces.ts";

/**
 * Patched GitHub Shared-Primary-DB Model:
 * 1. Per-surface bulkhead quotas cap Actions/Webhooks to at most 6/16 shared DB connections,
 *    preserving 10/16 dedicated headroom for PRs, Issues, Git Ops, Packages, Pages, and API.
 * 2. Idempotent webhook/run ledger deduplicates retries so stalled runs never duplicate.
 */
export class GitHubClusterPatched {
  readonly sharedDbMaxConnections: number;
  readonly actionsWebhookQuota: number;
  actionsWebhookActive = 0;
  coreActive = 0;
  readonly seenRequestIds = new Set<string>();
  readonly committedRuns = new Map<string, number>();
  shedExcessActions = 0;
  coreSuccesses = 0;
  deduplicatedRetries = 0;
  isolatedPlaneSuccesses = 0;

  constructor(sharedDbMaxConnections = 16, actionsWebhookQuota = 6) {
    this.sharedDbMaxConnections = sharedDbMaxConnections;
    this.actionsWebhookQuota = actionsWebhookQuota;
  }

  saturateActionsAndWebhooks(burstCount: number): void {
    // Bulkhead clamps Actions/Webhooks to quota; excess is shed cleanly
    this.actionsWebhookActive = Math.min(this.actionsWebhookQuota, burstCount);
    this.shedExcessActions += Math.max(0, burstCount - this.actionsWebhookQuota);
  }

  handleRequest(surface: GitHubSurface, requestId: string): SurfaceResponse {
    if (surface === "copilot" || surface === "codespaces") {
      this.isolatedPlaneSuccesses++;
      return { surface, ok: true, statusCode: 200 };
    }

    if (this.seenRequestIds.has(requestId)) {
      this.deduplicatedRetries++;
      return { surface, ok: true, statusCode: 200, reason: "idempotent_dedup" };
    }

    if (surface === "actions" || surface === "webhooks") {
      if (this.actionsWebhookActive >= this.actionsWebhookQuota) {
        this.shedExcessActions++;
        return { surface, ok: false, statusCode: 503, reason: "bulkhead_quota_shed" };
      }
    }

    const totalUsed = this.actionsWebhookActive + this.coreActive;
    if (totalUsed >= this.sharedDbMaxConnections) {
      return { surface, ok: false, statusCode: 503, reason: "pool_full" };
    }

    this.seenRequestIds.add(requestId);
    this.committedRuns.set(requestId, 1);
    this.coreSuccesses++;
    return { surface, ok: true, statusCode: 200 };
  }
}
