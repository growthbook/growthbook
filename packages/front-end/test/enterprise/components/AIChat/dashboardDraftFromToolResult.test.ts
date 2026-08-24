import { dashboardDraftFromToolResult } from "@/enterprise/components/ProductAnalytics/AIChat/DashboardPreviewBubble";

const block = {
  type: "metric-exploration",
  title: "Revenue",
  description: "",
  explorerAnalysisId: "expl_1",
  config: { type: "metric" },
  layout: { x: 0, y: 0, w: 24, h: 8 },
};

describe("dashboardDraftFromToolResult", () => {
  it("reads a draft from an object result", () => {
    const parsed = dashboardDraftFromToolResult({
      status: "shown",
      draft: { title: "Growth KPIs", blocks: [block] },
    });
    expect(parsed?.draft.title).toBe("Growth KPIs");
    expect(parsed?.draft.blocks).toHaveLength(1);
    expect(parsed?.droppedBlocks).toEqual([]);
  });

  it("reads a draft from a JSON string result", () => {
    // Tool results come back as strings once persisted to the transcript.
    const parsed = dashboardDraftFromToolResult(
      JSON.stringify({ draft: { title: "Growth KPIs", blocks: [block] } }),
    );
    expect(parsed?.draft.title).toBe("Growth KPIs");
  });

  it("carries globalControls, comparison, and dashboardId when present", () => {
    const parsed = dashboardDraftFromToolResult({
      draft: {
        title: "Growth KPIs",
        blocks: [block],
        dashboardId: "dash_abc",
        globalControls: { dateRange: { predefined: "last90Days" } },
        comparison: { enabled: true, mode: "previousPeriod" },
      },
    });
    expect(parsed?.draft.dashboardId).toBe("dash_abc");
    expect(parsed?.draft.globalControls).toEqual({
      dateRange: { predefined: "last90Days" },
    });
    expect(parsed?.draft.comparison).toEqual({
      enabled: true,
      mode: "previousPeriod",
    });
  });

  it("carries projects through, empty array included", () => {
    // `[]` means every project, so it must survive as a value rather than
    // reading as "the agent didn't say".
    expect(
      dashboardDraftFromToolResult({
        draft: { title: "Growth KPIs", blocks: [block], projects: ["prj_abc"] },
      })?.draft.projects,
    ).toEqual(["prj_abc"]);

    expect(
      dashboardDraftFromToolResult({
        draft: { title: "Growth KPIs", blocks: [block], projects: [] },
      })?.draft.projects,
    ).toEqual([]);
  });

  it("drops a projects value that is not an array of strings", () => {
    // The preview then falls back to the app's current project selection,
    // which is safer than sending garbage ids to the create endpoint.
    const parsed = dashboardDraftFromToolResult({
      draft: { title: "Growth KPIs", blocks: [block], projects: [1, "prj_a"] },
    });
    expect("projects" in (parsed?.draft ?? {})).toBe(false);
  });

  it("omits globalControls and dashboardId when absent", () => {
    const parsed = dashboardDraftFromToolResult({
      draft: { title: "Growth KPIs", blocks: [block] },
    });
    expect("dashboardId" in (parsed?.draft ?? {})).toBe(false);
    expect("projects" in (parsed?.draft ?? {})).toBe(false);
    expect("globalControls" in (parsed?.draft ?? {})).toBe(false);
  });

  it("surfaces droppedBlocks", () => {
    const parsed = dashboardDraftFromToolResult({
      draft: { title: "Growth KPIs", blocks: [block] },
      droppedBlocks: [
        { title: "Broken", type: "metric-exploration", reason: "no query" },
      ],
    });
    expect(parsed?.droppedBlocks).toHaveLength(1);
  });

  it("returns null for a result that carries no draft", () => {
    // The error branch of the tool, and every other tool's result.
    expect(
      dashboardDraftFromToolResult({ status: "error", message: "nope" }),
    ).toBeNull();
    expect(dashboardDraftFromToolResult({ summary: "a chart" })).toBeNull();
  });

  it("returns null rather than throwing on malformed input", () => {
    expect(dashboardDraftFromToolResult("not json")).toBeNull();
    expect(dashboardDraftFromToolResult(null)).toBeNull();
    expect(dashboardDraftFromToolResult(42)).toBeNull();
  });

  it("returns null when the draft has no blocks", () => {
    // An empty dashboard is not worth rendering a preview for.
    expect(
      dashboardDraftFromToolResult({ draft: { title: "Empty", blocks: [] } }),
    ).toBeNull();
  });

  it("returns null when the title is missing or not a string", () => {
    expect(
      dashboardDraftFromToolResult({ draft: { blocks: [block] } }),
    ).toBeNull();
    expect(
      dashboardDraftFromToolResult({ draft: { title: 42, blocks: [block] } }),
    ).toBeNull();
  });
});
