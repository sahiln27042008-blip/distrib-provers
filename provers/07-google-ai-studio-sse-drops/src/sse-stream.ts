/**
 * Google AI Studio / Gemini SSE Streaming Client (Unpatched Baseline)
 * 
 * Demonstrates:
 * - Mid-stream SSE network disconnection or worker restart (premature EOF).
 * - Client lacks chunk-level resumption buffer and fenced prompt cache lease.
 * - On mid-stream failure, client blindly retries by re-dispatching the full 500k prompt context from token 0.
 * - Ephemeral prompt cache lease is wiped/invalidated, causing full token re-billing and burned quota.
 */

export interface PromptContext {
  promptId: string
  contextTokens: number // 500,000 tokens
  costPerMillionPromptTokens: number // $2.00 / 1M prompt tokens
  costPerMillionOutputTokens: number // $10.00 / 1M output tokens
}

export interface StreamChunk {
  chunkId: number
  text: string
  tokens: number
}

export interface StreamResult {
  completed: boolean
  chunksReceived: number
  outputTokensReceived: number
  promptTokensBilled: number
  reBilledPromptTokens: number
  totalCostUsd: number
  cacheWiped: boolean
  wastedOutputTokens: number
  reDispatches: number
  resumedFromChunk: boolean
  error?: string
}

export class SseStreamClientUnpatched {
  public promptContext: PromptContext
  public isCacheValid: boolean = true

  constructor(promptContext?: Partial<PromptContext>) {
    this.promptContext = {
      promptId: promptContext?.promptId ?? 'prompt-gemini-500k-ctx',
      contextTokens: promptContext?.contextTokens ?? 500_000,
      costPerMillionPromptTokens: promptContext?.costPerMillionPromptTokens ?? 2.0,
      costPerMillionOutputTokens: promptContext?.costPerMillionOutputTokens ?? 10.0,
    }
  }

  /**
   * Executes streaming generation with unpatched client.
   * Simulates mid-stream EOF drop at `dropAtChunk` (e.g. chunk 12 of 20).
   * In unpatched client, chunk-level resumption is absent and cache is ephemeral:
   * Client drops in-flight tokens, wipes ephemeral cache, and re-dispatches full 500k context from token 0.
   */
  executeStream(totalChunks: number = 20, dropAtChunk: number = 12): StreamResult {
    const tokensPerChunk = 100 // 2,000 total output tokens
    let promptTokensBilled = 0
    let reBilledPromptTokens = 0
    let reDispatches = 0
    let wastedOutputTokens = 0

    // Initial dispatch: bills initial 500k prompt tokens
    promptTokensBilled += this.promptContext.contextTokens

    let receivedChunks = 0
    let outputTokens = 0

    // Stream chunks up to dropAtChunk
    for (let c = 1; c < dropAtChunk; c++) {
      receivedChunks++
      outputTokens += tokensPerChunk
    }

    // Mid-stream drop occurs: premature EOF on SSE stream
    // Unpatched client does not have a chunk resumption buffer:
    // in-flight chunks are discarded and lost!
    wastedOutputTokens += outputTokens
    receivedChunks = 0
    outputTokens = 0

    // Inference worker restart or connection termination wipes ephemeral prompt cache lease!
    this.isCacheValid = false

    // Blind retry: Client re-dispatches entire 500,000 token context from token 0!
    reDispatches++
    reBilledPromptTokens += this.promptContext.contextTokens
    promptTokensBilled += this.promptContext.contextTokens

    // Stream completes from scratch after full context re-dispatch
    for (let c = 1; c <= totalChunks; c++) {
      receivedChunks++
      outputTokens += tokensPerChunk
    }

    const promptCost = (promptTokensBilled / 1_000_000) * this.promptContext.costPerMillionPromptTokens
    const outputCost = (outputTokens / 1_000_000) * this.promptContext.costPerMillionOutputTokens
    const totalCostUsd = Number((promptCost + outputCost).toFixed(4))

    return {
      completed: true,
      chunksReceived: receivedChunks,
      outputTokensReceived: outputTokens,
      promptTokensBilled,
      reBilledPromptTokens,
      totalCostUsd,
      cacheWiped: !this.isCacheValid,
      wastedOutputTokens,
      reDispatches,
      resumedFromChunk: false,
      error: 'Mid-stream EOF: Stream disconnected at chunk ' + dropAtChunk + '; full context re-dispatched',
    }
  }
}
