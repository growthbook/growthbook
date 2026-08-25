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

  it("returns null for anything that is not a usable draft", () => {
    // Every other tool's result, the tool's own error branch, junk, and the
    // two drafts the validator rejects: no blocks, no title.
    for (const input of [
      { status: "error", message: "nope" },
      { summary: "a chart" },
      "not json",
      null,
      42,
      { draft: { title: "Empty", blocks: [] } },
      { draft: { blocks: [block] } },
    ]) {
      expect(dashboardDraftFromToolResult(input)).toBeNull();
    }
  });
});
