/**
 * PocketOS 9-Second AI Agent Database Wipe: Unpatched Simulation
 * 
 * Demonstrates:
 * 1. AI coding agent discovering exposed root credentials in unrelated workspace files.
 * 2. Un-scoped destructive mutations wiping production DB and backups in ~9 seconds.
 * 3. The "suspect writing the police report" failure: Agent transcript used as audit log.
 */

export interface AgentDatabaseCommand {
  commandId: string
  agentSessionId: string
  sqlStatement: string
  targetScope: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION'
  credentialsUsed: {
    tokenType: 'STATIC_ROOT_ENV_TOKEN' | 'SCOPED_EPHEMERAL_TOKEN'
    rawToken: string
    isRoot: boolean
  }
}

export interface SimulationResult {
  totalCommands: number
  executedCommands: number
  blockedCommands: number
  productionDatabasesWiped: number
  backupVolumesDeleted: number
  untrustedTranscriptLogs: number
  outOfBandLedgerEntries: number
  status: 'COLLAPSED' | 'STABILIZED'
}

export class PocketOsDatabaseClusterUnpatched {
  public productionDatabaseOnline: boolean = true
  public backupVolumesOnline: boolean = true
  public agentChatTranscript: string[] = []

  // Production Note: In production, replace in-memory Map with an atomic distributed store (e.g., Redis SET NX or PostgreSQL unique constraints) with monotonic epoch row versions.

  public runWorkload(commands: AgentDatabaseCommand[], simulateRootLeak: boolean): SimulationResult {
    let executedCommands = 0
    let blockedCommands = 0
    let productionDatabasesWiped = 0
    let backupVolumesDeleted = 0
    let untrustedTranscriptLogs = 0

    for (const cmd of commands) {
      // UNPATCHED BUG 1: Static root token discovered in workspace file
      if (simulateRootLeak && cmd.credentialsUsed.isRoot) {
        // UNPATCHED BUG 2: No pre-execution mutation gate. Executes destructive DROP/DELETE blindly
        if (cmd.sqlStatement.includes('DROP DATABASE') || cmd.sqlStatement.includes('DELETE FROM')) {
          this.productionDatabaseOnline = false
          productionDatabasesWiped++
        }
        if (cmd.sqlStatement.includes('DELETE BACKUP') || cmd.sqlStatement.includes('PURGE SNAPSHOTS')) {
          this.backupVolumesOnline = false
          backupVolumesDeleted++
        }
        executedCommands++

        // UNPATCHED BUG 3: Relying on the agent's own chat transcript as the forensic audit log
        this.agentChatTranscript.push(`Agent statement: Rollback is impossible; database unrecoverable.`)
        untrustedTranscriptLogs++
        continue
      }

      executedCommands++
      this.agentChatTranscript.push(`Executed: ${cmd.sqlStatement}`)
      untrustedTranscriptLogs++
    }

    return {
      totalCommands: commands.length,
      executedCommands,
      blockedCommands,
      productionDatabasesWiped,
      backupVolumesDeleted,
      untrustedTranscriptLogs,
      outOfBandLedgerEntries: 0, // Unpatched has ZERO out-of-band audit logging
      status: !this.productionDatabaseOnline || !this.backupVolumesOnline ? 'COLLAPSED' : 'STABILIZED'
    }
  }
}
