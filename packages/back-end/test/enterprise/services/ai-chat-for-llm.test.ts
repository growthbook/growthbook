import type { ModelMessage } from "ai";
import type { AIChatMessage } from "shared/ai-chat";
import { stripForLLM } from "back-end/src/enterprise/services/ai-chat-for-llm";

describe("stripForLLM", () => {
  it("converts a user message directly", () => {
    const rich: AIChatMessage[] = [
      { role: "user", id: "u1", content: "Hello", ts: 1 },
    ];
    const model = stripForLLM(rich);
    expect(model).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("converts an assistant text message", () => {
    const rich: AIChatMessage[] = [
      { role: "user", id: "u1", content: "Hello", ts: 1 },
      {
        role: "assistant",
        id: "a1",
        ts: 2,
        content: [{ type: "text", text: "Hi there" }],
      },
    ];
    const model = stripForLLM(rich);
    expect(model[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Hi there" }],
    });
  });

  it("converts tool-call parts, mapping args → input", () => {
    const rich: AIChatMessage[] = [
      { role: "user", id: "u1", content: "Run it", ts: 1 },
      {
        role: "assistant",
        id: "a1",
        ts: 2,
        content: [
          { type: "text", text: "OK" },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "runExploration",
            args: { x: 1 },
          },
        ],
      },
      {
        role: "tool",
        id: "t1",
        ts: 3,
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "runExploration",
            result: JSON.stringify({
              summary: "done",
              snapshotId: "snap_abc_1",
            }),
          },
        ],
      },
    ];
    const model = stripForLLM(rich);
    expect(model[0]).toEqual({ role: "user", content: "Run it" });

    const asst = model[1] as Extract<ModelMessage, { role: "assistant" }>;
    expect(asst.role).toBe("assistant");
    expect(asst.content).toEqual([
      { type: "text", text: "OK" },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "runExploration",
        input: { x: 1 },
      },
    ]);

    const tool = model[2] as Extract<ModelMessage, { role: "tool" }>;
    expect(tool.role).toBe("tool");
    expect(tool.content[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "runExploration",
    });
    const out = tool.content[0];
    if (
      out.type === "tool-result" &&
      out.output &&
      typeof out.output === "object" &&
      "value" in out.output
    ) {
      const parsed = JSON.parse(out.output.value as string) as {
        summary: string;
        snapshotId: string;
      };
      expect(parsed.summary).toBe("done");
      expect(parsed.snapshotId).toBe("snap_abc_1");
    }
  });

  it("compacts older tool results and preserves snapshotId hint", () => {
    const rich: AIChatMessage[] = [
      { role: "user", id: "u1", content: "first", ts: 1 },
      {
        role: "assistant",
        id: "a1",
        ts: 2,
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "runExploration", args: {} },
        ],
      },
      {
        role: "tool",
        id: "t1",
        ts: 3,
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "runExploration",
            result: JSON.stringify({
              summary: "s1",
              snapshotId: "snap_old",
            }),
          },
        ],
      },
      { role: "user", id: "u2", content: "second", ts: 4 },
      {
        role: "assistant",
        id: "a2",
        ts: 5,
        content: [{ type: "text", text: "again" }],
      },
    ];
    const model = stripForLLM(rich);
    const toolMsg = model.find((m) => m.role === "tool") as Extract<
      ModelMessage,
      { role: "tool" }
    >;
    expect(toolMsg).toBeDefined();
    const part = toolMsg.content[0];
    expect(part.type).toBe("tool-result");
    if (
      part.type === "tool-result" &&
      part.output &&
      typeof part.output === "object" &&
      "value" in part.output
    ) {
      const val = part.output.value as string;
      expect(val).toContain("compacted");
      expect(val).toContain("snap_old");
    }
  });

  it("leaves the last assistant turn's tool results intact", () => {
    const rich: AIChatMessage[] = [
      { role: "user", id: "u1", content: "q", ts: 1 },
      {
        role: "assistant",
        id: "a1",
        ts: 2,
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "runExploration", args: {} },
        ],
      },
      {
        role: "tool",
        id: "t1",
        ts: 3,
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "runExploration",
            result: JSON.stringify({
              summary: "s1",
              snapshotId: "snap_x",
            }),
          },
        ],
      },
      {
        role: "assistant",
        id: "a2",
        ts: 4,
        content: [{ type: "text", text: "done" }],
      },
    ];
    const model = stripForLLM(rich);
    const toolMsg = model.find((m) => m.role === "tool") as Extract<
      ModelMessage,
      { role: "tool" }
    >;
    const part = toolMsg.content[0];
    if (
      part.type === "tool-result" &&
      part.output &&
      typeof part.output === "object" &&
      "value" in part.output
    ) {
      expect(part.output.value as string).toContain("compacted");
      expect(part.output.value as string).toContain("snap_x");
    }
    expect(model[model.length - 1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    });
  });
});
