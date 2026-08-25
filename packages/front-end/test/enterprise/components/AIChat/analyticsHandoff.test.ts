import { analyticsHandoffFromToolResult } from "@/components/Agent/AnalyticsHandoffCard";

describe("analyticsHandoffFromToolResult", () => {
  it("reads a handoff, mentions included, from an object result", () => {
    const handoff = analyticsHandoffFromToolResult({
      status: "offered",
      handoff: {
        prompt: "Build a dashboard tracking @Revenue",
        mentions: [{ type: "factMetric", id: "fact__abc", name: "Revenue" }],
      },
    });
    expect(handoff?.prompt).toBe("Build a dashboard tracking @Revenue");
    // Mentions ride along so the other chat resolves ids, not names.
    expect(handoff?.mentions).toEqual([
      { type: "factMetric", id: "fact__abc", name: "Revenue" },
    ]);
  });

  it("reads a handoff from a JSON string result", () => {
    // Tool results come back as strings once persisted to the transcript.
    const handoff = analyticsHandoffFromToolResult(
      JSON.stringify({ handoff: { prompt: "Build a revenue dashboard" } }),
    );
    expect(handoff?.prompt).toBe("Build a revenue dashboard");
  });

  it("returns null for anything that is not a usable handoff", () => {
    // Every other tool's result, junk, and the briefs the validator rejects —
    // an empty one would open the other chat with nothing to work from.
    for (const input of [
      { status: "ok" },
      null,
      "not json",
      { handoff: {} },
      { handoff: { prompt: "  " } },
      { handoff: { prompt: 42 } },
    ]) {
      expect(analyticsHandoffFromToolResult(input)).toBeNull();
    }
  });
});
