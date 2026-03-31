import {
  stringifyToolResultForStorage,
  toolResultPreviewLabel,
  toolResultSnapshotId,
  tryParseToolResultJson,
  type AIChatToolResultPart,
} from "../src/ai-chat";

describe("stringifyToolResultForStorage", () => {
  it("JSON-stringifies plain objects and primitives", () => {
    expect(stringifyToolResultForStorage({ a: 1 })).toBe('{"a":1}');
    expect(stringifyToolResultForStorage("plain")).toBe('"plain"');
  });

  it("unwraps AI SDK text part then stringifies", () => {
    expect(
      stringifyToolResultForStorage({
        type: "text",
        value: '{"x":1,"snapshotId":"snap_1"}',
      }),
    ).toBe('{"x":1,"snapshotId":"snap_1"}');
  });

  it("returns JSON null for undefined", () => {
    expect(stringifyToolResultForStorage(undefined)).toBe("null");
  });
});

describe("tryParseToolResultJson", () => {
  it("parses valid JSON", () => {
    expect(tryParseToolResultJson('{"k":1}')).toEqual({ k: 1 });
  });

  it("returns undefined on invalid JSON", () => {
    expect(tryParseToolResultJson("not json")).toBeUndefined();
  });
});

describe("toolResultSnapshotId", () => {
  it("reads snapshotId from JSON string", () => {
    expect(
      toolResultSnapshotId(JSON.stringify({ snapshotId: "s1" })),
    ).toBe("s1");
  });

  it("returns undefined for invalid or missing", () => {
    expect(toolResultSnapshotId("{}")).toBeUndefined();
    expect(toolResultSnapshotId("x")).toBeUndefined();
  });
});

describe("toolResultPreviewLabel", () => {
  it("uses summary or message when present in JSON", () => {
    expect(
      toolResultPreviewLabel(JSON.stringify({ summary: "Done" }), "f"),
    ).toBe("Done");
    expect(
      toolResultPreviewLabel(JSON.stringify({ message: "Oops" }), "f"),
    ).toBe("Oops");
  });

  it("uses raw string when not valid JSON", () => {
    expect(toolResultPreviewLabel("hello", "f")).toBe("hello");
  });

  it("stringifies small JSON objects for preview", () => {
    expect(toolResultPreviewLabel(JSON.stringify({ a: 1 }), "fb")).toBe(
      JSON.stringify({ a: 1 }),
    );
  });
});

describe("AIChatToolResultPart typing", () => {
  it("uses string result", () => {
    const part: AIChatToolResultPart = {
      type: "tool-result",
      toolCallId: "c1",
      toolName: "t",
      result: '{"any":"shape"}',
    };
    expect(part.result).toBe('{"any":"shape"}');
  });
});
