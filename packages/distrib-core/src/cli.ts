#!/usr/bin/env node
// enterpriseee/enterprise-simulator/src/cli.ts

import * as fs from "node:fs";
import * as path from "node:path";
import {
  clearWorkflows,
  createWorkflow,
  insertNode,
  type SubstrateAssignment,
  type ConsonantAssignment,
} from "./compiler/workflow-store.ts";
import { auditWorkflowReliabilityTool } from "./mcp/tools/causal-audit.ts";
import { causalVerifyTool } from "./mcp/tools/causal-verify.ts";

interface ConfigNode {
  name: string;
  nodeDescription?: string;
  substrates?: SubstrateAssignment[];
  consonants?: ConsonantAssignment[];
  outboundEdges?: string[];
  metadata?: Record<string, unknown>;
}

interface WorkflowConfig {
  workflowId?: string;
  workflowName?: string;
  name?: string;
  id?: string;
  declaredInvariants?: string[];
  nodes: ConfigNode[];
  seed?: number;
  maxDepth?: number;
  targetPath?: string[];
}

function printUsageAndExit(): never {
  console.error(`Usage:
  node --experimental-strip-types src/cli.ts audit --config <path-to-config.json> [--seed <n>] [--maxDepth <n>] [--targetPath <node1,node2>]
  node --experimental-strip-types src/cli.ts verify --config <path-to-config.json> --ablations <a1,a2> [--seed <n>]
`);
  process.exit(1);
}

function parseArgs(args: string[]): {
  command: "audit" | "verify";
  configPath: string;
  seed?: number;
  maxDepth?: number;
  targetPath?: string[];
  ablations?: string[];
} {
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printUsageAndExit();
  }

  const command = args[0];
  if (command !== "audit" && command !== "verify") {
    console.error(`Error: Unknown command "${command}". Must be "audit" or "verify".`);
    printUsageAndExit();
  }

  let configPath = "";
  let seed: number | undefined;
  let maxDepth: number | undefined;
  let targetPath: string[] | undefined;
  let ablations: string[] | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") {
      configPath = args[++i] ?? "";
    } else if (arg === "--seed") {
      seed = Number(args[++i]);
    } else if (arg === "--maxDepth") {
      maxDepth = Number(args[++i]);
    } else if (arg === "--targetPath") {
      const raw = args[++i] ?? "";
      targetPath = raw.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--ablations" || arg === "--ablation") {
      const raw = args[++i] ?? "";
      ablations = raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  if (!configPath) {
    console.error("Error: --config <path-to-config.json> is required.");
    printUsageAndExit();
  }

  return { command, configPath, seed, maxDepth, targetPath, ablations };
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  const resolvedConfigPath = path.resolve(process.cwd(), parsed.configPath);
  if (!fs.existsSync(resolvedConfigPath)) {
    console.error(`Error: Config file not found at ${resolvedConfigPath}`);
    process.exit(1);
  }

  let rawConfig: WorkflowConfig;
  try {
    const content = fs.readFileSync(resolvedConfigPath, "utf-8");
    rawConfig = JSON.parse(content);
  } catch (err) {
    console.error(`Error: Failed to parse JSON config at ${resolvedConfigPath}:`, err);
    process.exit(1);
  }

  const workflowId = rawConfig.workflowId || rawConfig.id || "workflow-1";
  const workflowName = rawConfig.workflowName || rawConfig.name || workflowId;
  const declaredInvariants = Array.isArray(rawConfig.declaredInvariants)
    ? rawConfig.declaredInvariants
    : [];

  const seed = parsed.seed ?? (typeof rawConfig.seed === "number" ? rawConfig.seed : 42817);
  const maxDepth = parsed.maxDepth ?? (typeof rawConfig.maxDepth === "number" ? rawConfig.maxDepth : 3);
  const targetPath = parsed.targetPath ?? rawConfig.targetPath;

  // 1. Clear previous workflow state in store
  clearWorkflows();

  // 2. Create the workflow in in-memory store
  createWorkflow(workflowId, workflowName, declaredInvariants);

  // 3. Insert each node sequentially
  if (Array.isArray(rawConfig.nodes)) {
    for (const node of rawConfig.nodes) {
      insertNode(workflowId, {
        nodeName: node.name,
        nodeDescription: node.nodeDescription ?? "",
        substrates: Array.isArray(node.substrates) ? node.substrates : [],
        consonants: Array.isArray(node.consonants) ? node.consonants : [],
        outboundEdges: Array.isArray(node.outboundEdges) ? node.outboundEdges : [],
        metadata: node.metadata,
      });
    }
  }

  if (parsed.command === "audit") {
    const result = await auditWorkflowReliabilityTool.handler({
      workflowId,
      maxDepth,
      seed,
      targetPath,
    });

    const output = {
      verdict: result.verdict,
      status: result.status,
      scenarioId: result.scenarioId,
      shortestDepth: result.shortestDepth,
      violatedInvariants: result.violatedInvariants ?? [],
      minimalCounterexample: result.minimalCounterexample ?? [],
      evaluationsCount: result.evaluationsCount ?? 0,
      durationMs: result.durationMs ?? 0,
      executiveSummary: result.executiveSummary,
      findings: result.findings ?? [],
    };

    console.log(JSON.stringify(output, null, 2));

    if (result.verdict === "BLOCKED") {
      process.exit(2);
    } else {
      process.exit(0);
    }
  } else if (parsed.command === "verify") {
    const ablations = parsed.ablations ?? [];
    if (ablations.length === 0) {
      console.error("Error: --ablations is required for verify command.");
      process.exit(1);
    }

    const result = await causalVerifyTool.handler({
      scenarioId: workflowId,
      ablations,
      seed,
    });

    const output = {
      verdict: result.verdict,
      status: result.status,
      scenarioId: result.scenarioId,
      appliedAblations: result.appliedAblations ?? ablations,
      violatedInvariants: result.violatedInvariants ?? [],
      minimalCounterexample: result.minimalCounterexample ?? [],
      evaluationsCount: result.evaluationsCount ?? 0,
      durationMs: result.durationMs ?? 0,
      executiveSummary: result.executiveSummary,
      findings: result.findings ?? [],
    };

    console.log(JSON.stringify(output, null, 2));

    if (result.verdict === "VERIFIED" || result.verdict === "APPROVED") {
      process.exit(0);
    } else {
      process.exit(2);
    }
  }
}

main().catch((err) => {
  console.error("CLI Execution Error:", err);
  process.exit(1);
});
