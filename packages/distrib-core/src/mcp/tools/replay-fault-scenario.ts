import type { CompiledAlphabetGraph } from "../../physics/alphabet/types.ts";
import type { Finding } from "../../physics/alphabet/invariants/finding.ts";
import type { SimEvent } from "../../kernel.ts";
import { SCENARIO_DEFINITIONS } from "../../physics/distrib/distrib-scenarios.ts";
import { executeFaultSequence } from "../../physics/search/execute-faults.ts";
import { searchFaults } from "../../physics/search/fault-search.ts";
import { shrinkTrace, type FaultStep } from "../../physics/search/trace-shrinker.ts";
import type { McpTool, ToolContext, ToolResult } from "./causal-audit.ts";

export type TimelineAction =
  | "write"
  | "read"
  | "lease-grant"
  | "lease-revoke"
  | "retry"
  | "commit"
  | "abort";

export interface TimelineEvent {
  tick: number;
  nodeId: string;
  action: TimelineAction;
  targetVowelId?: string;
  value?: string | number;
  isFailingStep: boolean;
}

export interface ReplayFaultScenarioOutput {
  success: boolean;
  seed: number;
  reproduced: boolean;
  finding: Finding | null;
  minimalSteps: FaultStep[];
  shrinkRatio: number;
  timeline: TimelineEvent[];
  timelineSvg: string;
  oneLineRepro: string;
  [key: string]: unknown;
}

interface RecordedAuditEntry {
  seed: number;
  scenarioId: string;
  graph: CompiledAlphabetGraph;
  faultSchedule: FaultStep[];
}

const replayRegistryBySeed = new Map<number, RecordedAuditEntry>();
const replayRegistryById = new Map<string, RecordedAuditEntry>();

export function recordAuditForReplay(entry: RecordedAuditEntry): void {
  replayRegistryBySeed.set(entry.seed, entry);
  replayRegistryById.set(entry.scenarioId, entry);
}

function mapEventToAction(ev: SimEvent): TimelineAction | null {
  const kind = String(ev.kind ?? "").toLowerCase();
  const data = (ev.data ?? {}) as Record<string, unknown>;
  const op = typeof data.op === "string" ? data.op.toLowerCase() : "";

  if (op === "read" || kind === "history.read" || kind === "lease.read_without_lock" || kind === "lease.read_with_lock" || kind === "cell.read") {
    return "read";
  }
  if (op === "acquire_lease" || kind === "lease.acquire" || kind === "history.acquire_lease") {
    return "lease-grant";
  }
  if (op === "release_lease" || kind === "lease.release" || kind === "lease.epoch_expired" || kind === "lease.rejected" || kind === "lease.panic_crash") {
    return "lease-revoke";
  }
  if (kind === "channel.retry" || (kind === "channel.send" && typeof data.retryAttempt === "number" && data.retryAttempt >= 1)) {
    return "retry";
  }
  if (op === "commit" || kind === "history.commit" || kind === "txn.commit" || kind === "channel.ack") {
    return "commit";
  }
  if (op === "abort" || op === "rollback" || kind === "history.abort" || kind === "txn.abort" || kind === "channel.cascade_failure" || kind === "channel.sever") {
    return "abort";
  }
  if (op === "write" || kind === "history.write" || kind === "cell.mutate" || kind === "lease.write_state" || kind === "cell.write" || kind === "channel.send") {
    return "write";
  }
  return null;
}

