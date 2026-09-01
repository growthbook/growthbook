import type { AIChatMessage } from "shared/ai-chat";
import { toModelMessages } from "back-end/src/enterprise/services/ai-chat-to-model";

function userMessage(overrides: Partial<AIChatMessage> = {}): AIChatMessage {
  return {
    role: "user",
    id: "m1",
    ts: 0,
    content: "how is it doing?",
    ...overrides,
  } as AIChatMessage;
}

/** The text the model actually receives for the first message. */
function firstUserText(messages: AIChatMessage[]): string {
  const mapped = toModelMessages(messages)[0];
  const content = mapped.content;
  if (typeof content === "string") return content;
  const first = content[0];
  return first && "text" in first ? (first.text as string) : "";
}

describe("toModelMessages context prefix", () => {
  it("passes content through untouched when there is no context", () => {
    expect(firstUserText([userMessage()])).toBe("how is it doing?");
  });

  it("renders mentions as an authoritative name → id line", () => {
    const text = firstUserText([
      userMessage({
        content: "how is @Revenue doing?",
        mentions: [{ type: "metric", id: "met_abc", name: "Revenue" }],
      }),
    ]);
    expect(text).toBe(
      "[Referenced by the user: Revenue (metric: met_abc)]\n\nhow is @Revenue doing?",
    );
  });

  it("comma-separates multiple mentions and keeps their order", () => {
    const text = firstUserText([
      userMessage({
        content: "compare @Revenue and @Signups",
        mentions: [
          { type: "metric", id: "met_abc", name: "Revenue" },
          { type: "factMetric", id: "fact__xyz", name: "Signups" },
        ],
      }),
    ]);
    expect(text).toContain(
      "[Referenced by the user: Revenue (metric: met_abc), Signups (factMetric: fact__xyz)]",
    );
  });

  it("keeps mentions on their own line below the other context lines", () => {
    const text = firstUserText([
      userMessage({
        currentPage: "/metric/met_abc",
        datasourceHint: "ds_1",
        mentions: [{ type: "metric", id: "met_abc", name: "Revenue" }],
      }),
    ]);
    expect(text.split("\n").slice(0, 3)).toEqual([
      "[Page context: /metric/met_abc]",
      "[Active product-analytics datasource: ds_1]",
      "[Referenced by the user: Revenue (metric: met_abc)]",
    ]);
  });

  it("marks a stale mention inline and tells the model what to do about it", () => {
    const text = firstUserText([
      userMessage({
        content: "how is @Revenue doing?",
        mentions: [
          { type: "metric", id: "met_abc", name: "Revenue", stale: true },
        ],
      }),
    ]);
    // Still listed, not dropped — the user did reference it, and the answer
    // should name it rather than quietly ignore it.
    expect(text).toContain(
      "[Referenced by the user: Revenue (metric: met_abc, STALE — not in this datasource)]",
    );
    expect(text).toContain("[Note: a reference marked STALE");
  });

  it("adds no note when every mention resolves", () => {
    const text = firstUserText([
      userMessage({
        mentions: [
          { type: "metric", id: "met_abc", name: "Revenue" },
          { type: "factMetric", id: "fact__xyz", name: "Signups", stale: true },
        ],
      }),
    ]);
    expect(text).toContain("Revenue (metric: met_abc),");
    expect(text).toContain("Signups (factMetric: fact__xyz, STALE");
    expect(text).toContain("[Note: a reference marked STALE");

    const clean = firstUserText([
      userMessage({
        mentions: [{ type: "metric", id: "met_abc", name: "Revenue" }],
      }),
    ]);
    expect(clean).not.toContain("STALE");
  });

  it("emits no mention line for an empty array", () => {
    const text = firstUserText([userMessage({ mentions: [] })]);
    expect(text).toBe("how is it doing?");
  });
});

describe("toModelMessages saved-dashboard binding", () => {
  const transcript: AIChatMessage[] = [
    userMessage({ content: "build me a dashboard" }),
    {
      role: "assistant",
      id: "m2",
      ts: 0,
      content: [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "proposeDashboard",
          args: {},
        },
      ],
    },
    {
      role: "tool",
      id: "m3",
      ts: 0,
      content: [
        {
          toolCallId: "call_1",
          toolName: "proposeDashboard",
          result: '{"status":"shown"}',
        },
      ],
    },
    { role: "assistant", id: "m4", ts: 0, content: "Here it is." },
    userMessage({ id: "m5", content: "make it 90 days" }),
  ] as AIChatMessage[];

  /** The text the model receives for the proposeDashboard tool result. */
  function toolText(saved: { toolCallId: string; dashboardId: string }[]) {
    const mapped = toModelMessages(transcript, saved)[2];
    const part = (mapped.content as { output: { value: string } }[])[0];
    return part.output.value;
  }

  it("tells the agent the id the user saved under, even once compacted", () => {
    const text = toolText([{ toolCallId: "call_1", dashboardId: "dash_abc" }]);
    // Compacted — it sits before the last assistant turn.
    expect(text).toContain("[Result compacted");
    expect(text).toContain("saved this preview as dashboard dash_abc");
    expect(text).toContain('pass dashboardId "dash_abc"');
  });

  it("leaves an unsaved preview alone, so revising it stays a create", () => {
    expect(toolText([])).not.toContain("saved this preview");
    expect(
      toolText([{ toolCallId: "other_call", dashboardId: "dash_abc" }]),
    ).not.toContain("saved this preview");
  });
});
