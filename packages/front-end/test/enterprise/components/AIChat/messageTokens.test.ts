import type { AIChatMention } from "shared/ai-chat";
import { splitMessageTokens } from "@/enterprise/components/AIChat/MessageTokens";

const revenue: AIChatMention = {
  type: "metric",
  id: "met_1",
  name: "Any Purchases",
};

describe("splitMessageTokens", () => {
  it("returns the whole message as one plain run when there are no tokens", () => {
    expect(splitMessageTokens("hello there", undefined, undefined)).toEqual([
      { text: "hello there", kind: null },
    ]);
  });

  it("picks out a mention whose name contains spaces", () => {
    expect(
      splitMessageTokens(
        "trend of @Any Purchases lately",
        [revenue],
        undefined,
      ),
    ).toEqual([
      { text: "trend of ", kind: null },
      { text: "@Any Purchases", kind: "mention" },
      { text: " lately", kind: null },
    ]);
  });

  it("picks out a leading slash command", () => {
    expect(
      splitMessageTokens("/feature-flags what do I have?", [], "feature-flags"),
    ).toEqual([
      { text: "/feature-flags", kind: "command" },
      { text: " what do I have?", kind: null },
    ]);
  });

  it("handles a command and a mention in one message", () => {
    expect(
      splitMessageTokens(
        "/feature-flags tied to @Any Purchases",
        [revenue],
        "feature-flags",
      ),
    ).toEqual([
      { text: "/feature-flags", kind: "command" },
      { text: " tied to ", kind: null },
      { text: "@Any Purchases", kind: "mention" },
    ]);
  });

  it("prefers the longer name when one is a prefix of another", () => {
    const parts = splitMessageTokens(
      "@Total Revenue rose",
      [
        { type: "metric", id: "a", name: "Total Revenue" },
        { type: "metric", id: "b", name: "Total" },
      ],
      undefined,
    );
    expect(parts[0]).toEqual({ text: "@Total Revenue", kind: "mention" });
  });

  it("marks every occurrence of a repeated mention", () => {
    const parts = splitMessageTokens(
      "@Any Purchases vs @Any Purchases",
      [revenue],
      undefined,
    );
    expect(parts.filter((p) => p.kind === "mention")).toHaveLength(2);
  });

  it("leaves an unrelated @ or / in prose alone", () => {
    expect(
      splitMessageTokens(
        "email me@example.com or see a/b tests",
        [],
        undefined,
      ),
    ).toEqual([{ text: "email me@example.com or see a/b tests", kind: null }]);
  });

  it("does not mark a name that was never mentioned", () => {
    expect(
      splitMessageTokens("what about @Signups?", [revenue], undefined),
    ).toEqual([{ text: "what about @Signups?", kind: null }]);
  });
});
