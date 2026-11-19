/**
 * Airbyte Cloud Connector Sync Job (Unpatched Baseline)
 * 
 * Demonstrates:
 * - Airbyte Cloud syncing records from source connectors to destination vector stores.
 * - Lack of durable incremental checkpoints (commit deferred to final job completion).
 * - Under unexpected HTTP 502 Bad Gateway / gateway crash, entire in-flight state is dumped.
 * - 100% of synced in-flight records are lost, disrupting downstream Agentic RAG pipelines.
 */

export interface SyncRecord {
  recordId: string
  payload: Record<string, unknown>
  emittedAt: number
}

export interface SyncResult {
  jobId: string
  totalEmitted: number
  persistedRecords: number
  lostInFlightRecords: number
  dataLossPercentage: number
  checkpointsCommitted: number
  status: 'COMPLETED' | 'FAILED_HTTP_502'
  errorMessage?: string
}

export class AirbyteSyncJobUnpatched {
  public jobId: string
  public inFlightBuffer: SyncRecord[] = []
  public durableStorage: SyncRecord[] = []
  public checkpointsCommitted: number = 0

  constructor(jobId: string = 'sync-job-unpatched-001') {
    this.jobId = jobId
  }

  /**
   * Ingests a stream of records and processes them with all-or-nothing end-of-job commit.
   * If a gateway disruption (HTTP 502) occurs, in-flight records are completely lost.
   */
  executeSync(records: SyncRecord[], triggerHttp502: boolean = true): SyncResult {
    this.inFlightBuffer = []
    this.durableStorage = []
    this.checkpointsCommitted = 0

    // Ingest records into memory buffer
    for (const record of records) {
      this.inFlightBuffer.push(record)
    }

    if (triggerHttp502) {
      // HTTP 502 Bad Gateway occurs mid-sync before final job commit:
      // Without incremental checkpoints, uncommitted in-flight buffer is discarded!
      const lostRecords = this.inFlightBuffer.length
      this.inFlightBuffer = [] // Dumped and discarded on crash

      return {
        jobId: this.jobId,
        totalEmitted: records.length,
        persistedRecords: 0,
        lostInFlightRecords: lostRecords,
        dataLossPercentage: 100.0,
        checkpointsCommitted: 0,
        status: 'FAILED_HTTP_502',
        errorMessage: 'HTTP 502 Bad Gateway: Upstream gateway connection severed during sync execution',
      }
    }

    // Normal path without crash: commit at end
    this.durableStorage.push(...this.inFlightBuffer)
    this.inFlightBuffer = []
    this.checkpointsCommitted = 1

    return {
      jobId: this.jobId,
      totalEmitted: records.length,
      persistedRecords: this.durableStorage.length,
      lostInFlightRecords: 0,
      dataLossPercentage: 0.0,
      checkpointsCommitted: 1,
      status: 'COMPLETED',
    }
  }
}