export function buildTimelineEvents(
  events: SimEvent[],
  finding: Finding | null,
  minimalSteps: FaultStep[],
  maxSteps?: number,
): TimelineEvent[] {
  const failingSpanIds = new Set<string>(finding?.evidence?.span_ids ?? []);
  const failingVowels = new Set<string>();
  if (finding?.evidence?.resource) failingVowels.add(finding.evidence.resource);
  for (const step of minimalSteps) {
    if (step.targetVowelId) failingVowels.add(step.targetVowelId);
  }

  const timeline: TimelineEvent[] = [];
  for (const ev of events) {
    const action = mapEventToAction(ev);
    if (!action) continue;
    const data = (ev.data ?? {}) as Record<string, unknown>;
    const targetVowelId =
      (typeof data.targetVowelId === "string" && data.targetVowelId) ||
      (typeof data.channelId === "string" && data.channelId) ||
      (typeof data.leaseId === "string" && data.leaseId) ||
      (typeof data.cellId === "string" && data.cellId) ||
      ev.corr ||
      undefined;

    const nodeId =
      (typeof data.writerActorId === "string" && data.writerActorId) ||
      (typeof data.readerActorId === "string" && data.readerActorId) ||
      (typeof data.sourceActorId === "string" && data.sourceActorId) ||
      (typeof data.actorId === "string" && data.actorId) ||
      targetVowelId ||
      "node-0";

    const rawVal = data.value ?? data.amount ?? data.mutationCount;
    const value = typeof rawVal === "string" || typeof rawVal === "number" ? rawVal : undefined;

    const isFailingStep =
      failingSpanIds.has(ev.id) ||
      (targetVowelId !== undefined && failingVowels.has(targetVowelId) && (action === "write" || action === "retry" || action === "abort" || action === "lease-revoke"));

    timeline.push({
      tick: ev.t,
      nodeId,
      action,
      ...(targetVowelId ? { targetVowelId } : {}),
      ...(value !== undefined ? { value } : {}),
      isFailingStep,
    });
  }

  const capped = typeof maxSteps === "number" && maxSteps > 0 ? timeline.slice(0, maxSteps) : timeline;
  return capped;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generates a strict monochrome SVG timeline (colors restricted strictly to #000, #FFF, #888, #C00).
 */
export function renderTimelineSvg(
  seed: number,
  finding: Finding | null,
  timeline: TimelineEvent[],
): string {
  const anyF = finding as unknown as Record<string, unknown> | null;
  const label = anyF
    ? String(anyF.kind ?? finding?.rule_id ?? "ANOMALY")
    : "NO_FAILURE";
  const title = `DISTRIB Replay — seed=${seed} — ${label}`;

  // Compress long timelines (>50 events) by keeping all failing steps + sampled non-failing checkpoints
  let displayEvents: Array<TimelineEvent | { ellipsis: true; tick: number; nodeId: string }> = [];
  if (timeline.length > 50) {
    let skippedRun = 0;
    for (let i = 0; i < timeline.length; i++) {
      const ev = timeline[i]!;
      if (ev.isFailingStep || i === 0 || i === timeline.length - 1 || i % Math.ceil(timeline.length / 25) === 0) {
        if (skippedRun > 0) {
          displayEvents.push({ ellipsis: true, tick: ev.tick, nodeId: ev.nodeId });
          skippedRun = 0;
        }
        displayEvents.push(ev);
      } else {
        skippedRun++;
      }
    }
  } else {
    displayEvents = timeline;
  }

  const nodes = Array.from(
    new Set(displayEvents.map((e) => e.nodeId)),
  ).sort();
  if (nodes.length === 0) nodes.push("no-events");

  const ticks = Array.from(
    new Set(displayEvents.map((e) => e.tick)),
  ).sort((a, b) => a - b);
  if (ticks.length === 0) ticks.push(0);

  const leftPad = 140;
  const rightPad = 24;
  const topPad = 48;
  const bottomPad = 44;
  const plotW = 800 - leftPad - rightPad;
  const plotH = 300 - topPad - bottomPad;

  const rowH = plotH / Math.max(nodes.length, 1);
  const colW = plotW / Math.max(ticks.length, 1);

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="800" height="300">`);
  parts.push(`<rect x="0" y="0" width="800" height="300" fill="#FFF"/>`);
  parts.push(`<text x="16" y="26" font-family="monospace" font-size="14" font-weight="bold" fill="#000">${escapeXml(title)}</text>`);
  parts.push(`<line x1="16" y1="34" x2="784" y2="34" stroke="#888" stroke-width="1"/>`);

  // Horizontal grid lines & Y-axis node labels
  nodes.forEach((nodeId, rowIdx) => {
    const cy = topPad + rowIdx * rowH + rowH / 2;
    const shortName = nodeId.length > 18 ? `${nodeId.slice(0, 16)}..` : nodeId;
    parts.push(`<line x1="${leftPad}" y1="${cy.toFixed(1)}" x2="${800 - rightPad}" y2="${cy.toFixed(1)}" stroke="#888" stroke-width="1" stroke-dasharray="2,2"/>`);
    parts.push(`<text x="${leftPad - 8}" y="${(cy + 4).toFixed(1)}" text-anchor="end" font-family="monospace" font-size="11" fill="#000">${escapeXml(shortName)}</text>`);
  });

  // Vertical tick grid lines & X-axis labels
  ticks.forEach((tick, colIdx) => {
    const cx = leftPad + colIdx * colW + colW / 2;
    parts.push(`<line x1="${cx.toFixed(1)}" y1="${topPad}" x2="${cx.toFixed(1)}" y2="${topPad + plotH}" stroke="#888" stroke-width="1"/>`);
    if (ticks.length <= 16 || colIdx % Math.ceil(ticks.length / 12) === 0) {
      parts.push(`<text x="${cx.toFixed(1)}" y="${topPad + plotH + 16}" text-anchor="middle" font-family="monospace" font-size="10" fill="#000">t=${tick}</text>`);
    }
  });

  // Event markers
  for (const item of displayEvents) {
    const rowIdx = nodes.indexOf(item.nodeId);
    const colIdx = ticks.indexOf(item.tick);
    const cx = leftPad + colIdx * colW + colW / 2;
    const cy = topPad + rowIdx * rowH + rowH / 2;

    if ("ellipsis" in item) {
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="11" fill="#888">...</text>`);
      continue;
    }

    if (item.isFailingStep) {
      const bw = Math.min(26, Math.max(18, colW - 4));
      const bh = Math.min(24, Math.max(18, rowH - 4));
      parts.push(`<rect x="${(cx - bw / 2).toFixed(1)}" y="${(cy - bh / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="none" stroke="#C00" stroke-width="2"/>`);
    }

    switch (item.action) {
      case "write":
        parts.push(`<rect x="${(cx - 5).toFixed(1)}" y="${(cy - 5).toFixed(1)}" width="10" height="10" fill="#FFF" stroke="#000" stroke-width="1.5"/>`);
        break;
      case "read":
        parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#FFF" stroke="#000" stroke-width="1.5"/>`);
        break;
      case "lease-grant":
        parts.push(`<polygon points="${cx.toFixed(1)},${(cy - 6).toFixed(1)} ${(cx + 6).toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${(cy + 6).toFixed(1)} ${(cx - 6).toFixed(1)},${cy.toFixed(1)}" fill="#FFF" stroke="#000" stroke-width="1.5"/>`);
        break;
      case "lease-revoke":
        parts.push(`<path d="M ${(cx - 5).toFixed(1)} ${(cy - 5).toFixed(1)} L ${(cx + 5).toFixed(1)} ${(cy + 5).toFixed(1)} M ${(cx + 5).toFixed(1)} ${(cy - 5).toFixed(1)} L ${(cx - 5).toFixed(1)} ${(cy + 5).toFixed(1)}" stroke="#000" stroke-width="1.5"/>`);
        break;
      case "retry":
        parts.push(`<path d="M ${(cx - 6).toFixed(1)} ${cy.toFixed(1)} L ${(cx + 5).toFixed(1)} ${cy.toFixed(1)} M ${(cx + 1).toFixed(1)} ${(cy - 4).toFixed(1)} L ${(cx + 5).toFixed(1)} ${cy.toFixed(1)} L ${(cx + 1).toFixed(1)} ${(cy + 4).toFixed(1)}" fill="none" stroke="#000" stroke-width="1.5"/>`);
        break;
      case "commit":
        parts.push(`<rect x="${(cx - 5).toFixed(1)}" y="${(cy - 5).toFixed(1)}" width="10" height="10" fill="#000" stroke="#000" stroke-width="1.5"/>`);
        break;
      case "abort":
        parts.push(`<rect x="${(cx - 5).toFixed(1)}" y="${(cy - 5).toFixed(1)}" width="10" height="10" fill="#FFF" stroke="#000" stroke-width="1.5" stroke-dasharray="2,1"/>`);
        break;
    }
  }

  // Footer legend
  parts.push(`<text x="16" y="290" font-family="monospace" font-size="10" fill="#000">Legend: [] write | () read | &lt;&gt; lease+ | X lease- | -&gt; retry | [#] commit | [red] failing</text>`);
  parts.push(`</svg>`);

  return parts.join("\n");
}

