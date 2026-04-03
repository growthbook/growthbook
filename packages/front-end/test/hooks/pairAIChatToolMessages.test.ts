import { describe, expect, it } from "vitest";
import type { AIChatMessage } from "@/enterprise/hooks/useAIChat/types";
import { findToolCallPart } from "@/enterprise/hooks/useAIChat/pairAIChatToolMessages";

describe("findToolCallPart", () => {
  const assistantMsg: AIChatMessage = {
    role: "assistant",
    id: "a1",
    ts: 1,
    content: [
      {
        type: "tool-call",
        toolCallId: "call_a",
        toolName: "searchMetrics",
        args: { query: "a" },
      },
      {
        type: "tool-call",
        toolCallId: "call_b",
        toolName: "searchMetrics",
        args: { query: "b" },
      },
    ],
  };

  const toolMsg: AIChatMessage = {
    role: "tool",
    id: "t1",
    ts: 2,
    content: [
      {
        type: "tool-result",
        toolCallId: "call_a",
        toolName: "searchMetrics",
        result: JSON.stringify({ x: 1 }),
      },
      {
        type: "tool-result",
        toolCallId: "call_b",
        toolName: "searchMetrics",
        result: JSON.stringify({ x: 2 }),
      },
    ],
  };

  const messages: AIChatMessage[] = [assistantMsg, toolMsg];

  it("finds the correct tool-call part by toolCallId", () => {
    const part = toolMsg.role === "tool" ? toolMsg.content[0] : undefined;
    const found = findToolCallPart(messages, { toolCallId: "call_a" });
    expect(found).toBeDefined();
    expect(found?.toolCallId).toBe("call_a");
    expect(found?.args).toEqual({ query: "a" });
    expect(part?.toolCallId).toBe("call_a");
  });

  it("returns undefined for an unknown toolCallId", () => {
    expect(findToolCallPart(messages, { toolCallId: "call_z" })).toBeUndefined();
  });

  it("works across multiple turns", () => {
    const assistantMsg2: AIChatMessage = {
      role: "assistant",
      id: "a2",
      ts: 3,
      content: [
        {
          type: "tool-call",
          toolCallId: "call_c",
          toolName: "runExploration",
          args: { datasource: "ds1" },
        },
      ],
    };
    const allMessages: AIChatMessage[] = [assistantMsg, toolMsg, assistantMsg2];
    const found = findToolCallPart(allMessages, { toolCallId: "call_c" });
    expect(found?.toolCallId).toBe("call_c");
    expect(found?.toolName).toBe("runExploration");
  });
});
