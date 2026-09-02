import { LocalConversationBuffer } from "back-end/src/enterprise/services/conversation-buffer";
import { StreamProcessor } from "back-end/src/enterprise/services/stream-processor";

describe("StreamProcessor Product Analytics results", () => {
  it("emits one ordinary full tool-call-end event without chart-result duplication", () => {
    const buffer = new LocalConversationBuffer("conversation-1", {
      messages: [],
      isStreaming: true,
      lastStreamedAt: 0,
      title: "Test",
      agentType: "general",
    });
    const events: Array<{ event: string; data: unknown }> = [];
    const processor = new StreamProcessor(
      buffer,
      (event, data) => events.push({ event, data }),
      new AbortController(),
    );
    const output = {
      status: 200,
      body: {
        exploration: {
          id: "ae_1",
          status: "success",
          config: { type: "metric" },
          result: {
            rows: [{ dimensions: [], payload: "x".repeat(2_100_000) }],
          },
        },
      },
    };

    processor.handleToolCall({
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "callApi",
      input: {
        method: "POST",
        path: "/api/v1/product-analytics/metric-exploration",
      },
    } as never);
    processor.handleToolResult({
      type: "tool-result",
      toolCallId: "call-1",
      toolName: "callApi",
      output,
    } as never);

    expect(events.filter(({ event }) => event === "chart-result")).toHaveLength(
      0,
    );
    const completed = events.filter(({ event }) => event === "tool-call-end");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.data).toMatchObject({ output });
  });
});
