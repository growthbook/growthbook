import { analyticsHandoffFromToolResult } from "@/components/Agent/AnalyticsHandoffCard";

describe("analyticsHandoffFromToolResult", () => {
  it("reads a handoff, mentions included, from an object result", () => {
    const handoff = analyticsHandoffFromToolResult({
      status: "offered",
      handoff: {
        mode: "create",
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
      JSON.stringify({
        handoff: { mode: "create", prompt: "Build a revenue dashboard" },
      }),
    );
    expect(handoff?.prompt).toBe("Build a revenue dashboard");
  });

  it("carries the mode, so the card can open the matching skill", () => {
    // An edit opened as a create builds a second dashboard instead of changing
    // the one the user pointed at, so this is the field the card branches on.
    const handoff = analyticsHandoffFromToolResult({
      handoff: {
        mode: "edit",
        prompt: "Add a signups chart to @Growth KPIs",
        mentions: [{ type: "dashboard", id: "dash_abc", name: "Growth KPIs" }],
      },
    });
    expect(handoff?.mode).toBe("edit");
  });

  it("returns null for anything that is not a usable handoff", () => {
    // Every other tool's result, junk, and the briefs the validator rejects —
    // an empty one would open the other chat with nothing to work from, and one
    // with no mode leaves the card guessing which skill to open.
    for (const input of [
      { status: "ok" },
      null,
      "not json",
      { handoff: {} },
      { handoff: { mode: "create", prompt: "  " } },
      { handoff: { mode: "create", prompt: 42 } },
      { handoff: { prompt: "Build a revenue dashboard" } },
      { handoff: { mode: "revise", prompt: "Build a revenue dashboard" } },
    ]) {
      expect(analyticsHandoffFromToolResult(input)).toBeNull();
    }
  });
});
