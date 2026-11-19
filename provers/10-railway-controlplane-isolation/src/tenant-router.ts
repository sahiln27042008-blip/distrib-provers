/**
 * Railway Control Plane Tenant Router & Vault Gateway (Unpatched Baseline)
 * 
 * Demonstrates the Railway October 21 Security Incident:
 * - Internal control-plane microservice treats network authentication as authorization.
 * - Missing cryptographic tenant fencing: tokens validate internal service identity
 *   without verifying that the caller's tenant scope matches the target workspace.
 * - Missing monotonic workspace epoch fencing: long-lived tokens cannot be quarantined
 *   without emergency global fleet halts.
 * - Lateral traversal across customer workspaces allows unauthorized decryption of
 *   AI API keys (OpenAI, Anthropic) and database credentials.
 */

export interface WorkspaceSecrets {
  workspaceId: string
  openaiApiKey: string
  anthropicApiKey: string
  databaseUrl: string
}

export interface AuthToken {
  tokenString: string
  principalId: string
  issuedTenantId?: string
  epoch?: number
}

export interface DecryptResult {
  success: boolean
  workspaceId: string
  secrets?: WorkspaceSecrets
  error?: string
}

export class TenantRouterUnpatched {
  private workspaceVault: Map<string, WorkspaceSecrets> = new Map()
  public validServiceTokens: Set<string> = new Set()

  constructor() {
    this.validServiceTokens.add('railway-internal-mesh-bearer-token-live')
    this.validServiceTokens.add('service-principal-compromised-token')
  }

  registerWorkspace(secrets: WorkspaceSecrets) {
    this.workspaceVault.set(secrets.workspaceId, secrets)
  }

  /**
   * Unpatched Secret Decryption Gateway:
   * Validates only that the bearer token is valid for internal RPC, but does NOT
   * enforce cryptographic tenant boundary isolation or monotonic epoch fencing.
   */
  decryptWorkspaceSecrets(targetWorkspaceId: string, token: AuthToken): DecryptResult {
    // Check 1: Is the token recognized as a valid internal principal?
    if (!this.validServiceTokens.has(token.tokenString)) {
      return {
        success: false,
        workspaceId: targetWorkspaceId,
        error: 'INVALID_BEARER_TOKEN',
      }
    }

    // VULNERABILITY: Unpatched control plane does NOT check whether token.issuedTenantId === targetWorkspaceId!
    // VULNERABILITY: Unpatched control plane does NOT check monotonic workspace epoch fencing!
    const secrets = this.workspaceVault.get(targetWorkspaceId)
    if (!secrets) {
      return {
        success: false,
        workspaceId: targetWorkspaceId,
        error: 'WORKSPACE_NOT_FOUND',
      }
    }

    // Secrets decrypted across workspace boundary!
    return {
      success: true,
      workspaceId: targetWorkspaceId,
      secrets: { ...secrets },
    }
  }

  getWorkspaceCount(): number {
    return this.workspaceVault.size
  }
}
