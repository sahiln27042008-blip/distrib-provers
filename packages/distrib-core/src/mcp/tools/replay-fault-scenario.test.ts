import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  replayFaultScenarioTool,
  renderTimelineSvg,
  type TimelineEvent,
} from "./replay-fault-scenario.ts";
import { auditWorkflowReliabilityTool } from "./causal-audit.ts";
import { TOOL_MAP } from "../server.ts";

const ALLOWED_HEX = new Set(["#000", "#FFF", "#888", "#C00"]);

function extractHexColors(svg: string): string[] {
  return (svg.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) => h.toUpperCase());
}

describe("MCP replayFaultScenario + Monochrome Visual Timeline SVG", () => {
  it("0. is registered in MCP server TOOL_MAP", () => {
    assert.ok(TOOL_MAP.has("replayFaultScenario"), "replayFaultScenario must be registered in TOOL_MAP");
  });

  it("1. replays a known failing seed (42817) -> reproduced=true, finding populated", async () => {
    const res = await replayFaultScenarioTool.handler({ seed: 42817 });
    assert.equal(res.success, true);
    assert.equal(res.seed, 42817);
    assert.equal(res.reproduced, true);
    assert.ok(res.finding !== null, "Expected non-null finding for failing seed");
  });

  it("2. replays a non-failing seed (999999) -> reproduced=false, finding=null", async () => {
    const res = await replayFaultScenarioTool.handler({ seed: 999999 });
    assert.equal(res.success, true);
    assert.equal(res.seed, 999999);
    assert.equal(res.reproduced, false);
    assert.equal(res.finding, null);
  });

  it("3. generates timelineSvg starting with '<svg' and containing viewBox='0 0 800 300'", async () => {
    const res = await replayFaultScenarioTool.handler({ seed: 42817 });
    const svg = String(res.timelineSvg);
    assert.ok(svg.startsWith("<svg"), "SVG must start with <svg");
    assert.ok(svg.includes('viewBox="0 0 800 300"'), "SVG must contain viewBox=\"0 0 800 300\"");
  });

  it("4. enforces strict monochrome palette (#000, #FFF, #888, #C00 only)", async () => {
    const res = await replayFaultScenarioTool.handler({ seed: 42817 });
    const svg = String(res.timelineSvg);
    const foundHex = extractHexColors(svg);
    assert.ok(foundHex.length > 0, "Expected hex colors in SVG");
    for (const hex of foundHex) {
      assert.ok(ALLOWED_HEX.has(hex), `Disallowed hex color ${hex} found in SVG`);
    }
  });

  it("5. includes at least one failing step border (stroke=\"#C00\") on failure", async () => {
    const res = await replayFaultScenarioTool.handler({ seed: 42817 });
    const svg = String(res.timelineSvg);
    assert.ok(svg.includes('stroke="#C00"'), 'Expected failing step border stroke="#C00"');
  });

  it("6. returns minimalSteps when includeMinimalTrace=true", async () => {
    const res = await replayFaultScenarioTool.handler({
      seed: 42817,
      includeMinimalTrace: true,
    });
    const minimalSteps = res.minimalSteps as unknown[];
    assert.ok(Array.isArray(minimalSteps) && minimalSteps.length > 0, "Expected non-empty minimalSteps");
    assert.equal(typeof res.shrinkRatio, "number");
  });

  it("7. includes seed number in oneLineRepro", async () => {
    const res = await replayFaultScenarioTool.handler({ seed: 42817 });
    assert.ok(String(res.oneLineRepro).includes("42817"), "oneLineRepro must include seed number");
  });

  it("8. returns empty timelineSvg when includeTimelineSvg=false while keeping timeline events", async () => {
    const res = await replayFaultScenarioTool.handler({
      seed: 42817,
      includeTimelineSvg: false,
    });
    assert.equal(res.timelineSvg, "");
    const timeline = res.timeline as TimelineEvent[];
    assert.ok(Array.isArray(timeline) && timeline.length > 0, "Expected timeline events even when SVG disabled");
  });

  it("9. end-to-end: auditWorkflowReliabilityTool -> finding.seed -> replayFaultScenario({ seed })", async () => {
    const auditRes = await auditWorkflowReliabilityTool.handler({
      scenarioId: "scenario-A",
      maxDepth: 2,
      seed: 849201,
    });

    assert.equal(auditRes.success, true);
    assert.equal(auditRes.verdict, "BLOCKED");
    const findings = auditRes.findings as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(findings) && findings.length > 0);
    const seed = findings[0]!.seed as number;
    assert.equal(seed, 849201);

    const replayRes = await replayFaultScenarioTool.handler({ seed });
    assert.equal(replayRes.success, true);
    assert.equal(replayRes.reproduced, true);
    assert.ok(String(replayRes.timelineSvg).startsWith("<svg"));
    assert.ok(String(replayRes.timelineSvg).includes("seed=849201"));
  });

  it("10. compresses long timelines (>50 events) with ellipsis markers while keeping failing steps", () => {
    const longTimeline: TimelineEvent[] = Array.from({ length: 80 }, (_, i) => ({
      tick: i * 10,
      nodeId: `node-${i % 3}`,
      action: i === 42 ? "abort" : "read",
      isFailingStep: i === 42,
    }));
    const svg = renderTimelineSvg(777, null, longTimeline);
    assert.ok(svg.includes("..."), "Expected ellipsis compression marker for >50 events");
    assert.ok(svg.includes('stroke="#C00"'), "Expected failing step border preserved after compression");
  });
});
