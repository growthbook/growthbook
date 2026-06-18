import { parseKapaContentBlocks } from "back-end/src/agent/kapa";

describe("parseKapaContentBlocks", () => {
  it("parses JSON text blocks with source_url + content", () => {
    const sources = parseKapaContentBlocks([
      {
        type: "text",
        text: JSON.stringify({
          source_url: "https://docs.growthbook.io/features/basics",
          content: "Feature flags let you toggle behaviour.",
        }),
      },
    ]);
    expect(sources).toEqual([
      {
        url: "https://docs.growthbook.io/features/basics",
        content: "Feature flags let you toggle behaviour.",
      },
    ]);
  });

  it("treats non-JSON text blocks as plain text with no url", () => {
    const sources = parseKapaContentBlocks([
      { type: "text", text: "Just some plain documentation text." },
    ]);
    expect(sources).toEqual([
      { url: "", content: "Just some plain documentation text." },
    ]);
  });

  it("falls back to the raw text when JSON lacks source_url", () => {
    const raw = JSON.stringify({ foo: "bar" });
    const sources = parseKapaContentBlocks([{ type: "text", text: raw }]);
    expect(sources).toEqual([{ url: "", content: raw }]);
  });

  it("defaults missing url/content fields to empty/raw", () => {
    const text = JSON.stringify({ source_url: "https://docs.growthbook.io/" });
    const sources = parseKapaContentBlocks([{ type: "text", text }]);
    expect(sources).toEqual([
      { url: "https://docs.growthbook.io/", content: text },
    ]);
  });

  it("skips non-text and malformed blocks", () => {
    const sources = parseKapaContentBlocks([
      { type: "image", data: "..." },
      null,
      "raw string",
      { type: "text" }, // no `text` field
      { type: "text", text: "kept" },
    ]);
    expect(sources).toEqual([{ url: "", content: "kept" }]);
  });

  it("returns an empty array for no blocks", () => {
    expect(parseKapaContentBlocks([])).toEqual([]);
  });
});
