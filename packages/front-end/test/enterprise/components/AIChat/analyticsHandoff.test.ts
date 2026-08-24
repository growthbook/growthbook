import { analyticsHandoffFromToolResult } from "@/components/Agent/AnalyticsHandoffCard";

describe("analyticsHandoffFromToolResult", () => {
  it("reads a handoff from an object result", () => {
    const handoff = analyticsHandoffFromToolResult({
      status: "offered",
      handoff: { prompt: "Build a dashboard tracking Revenue for last 7 days" },
    });
    expect(handoff?.prompt).toBe(
      "Build a dashboard tracking Revenue for last 7 days",
    );
    expect(handoff?.mentions).toBeUndefined();
  });

  it("reads a handoff from a JSON string result", () => {
    // Tool results come back as strings once persisted to the transcript.
    const handoff = analyticsHandoffFromToolResult(
      JSON.stringify({ handoff: { prompt: "Build a revenue dashboard" } }),
    );
    expect(handoff?.prompt).toBe("Build a revenue dashboard");
  });

  it("carries mentions through so the other chat resolves ids, not names", () => {
    const handoff = analyticsHandoffFromToolResult({
      handoff: {
        prompt: "Build a dashboard tracking @Revenue",
        mentions: [{ type: "factMetric", id: "fact__abc", name: "Revenue" }],
      },
    });
    expect(handoff?.mentions).toEqual([
      { type: "factMetric", id: "fact__abc", name: "Revenue" },
    ]);
  });

  it("trims the prompt", () => {
    expect(
      analyticsHandoffFromToolResult({ handoff: { prompt: "  build it  " } })
        ?.prompt,
    ).toBe("build it");
  });

  it("returns null for a result carrying no handoff", () => {
    expect(analyticsHandoffFromToolResult({ status: "ok" })).toBeNull();
    expect(analyticsHandoffFromToolResult(null)).toBeNull();
    expect(analyticsHandoffFromToolResult("not json")).toBeNull();
  });

  it("returns null when the prompt is missing, empty, or not a string", () => {
    // An empty brief would open the other chat with nothing to work from.
    expect(analyticsHandoffFromToolResult({ handoff: {} })).toBeNull();
    expect(
      analyticsHandoffFromToolResult({ handoff: { prompt: "  " } }),
    ).toBeNull();
    expect(
      analyticsHandoffFromToolResult({ handoff: { prompt: 42 } }),
    ).toBeNull();
  });

  it("drops a mentions value that is not an array", () => {
    const handoff = analyticsHandoffFromToolResult({
      handoff: { prompt: "build it", mentions: "Revenue" },
    });
    expect(handoff?.prompt).toBe("build it");
    expect(handoff?.mentions).toBeUndefined();
  });
});
