// distrib-provers/packages/distrib-core/src/api.ts

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  clearWorkflows,
  createWorkflow,
  insertNode,
} from './compiler/workflow-store.ts'
import { auditWorkflowReliabilityTool } from './mcp/tools/causal-audit.ts'
import { causalVerifyTool } from './mcp/tools/causal-verify.ts'

export interface WorkflowConfig {
  workflowId?: string
  workflowName?: string
  name?: string
  id?: string
  declaredInvariants?: string[]
  nodes: Array<{
    name: string
    nodeDescription?: string
    substrates?: any[]
    consonants?: any[]
    outboundEdges?: string[]
    metadata?: Record<string, unknown>
  }>
  seed?: number
  maxDepth?: number
  targetPath?: string[]
}

export function loadAndRegisterWorkflow(configPath: string): { workflowId: string; maxDepth: number; seed: number } {
  const content = fs.readFileSync(path.resolve(configPath), 'utf-8')
  const rawConfig: WorkflowConfig = JSON.parse(content)

  const workflowId = rawConfig.workflowId || rawConfig.id || 'workflow-1'
  const workflowName = rawConfig.workflowName || rawConfig.name || workflowId
  const declaredInvariants = Array.isArray(rawConfig.declaredInvariants)
    ? rawConfig.declaredInvariants
    : []

  const seed = typeof rawConfig.seed === 'number' ? rawConfig.seed : 42817
  const maxDepth = typeof rawConfig.maxDepth === 'number' ? rawConfig.maxDepth : 2

  clearWorkflows()
  createWorkflow(workflowId, workflowName, declaredInvariants)

  if (Array.isArray(rawConfig.nodes)) {
    for (const node of rawConfig.nodes) {
      insertNode(workflowId, {
        nodeName: node.name,
        nodeDescription: node.nodeDescription ?? '',
        substrates: Array.isArray(node.substrates) ? node.substrates : [],
        consonants: Array.isArray(node.consonants) ? node.consonants : [],
        outboundEdges: Array.isArray(node.outboundEdges) ? node.outboundEdges : [],
        metadata: node.metadata,
      })
    }
  }

  return { workflowId, maxDepth, seed }
}

export async function runAuditOnConfig(configPath: string, options: { maxDepth?: number; seed?: number } = {}) {
  const { workflowId, maxDepth, seed } = loadAndRegisterWorkflow(configPath)
  return await auditWorkflowReliabilityTool.handler({
    workflowId,
    maxDepth: options.maxDepth ?? maxDepth,
    seed: options.seed ?? seed,
  })
}

export async function runVerifyOnConfig(configPath: string, ablations: string[], options: { seed?: number } = {}) {
  const { workflowId, seed } = loadAndRegisterWorkflow(configPath)
  return await causalVerifyTool.handler({
    scenarioId: workflowId,
    ablations,
    seed: options.seed ?? seed,
  })
}