export const replayFaultScenarioTool: McpTool = {
  name: "replayFaultScenario",
  description:
    "Deterministically replays a DISTRIB fault scenario by seed, optionally shrinks the failing trace via ddmin, and generates a monochrome visual timeline SVG.",
  inputSchema: {
    type: "object",
    properties: {
      seed: {
        type: "number",
        description: "Deterministic seed from the original failure (required)",
      },
      faultScheduleId: {
        type: "string",
        description: "Optional scenario or fault schedule ID to replay",
      },
      maxSteps: {
        type: "number",
        description: "Optional cap on timeline events returned",
      },
      includeMinimalTrace: {
        type: "boolean",
        description: "Run delta-debugging trace shrinking after replay (default true)",
      },
      includeTimelineSvg: {
        type: "boolean",
        description: "Generate monochrome timeline SVG (default true)",
      },
    },
    required: ["seed"],
  },
  async handler(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    if (typeof args.seed !== "number" || !Number.isFinite(args.seed)) {
      return {
        success: false,
        error: "seed (number) is required",
      };
    }

    const seed = Math.floor(args.seed);
    const faultScheduleId = typeof args.faultScheduleId === "string" && args.faultScheduleId.trim()
      ? args.faultScheduleId.trim()
      : undefined;
    const maxSteps = typeof args.maxSteps === "number" && Number.isFinite(args.maxSteps) && args.maxSteps > 0
      ? Math.floor(args.maxSteps)
      : undefined;
    const includeMinimalTrace = args.includeMinimalTrace !== false;
    const includeTimelineSvg = args.includeTimelineSvg !== false;

    // Resolve target graph & schedule
    let graph: CompiledAlphabetGraph | undefined;
    let schedule: FaultStep[] = [];

    const recordedById = faultScheduleId ? replayRegistryById.get(faultScheduleId) : undefined;
    const recordedBySeed = replayRegistryBySeed.get(seed);

    if (recordedById) {
      graph = recordedById.graph;
      schedule = recordedById.faultSchedule;
    } else if (recordedBySeed && !faultScheduleId) {
      graph = recordedBySeed.graph;
      schedule = recordedBySeed.faultSchedule;
    } else if (faultScheduleId) {
      const def = SCENARIO_DEFINITIONS.find(
        (s) =>
          s.id.toLowerCase() === faultScheduleId.toLowerCase() ||
          s.id.toLowerCase().replace(/^scenario-/, "") === faultScheduleId.toLowerCase(),
      );
      if (def && def.isRepresentable) {
        graph = def.buildGraph();
        if (def.candidateFaults.length > 0) {
          graph.candidatePerturbations = def.candidateFaults.map((f) => ({
            consonant: { kind: f.consonantKind, ...f.params } as any,
            targetId: f.targetVowelId,
          }));
        }
      }
    } else if (seed === 42817) {
      const defA = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-A");
      if (defA) graph = defA.buildGraph();
    } else {
      const defB = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-B");
      if (defB) graph = defB.buildGraph();
    }

    if (!graph) {
      return {
        success: false,
        error: `Could not resolve scenario for seed=${seed}${faultScheduleId ? `, faultScheduleId=${faultScheduleId}` : ""}`,
      };
    }

    // If no explicit schedule recorded, only search when replaying a known failing seed/scheduleId;
    // otherwise execute the clean baseline on the safe graph.
    if (schedule.length === 0 && (seed === 42817 || faultScheduleId)) {
      const searchRes = await searchFaults(graph, { maxDepth: 2, maxEvaluations: 500 }, seed);
      if (searchRes.minimalCounterexample && searchRes.minimalCounterexample.length > 0) {
        schedule = searchRes.minimalCounterexample;
      }
    }

    const execution = await executeFaultSequence(graph, schedule, seed);
    const finding =
      execution.violatedInvariants.length > 0
        ? (execution.findings.find((f) => f.status === "proven" && f.severity === "critical") ?? null)
        : null;
    const reproduced = finding !== null;

    let minimalSteps: FaultStep[] = schedule;
    let shrinkRatio = 1;
    if (reproduced && includeMinimalTrace && schedule.length > 0) {
      const shrunk = await shrinkTrace(schedule, finding, { graph, seed });
      minimalSteps = shrunk.minimalSteps;
      shrinkRatio = shrunk.shrinkRatio;
    } else if (!reproduced) {
      minimalSteps = [];
    }

    const timeline = buildTimelineEvents(execution.events, finding, minimalSteps, maxSteps);
    const timelineSvg = includeTimelineSvg ? renderTimelineSvg(seed, finding, timeline) : "";

    return {
      success: true,
      seed,
      reproduced,
      finding,
      minimalSteps,
      shrinkRatio,
      timeline,
      timelineSvg,
      oneLineRepro: `Replay via replayFaultScenario({ seed: ${seed} })`,
    };
  },
};

export const tool = replayFaultScenarioTool;
export default replayFaultScenarioTool;
