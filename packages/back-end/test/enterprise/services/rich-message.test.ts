import type { ModelMessage } from "ai";
import type { RichMessage } from "shared";
import {
  compactModelMessagesForLLM,
  modelMessagesToRich,
  richToModelMessages,
  stripForLLM,
} from "back-end/src/enterprise/services/rich-message";
import {
  setPendingToolArtifact,
  takePendingToolArtifact,
} from "back-end/src/enterprise/services/pending-tool-artifacts";

describe("richToModelMessages", () => {
  it("converts user and assistant text", () => {
    const rich: RichMessage[] = [
      {
        kind: "user-text",
        id: "u1",
        content: "Hello",
        ts: 1,
      },
      {
        kind: "assistant-text",
        id: "a1",
        content: "Hi there",
        ts: 2,
      },
    ];
    const model = richToModelMessages(rich);
    expect(model).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
    ]);
  });

  it("groups assistant text, tool-call, then tool results", () => {
    const rich: RichMessage[] = [
      { kind: "user-text", id: "u1", content: "Run it", ts: 1 },
      { kind: "assistant-text", id: "a1", content: "OK", ts: 2 },
      {
        kind: "tool-call",
        id: "tc1",
        toolName: "runExploration",
        toolCallId: "call_1",
        args: { x: 1 },
        ts: 3,
      },
      {
        kind: "tool-result",
        id: "tr1",
        toolName: "runExploration",
        toolCallId: "call_1",
        summary: "done",
        data: { snapshotId: "snap_abc_1" },
        ts: 4,
      },
    ];
    const model = richToModelMessages(rich);
    expect(model[0]).toEqual({ role: "user", content: "Run it" });
    expect(model[1]).toMatchObject({ role: "assistant" });
    const asst = model[1] as Extract<ModelMessage, { role: "assistant" }>;
    expect(asst.content).toEqual([
      { type: "text", text: "OK" },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "runExploration",
        input: { x: 1 },
      },
    ]);
    expect(model[2]).toMatchObject({ role: "tool" });
    const tool = model[2] as Extract<ModelMessage, { role: "tool" }>;
    expect(tool.content[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "runExploration",
    });
  });
});

describe("compactModelMessagesForLLM", () => {
  it("leaves the last assistant turn tool results intact", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "u1" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "t1" },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "runExploration",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "runExploration",
            output: {
              type: "text",
              value: JSON.stringify({
                summary: "s1",
                data: { snapshotId: "snap_x_1" },
              }),
            },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "followup" }],
      },
    ];
    const compacted = compactModelMessagesForLLM(messages);
    const tool0 = compacted[2] as Extract<ModelMessage, { role: "tool" }>;
    const part0 = tool0.content[0];
    expect(part0.type).toBe("tool-result");
    if (part0.type === "tool-result") {
      expect(part0.output).toEqual({
        type: "text",
        value:
          "[Result compacted (snapshotId: snap_x_1) — use getSnapshot to retrieve full data]",
      });
    }
    expect(compacted[3]).toEqual(messages[3]);
  });
});

describe("stripForLLM", () => {
  it("applies compaction to older tool results in a rich conversation", () => {
    const rich: RichMessage[] = [
      { kind: "user-text", id: "u1", content: "first", ts: 1 },
      { kind: "assistant-text", id: "a1", content: "running", ts: 2 },
      {
        kind: "tool-call",
        id: "tc1",
        toolName: "runExploration",
        toolCallId: "c1",
        ts: 3,
      },
      {
        kind: "tool-result",
        id: "tr1",
        toolName: "runExploration",
        toolCallId: "c1",
        summary: "s1",
        data: { snapshotId: "snap_old" },
        ts: 4,
      },
      { kind: "user-text", id: "u2", content: "second", ts: 5 },
      { kind: "assistant-text", id: "a2", content: "again", ts: 6 },
    ];
    const model = stripForLLM(rich);
    const toolMsg = model.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const tool = toolMsg as Extract<ModelMessage, { role: "tool" }>;
    const out = tool.content[0];
    expect(out.type).toBe("tool-result");
    if (
      out.type === "tool-result" &&
      out.output &&
      typeof out.output === "object"
    ) {
      expect((out.output as { value: string }).value).toContain("compacted");
      expect((out.output as { value: string }).value).toContain("snap_old");
    }
  });
});

describe("modelMessagesToRich", () => {
  const conversationId = "conv-test-uuid";

  it("round-trips user + assistant + tool without pending artifact", () => {
    const userRich: RichMessage = {
      kind: "user-text",
      id: "u0",
      content: "hey",
      ts: 0,
    };
    const response: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "reply" },
          {
            type: "tool-call",
            toolCallId: "tid",
            toolName: "searchMetrics",
            input: { query: "a" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tid",
            toolName: "searchMetrics",
            output: { type: "text", value: '{"matches":[]}' },
          },
        ],
      },
    ];
    const rich = modelMessagesToRich(conversationId, userRich, response);
    expect(rich[0]).toEqual(userRich);
    expect(rich[1]).toMatchObject({
      kind: "assistant-text",
      content: "reply",
    });
    expect(rich[2]).toMatchObject({
      kind: "tool-call",
      toolName: "searchMetrics",
      toolCallId: "tid",
      args: { query: "a" },
    });
    expect(rich[3]).toMatchObject({
      kind: "tool-result",
      toolName: "searchMetrics",
      toolCallId: "tid",
    });
  });

  it("merges pending artifact into tool-result data", () => {
    setPendingToolArtifact(conversationId, "tid2", {
      summary: "Chart ok",
      snapshotId: "snap_z",
      config: { chartType: "line" },
    });
    const userRich: RichMessage = {
      kind: "user-text",
      id: "u0",
      content: "go",
      ts: 0,
    };
    const response: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tid2",
            toolName: "runExploration",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tid2",
            toolName: "runExploration",
            output: { type: "text", value: "{}" },
          },
        ],
      },
    ];
    const rich = modelMessagesToRich(conversationId, userRich, response);
    const tr = rich.find((m) => m.kind === "tool-result");
    expect(tr && tr.kind === "tool-result").toBe(true);
    if (tr && tr.kind === "tool-result") {
      expect(tr.summary).toBe("Chart ok");
      expect(tr.data.snapshotId).toBe("snap_z");
      expect(tr.data.config).toEqual({ chartType: "line" });
    }
    expect(takePendingToolArtifact(conversationId, "tid2")).toBeUndefined();
  });
});
