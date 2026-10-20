import { parseInitialChatMessage } from "@/enterprise/components/ProductAnalytics/util";

describe("parseInitialChatMessage", () => {
  it("reads the stashed text, mentions, and skills", () => {
    const stored = JSON.stringify({
      text: "/dashboards track @Revenue",
      mentions: [{ type: "metric", id: "met_abc", name: "Revenue" }],
      skills: ["dashboards"],
    });
    expect(parseInitialChatMessage(stored)).toEqual({
      text: "/dashboards track @Revenue",
      mentions: [{ type: "metric", id: "met_abc", name: "Revenue" }],
      skills: ["dashboards"],
    });
  });

  it("defaults mentions and skills to empty when the payload omits them", () => {
    expect(parseInitialChatMessage(JSON.stringify({ text: "hi" }))).toEqual({
      text: "hi",
      mentions: [],
      skills: [],
    });
  });

  it("accepts a payload from before skills existed", () => {
    const stored = JSON.stringify({
      text: "hi",
      mentions: [{ type: "metric", id: "met_abc", name: "Revenue" }],
    });
    expect(parseInitialChatMessage(stored)).toEqual({
      text: "hi",
      mentions: [{ type: "metric", id: "met_abc", name: "Revenue" }],
      skills: [],
    });
  });

  it("accepts a bare string, so a message stashed by an older build still opens", () => {
    expect(parseInitialChatMessage("plain text")).toEqual({
      text: "plain text",
      mentions: [],
      skills: [],
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

  it("ignores a non-array mentions or skills value rather than passing it on", () => {
    expect(
      parseInitialChatMessage(JSON.stringify({ text: "hi", mentions: "nope" })),
    ).toEqual({ text: "hi", mentions: [], skills: [] });
    expect(
      parseInitialChatMessage(JSON.stringify({ text: "hi", skills: "nope" })),
    ).toEqual({ text: "hi", mentions: [], skills: [] });
  });
});
