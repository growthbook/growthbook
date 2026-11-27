import { describe, expect, it } from "vitest";
import {
  addingBlockTitle,
  builderChanges,
  builderSteps,
  BuilderToolCall,
  isBuilderWrite,
  toolCallsFromMessages,
} from "@/enterprise/components/Dashboards/dashboardBuilderSteps";

const DRAFT = "/api/v2/dashboards/dash_1/draft";
const api = (
  id: string,
  method: string,
  path: string,
  body?: unknown,
  status: BuilderToolCall["status"] = "done",
): BuilderToolCall => ({
  id,
  toolName: "callApi",
  status,
  args: { method, path, body },
});
const plan: BuilderToolCall = {
  id: "p",
  toolName: "planDashboard",
  status: "done",
  args: {
    title: "T",
    blocks: [
      { title: "A", kind: "line chart" },
      { title: "B", kind: "table" },
      { title: "C", kind: "funnel" },
    ],
  },
};
const add = (title: string, status: BuilderToolCall["status"] = "done") =>
  api(title, "POST", `${DRAFT}/blocks`, { title }, status);

describe("builderSteps", () => {
  it("names API calls, then lists planned blocks not started", () => {
    const steps = builderSteps([
      {
        id: "s",
        toolName: "loadSkill",
        status: "done",
        args: { name: "analytics" },
      },
      api("f", "GET", "/api/v1/fact-tables?limit=5"),
      plan,
      api("g", "PUT", DRAFT, { globalControls: {} }),
      add("A"),
      add("B", "running"),
    ]);
    expect(steps.map((s) => [s.label, s.detail, s.state])).toEqual([
      ["load_skill", "analytics", "done"],
      ["read_schema", "", "done"],
      ["plan", "3 blocks", "done"],
      ["add_filters", "Date range", "done"],
      ["add_block", "line chart · A", "done"],
      ["add_block", "table · B", "running"],
      ["add_block", "funnel · C", "pending"],
    ]);
  });

  it("reads a body sent as a JSON string", () => {
    const call = api("x", "POST", `${DRAFT}/blocks`, '{"title":"Z"}');
    expect(addingBlockTitle(call)).toBe("Z");
  });

  it("has no pending steps without a plan", () => {
    expect(builderSteps([add("A")])).toHaveLength(1);
  });
});

describe("isBuilderWrite", () => {
  it("is true for draft writes and false for reads and queries", () => {
    expect(isBuilderWrite(add("A"))).toBe(true);
    expect(isBuilderWrite(api("d", "DELETE", `${DRAFT}/blocks/b1`))).toBe(true);
    expect(isBuilderWrite(api("r", "GET", DRAFT))).toBe(false);
    expect(
      isBuilderWrite(
        api("q", "POST", "/api/v1/product-analytics/metric-exploration"),
      ),
    ).toBe(false);
  });
});

describe("builderChanges", () => {
  it("counts only successful writes and collapses many adds", () => {
    expect(builderChanges([add("A"), add("B", "error")])).toEqual(["Added A"]);
    expect(builderChanges(["A", "B", "C", "D"].map((t) => add(t)))).toEqual([
      "Added 4 blocks",
    ]);
    expect(
      builderChanges([
        api("d", "DELETE", `${DRAFT}/blocks/b1`),
        api("n", "PUT", DRAFT, { title: "New" }),
      ]),
    ).toEqual(["Removed 1 block", "Renamed to New"]);
  });
});

describe("toolCallsFromMessages", () => {
  it("pairs calls with results and marks failed HTTP calls", () => {
    const calls = toolCallsFromMessages([
      {
        role: "assistant",
        id: "1",
        ts: 0,
        content: [
          { type: "tool-call", toolCallId: "a", toolName: "callApi", args: {} },
          { type: "tool-call", toolCallId: "b", toolName: "callApi", args: {} },
        ],
      },
      {
        role: "tool",
        id: "2",
        ts: 0,
        content: [
          {
            type: "tool-result",
            toolCallId: "a",
            toolName: "callApi",
            result: '{"status":200,"body":{}}',
          },
          {
            type: "tool-result",
            toolCallId: "b",
            toolName: "callApi",
            result: '{"status":400,"body":{"message":"x"}}',
          },
        ],
      },
    ]);
    expect(calls.map((c) => c.status)).toEqual(["done", "error"]);
  });
});
