export type GitHubSurface =
  | "actions"
  | "webhooks"
  | "pull_requests"
  | "issues"
  | "git_ops"
  | "packages"
  | "pages"
  | "api"
  | "copilot"
  | "codespaces";

export interface SurfaceResponse {
  surface: GitHubSurface;
  ok: boolean;
  statusCode: 200 | 502 | 503;
  reason?: string;
}

/**
 * Unpatched GitHub Shared-Primary-DB Model (Nov 25, 2026):
 * - 8 core surfaces share one primary DB connection pool (capacity = 16) with no per-surface bulkhead.
 * - Heavy Actions/Webhooks load saturates 16/16 DB connections, starving PRs, Issues, Git Ops, Packages, Pages, and API.
 * - Copilot & Codespaces use isolated inference/VM planes and stay 100% operational.
 * - Retried webhooks without idempotency create duplicate/partial runs when DB stalls.
 */
export class GitHubClusterUnpatched {
  readonly sharedDbMaxConnections: number;
  sharedDbActiveConnections = 0;
  readonly committedRuns = new Map<string, number>();
  droppedWebhooks = 0;
  starvedCoreRequests = 0;
  isolatedPlaneSuccesses = 0;

  constructor(sharedDbMaxConnections = 16) {
    this.sharedDbMaxConnections = sharedDbMaxConnections;
  }

  saturateActionsAndWebhooks(burstCount: number): void {
    // Actions/Webhooks acquire shared DB connections without any bulkhead cap
    this.sharedDbActiveConnections = Math.min(this.sharedDbMaxConnections, burstCount);
  }

  handleRequest(surface: GitHubSurface, requestId: string): SurfaceResponse {
    // Isolated surfaces do not touch the shared primary DB
    if (surface === "copilot" || surface === "codespaces") {
      this.isolatedPlaneSuccesses++;
      return { surface, ok: true, statusCode: 200 };
    }

    if (this.sharedDbActiveConnections >= this.sharedDbMaxConnections) {
      if (surface === "webhooks") this.droppedWebhooks++;
      else this.starvedCoreRequests++;
      return { surface, ok: false, statusCode: 503, reason: "shared_primary_db_saturated" };
    }

    // No idempotency check: duplicate retries increment run count
    this.committedRuns.set(requestId, (this.committedRuns.get(requestId) ?? 0) + 1);
    return { surface, ok: true, statusCode: 200 };
  }
}
