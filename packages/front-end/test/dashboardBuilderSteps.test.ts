import { describe, expect, it } from "vitest";
import {
  builderChanges,
  builderSteps,
  BuilderToolCall,
  toolCallsFromMessages,
} from "@/enterprise/components/Dashboards/dashboardBuilderSteps";

const plan: BuilderToolCall = {
  id: "p",
  toolName: "planDashboard",
  status: "done",
  args: {
    title: "T",
    blocks: [
      { title: "A", kind: "line chart" },
      { title: "B", kind: "table" },
      { title: "C", kind: "text" },
    ],
  },
};
const add = (title: string, status: BuilderToolCall["status"]) => ({
  id: title,
  toolName: "addBlock",
  status,
  args: { title },
});

describe("builderSteps", () => {
  it("lists calls so far, then planned blocks not started", () => {
    const steps = builderSteps([plan, add("A", "done"), add("B", "running")]);
    expect(steps.map((s) => [s.label, s.detail, s.state])).toEqual([
      ["plan", "3 blocks", "done"],
      ["add_block", "line chart · A", "done"],
      ["add_block", "table · B", "running"],
      ["add_block", "text · C", "pending"],
    ]);
  });

  it("has no pending steps without a plan", () => {
    expect(builderSteps([add("A", "done")])).toHaveLength(1);
  });
});

describe("builderChanges", () => {
  it("counts only successful writes and collapses many adds", () => {
    expect(builderChanges([add("A", "done"), add("B", "error")])).toEqual([
      "Added A",
    ]);
    expect(
      builderChanges(["A", "B", "C", "D"].map((t) => add(t, "done"))),
    ).toEqual(["Added 4 blocks"]);
  });
});

describe("toolCallsFromMessages", () => {
  it("pairs calls with results and marks application errors", () => {
    const calls = toolCallsFromMessages([
      {
        role: "assistant",
        id: "1",
        ts: 0,
        content: [
          {
            type: "tool-call",
            toolCallId: "a",
            toolName: "addBlock",
            args: {},
          },
          {
            type: "tool-call",
            toolCallId: "b",
            toolName: "addBlock",
            args: {},
          },
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
            toolName: "addBlock",
            result: '{"status":"ok"}',
          },
          {
            type: "tool-result",
            toolCallId: "b",
            toolName: "addBlock",
            result: '{"status":"error","message":"x"}',
          },
        ],
      },
    ]);
    expect(calls.map((c) => c.status)).toEqual(["done", "error"]);
  });
});
