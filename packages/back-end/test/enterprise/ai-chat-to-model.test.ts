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

  it("emits no mention line for an empty array", () => {
    const text = firstUserText([userMessage({ mentions: [] })]);
    expect(text).toBe("how is it doing?");
  });
});
