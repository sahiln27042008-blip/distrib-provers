/**
 * Cross-Bank Zelle Clearing Bridge (Unpatched Baseline)
 * 
 * Demonstrates the Nov 16, 2026 JPMC / Zelle double-spending failure:
 * - Hanging counterparty (Chase on-prem bug) severs response POST_COMMIT.
 * - Missing cross-bank idempotency keys cause unconfirmed client retries
 *   to commit duplicate settlements against sender ledgers.
 */

export interface TransferRequest {
  transferId: string
  senderId: string
  recipientId: string
  amountDollars: number
  retryCount?: number
}

export interface BankAccount {
  accountId: string
  balanceDollars: number
  postedTransactions: Array<{ txId: string; amount: number; description: string }>
}

export class ClearingBridgeUnpatched {
  private senderAccounts: Map<string, BankAccount> = new Map()
  private counterpartyResponses: Map<string, 'SUCCESS' | 'TIMEOUT_AFTER_COMMIT'> = new Map()

  public totalCommittedDebits: number = 0

  constructor(accounts: BankAccount[]) {
    for (const acc of accounts) {
      this.senderAccounts.set(acc.accountId, {
        accountId: acc.accountId,
        balanceDollars: acc.balanceDollars,
        postedTransactions: [...acc.postedTransactions],
      })
    }
  }

  setCounterpartyBehavior(transferIdPrefix: string, behavior: 'SUCCESS' | 'TIMEOUT_AFTER_COMMIT') {
    this.counterpartyResponses.set(transferIdPrefix, behavior)
  }

  /**
   * Process a transfer. Without idempotency checking, each retry debits the account again!
   */
  processTransfer(request: TransferRequest): { success: boolean; inDoubt: boolean } {
    const sender = this.senderAccounts.get(request.senderId)
    if (!sender) throw new Error('Sender account not found')

    if (sender.balanceDollars < request.amountDollars) {
      return { success: false, inDoubt: false }
    }

    // Unpatched: Direct debit committed immediately
    sender.balanceDollars -= request.amountDollars
    sender.postedTransactions.push({
      txId: `${request.transferId}-try-${request.retryCount ?? 0}`,
      amount: -request.amountDollars,
      description: `Zelle transfer to ${request.recipientId}`,
    })
    this.totalCommittedDebits += request.amountDollars

    // Simulate Chase Counterparty response
    const behavior = this.counterpartyResponses.get(request.transferId) || 'SUCCESS'
    if (behavior === 'TIMEOUT_AFTER_COMMIT') {
      // Counterparty accepted funds internally, but the connection hung and dropped ACK!
      return { success: false, inDoubt: true }
    }

    return { success: true, inDoubt: false }
  }

  getAccount(accountId: string): BankAccount | undefined {
    return this.senderAccounts.get(accountId)
  }
}
