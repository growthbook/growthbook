import {
  MAX_SSE_TOOL_JSON_LENGTH,
  serializeUnknownForSSE,
} from "back-end/src/enterprise/services/sse-tool-payload";

describe("serializeUnknownForSSE", () => {
  it("round-trips plain objects", () => {
    expect(serializeUnknownForSSE({ a: 1, b: "x" })).toEqual({ a: 1, b: "x" });
  });

  it("returns undefined for undefined", () => {
    expect(serializeUnknownForSSE(undefined)).toBeUndefined();
  });

  it("truncates oversized JSON", () => {
    const huge = { x: "y".repeat(MAX_SSE_TOOL_JSON_LENGTH) };
    const out = serializeUnknownForSSE(huge) as {
      _truncated: boolean;
      preview: string;
      totalLength: number;
    };
    expect(out._truncated).toBe(true);
    expect(out.preview.length).toBe(MAX_SSE_TOOL_JSON_LENGTH);
    expect(out.totalLength).toBeGreaterThan(MAX_SSE_TOOL_JSON_LENGTH);
  });
});
