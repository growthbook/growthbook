import { parseInitialChatMessage } from "@/enterprise/components/ProductAnalytics/util";

describe("parseInitialChatMessage", () => {
  it("reads the stashed text and mentions", () => {
    const stored = JSON.stringify({
      text: "how is @Revenue doing?",
      mentions: [{ type: "metric", id: "met_abc", name: "Revenue" }],
    });
    expect(parseInitialChatMessage(stored)).toEqual({
      text: "how is @Revenue doing?",
      mentions: [{ type: "metric", id: "met_abc", name: "Revenue" }],
    });
  });

  it("defaults mentions to empty when the payload omits them", () => {
    expect(parseInitialChatMessage(JSON.stringify({ text: "hi" }))).toEqual({
      text: "hi",
      mentions: [],
    });
  });

  it("accepts a bare string, so a message stashed by an older build still opens", () => {
    expect(parseInitialChatMessage("plain text")).toEqual({
      text: "plain text",
      mentions: [],
    });
  });

  it("trims the text in both shapes", () => {
    expect(parseInitialChatMessage("  padded  ")?.text).toBe("padded");
    expect(
      parseInitialChatMessage(JSON.stringify({ text: "  padded  " }))?.text,
    ).toBe("padded");
  });

  it("rejects a payload whose text is not a string", () => {
    expect(parseInitialChatMessage(JSON.stringify({ text: 42 }))).toBeNull();
  });

  it("ignores a non-array mentions value rather than passing it on", () => {
    expect(
      parseInitialChatMessage(JSON.stringify({ text: "hi", mentions: "nope" })),
    ).toEqual({ text: "hi", mentions: [] });
  });
});
