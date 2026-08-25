const mockRunExploration = jest.fn();

jest.mock("back-end/src/enterprise/services/product-analytics", () => ({
  runProductAnalyticsExploration: (...args: unknown[]) =>
    mockRunExploration(...args),
}));

import {
  buildDashboardDraft,
  type BuildDashboardDraftInput,
} from "back-end/src/enterprise/services/dashboard-proposal";
import type { ReqContext } from "back-end/types/request";

const ctx = {} as ReqContext;

const metricConfig = {
  type: "metric" as const,
  datasource: "ds_abc",
  chartType: "line" as const,
  dateRange: { predefined: "last30Days" as const },
  dimensions: [],
  dataset: {
    type: "metric" as const,
    values: [
      {
        type: "metric" as const,
        name: "Revenue",
        metricId: "fact__rev",
        unit: "user_id",
        denominatorUnit: null,
        rowFilters: [],
      },
    ],
  },
};

function chartBlock(title: string, sizeHint?: "small" | "medium" | "full") {
  return {
    type: "metric-exploration" as const,
    title,
    description: "",
    ...(sizeHint ? { sizeHint } : {}),
    config: metricConfig,
  };
}

function input(
  blocks: BuildDashboardDraftInput["blocks"],
  extra: Partial<BuildDashboardDraftInput> = {},
): BuildDashboardDraftInput {
  return { title: "Growth KPIs", blocks, ...extra };
}

describe("buildDashboardDraft", () => {
  beforeEach(() => {
    mockRunExploration.mockReset();
  });

  it("runs each chart and wires its analysis id onto the block", async () => {
    mockRunExploration
      .mockResolvedValueOnce({ id: "expl_1" })
      .mockResolvedValueOnce({ id: "expl_2" });

    const { draft, droppedBlocks } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue"), chartBlock("Signups")]),
    );

    expect(droppedBlocks).toEqual([]);
    expect(draft.blocks.map((b) => b["explorerAnalysisId"])).toEqual([
      "expl_1",
      "expl_2",
    ]);
  });

  it("strips sizeHint from the block it produces", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue", "small")]),
    );

    expect("sizeHint" in draft.blocks[0]).toBe(false);
  });

  it("packs the grid from the size hints", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([
        chartBlock("A", "small"),
        chartBlock("B", "small"),
        chartBlock("C", "small"),
        chartBlock("D", "medium"),
      ]),
    );

    expect(draft.blocks.map((b) => b.layout)).toEqual([
      { x: 0, y: 0, w: 8, h: 4 },
      { x: 8, y: 0, w: 8, h: 4 },
      { x: 16, y: 0, w: 8, h: 4 },
      { x: 0, y: 4, w: 12, h: 8 },
    ]);
  });

  it("does not run a query for a block that needs none", async () => {
    const { draft } = await buildDashboardDraft(
      ctx,
      input([
        {
          type: "markdown",
          title: "",
          description: "",
          content: "## Funnel",
        },
        {
          type: "experiments-status",
          title: "Team Velocity",
          description: "",
          dateRange: { predefined: "last90Days" },
          projects: [],
        },
      ]),
    );

    expect(mockRunExploration).not.toHaveBeenCalled();
    expect(draft.blocks).toHaveLength(2);
  });

  it("drops a chart whose query could not be started, and says which", async () => {
    mockRunExploration
      .mockResolvedValueOnce({ id: "expl_1" })
      .mockResolvedValueOnce(null);

    const { draft, droppedBlocks } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue"), chartBlock("Broken")]),
    );

    expect(draft.blocks).toHaveLength(1);
    expect(droppedBlocks).toEqual([
      {
        title: "Broken",
        type: "metric-exploration",
        reason: "the query could not be started",
      },
    ]);
  });

  it("drops a chart whose query threw rather than failing the whole draft", async () => {
    mockRunExploration
      .mockRejectedValueOnce(new Error("warehouse down"))
      .mockResolvedValueOnce({ id: "expl_2" });

    const { draft, droppedBlocks } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Broken"), chartBlock("Signups")]),
    );

    expect(draft.blocks).toHaveLength(1);
    expect(draft.blocks[0]["explorerAnalysisId"]).toBe("expl_2");
    expect(droppedBlocks).toHaveLength(1);
  });

  it("carries the title, global controls, and dashboardId through", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], {
        dashboardId: "dash_abc",
        globalControls: { dateRange: { predefined: "last90Days" } },
      }),
    );

    expect(draft.title).toBe("Growth KPIs");
    expect(draft.dashboardId).toBe("dash_abc");
    expect(draft.globalControls).toEqual({
      dateRange: { predefined: "last90Days" },
    });
  });

  it("carries the projects the agent settled with the user", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], { projects: ["prj_abc"] }),
    );

    expect(draft.projects).toEqual(["prj_abc"]);
  });

  it("keeps an explicit empty projects array, which means every project", async () => {
    // Distinct from omitting it: the preview falls back to the app's current
    // project selection only when the agent could not establish one at all.
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], { projects: [] }),
    );

    expect(draft.projects).toEqual([]);
  });

  it("omits dashboardId, projects, and globalControls when not given", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")]),
    );

    expect("dashboardId" in draft).toBe(false);
    expect("projects" in draft).toBe(false);
    expect("globalControls" in draft).toBe(false);
  });

  it("enrolls chart blocks in the dashboard date control", async () => {
    // Without this the filter bar is inert for the tile and Update skips it.
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], {
        globalControls: { dateRange: { predefined: "last7Days" } },
      }),
    );

    expect(draft.blocks[0]["globalControlSettings"]).toEqual({
      dateRange: true,
    });
  });

  it("does not enroll when the dashboard has no date control", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")]),
    );

    expect("globalControlSettings" in draft.blocks[0]).toBe(false);
  });

  it("queries the config the dashboard date control produces, not the raw one", async () => {
    // The tile recomputes this same effective config on render and compares its
    // date fingerprint against what was queried. Querying the raw config leaves
    // every tile showing "Global controls changed" on an untouched dashboard.
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], {
        globalControls: { dateRange: { predefined: "last90Days" } },
      }),
    );

    const queriedConfig = mockRunExploration.mock.calls[0][1];
    expect(queriedConfig.dateRange).toEqual({ predefined: "last90Days" });
  });

  it("queries the block's own range when the dashboard sets none", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    await buildDashboardDraft(ctx, input([chartBlock("Revenue")]));

    const queriedConfig = mockRunExploration.mock.calls[0][1];
    expect(queriedConfig.dateRange).toEqual({ predefined: "last30Days" });
  });

  it("runs the previous period too when the block compares", async () => {
    mockRunExploration
      .mockResolvedValueOnce({ id: "expl_now" })
      .mockResolvedValueOnce({ id: "expl_prev" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([
        {
          ...chartBlock("Revenue"),
          comparison: { enabled: true, mode: "previousPeriod" as const },
        },
      ]),
    );

    expect(mockRunExploration).toHaveBeenCalledTimes(2);
    expect(draft.blocks[0]["explorerAnalysisId"]).toBe("expl_now");
    expect(draft.blocks[0]["comparisonExplorerAnalysisId"]).toBe("expl_prev");
  });

  it("keeps the primary tile when only the comparison query fails", async () => {
    mockRunExploration
      .mockResolvedValueOnce({ id: "expl_now" })
      .mockRejectedValueOnce(new Error("warehouse down"));

    const { draft, droppedBlocks } = await buildDashboardDraft(
      ctx,
      input([
        {
          ...chartBlock("Revenue"),
          comparison: { enabled: true, mode: "previousPeriod" as const },
        },
      ]),
    );

    expect(droppedBlocks).toEqual([]);
    expect(draft.blocks[0]["explorerAnalysisId"]).toBe("expl_now");
    expect("comparisonExplorerAnalysisId" in draft.blocks[0]).toBe(false);
  });

  it("does not run a previous period when comparison is off", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    await buildDashboardDraft(
      ctx,
      input([{ ...chartBlock("Revenue"), comparison: { enabled: false } }]),
    );

    expect(mockRunExploration).toHaveBeenCalledTimes(1);
  });

  it("carries a dashboard-wide comparison through to the draft", async () => {
    mockRunExploration
      .mockResolvedValueOnce({ id: "expl_now" })
      .mockResolvedValueOnce({ id: "expl_prev" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], {
        comparison: { enabled: true, mode: "previousPeriod" as const },
      }),
    );

    expect(draft.comparison).toEqual({
      enabled: true,
      mode: "previousPeriod",
    });
    expect(draft.blocks[0]["comparisonExplorerAnalysisId"]).toBe("expl_prev");
  });

  it("lets a dashboard-wide comparison turn a block's own comparison off", async () => {
    // resolveBlockComparison gives the dashboard precedence both ways, so the
    // previous-period query must not run just because the block asked for one.
    mockRunExploration.mockResolvedValue({ id: "expl_now" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input(
        [
          {
            ...chartBlock("Revenue"),
            comparison: { enabled: true, mode: "previousPeriod" as const },
          },
        ],
        { comparison: { enabled: false } },
      ),
    );

    expect(mockRunExploration).toHaveBeenCalledTimes(1);
    expect("comparisonExplorerAnalysisId" in draft.blocks[0]).toBe(false);
  });

  it("omits comparison from the draft when none was asked for", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")]),
    );

    expect("comparison" in draft).toBe(false);
  });

  it("never serves a proposed tile from the exploration cache", async () => {
    // A hit stores a config the tile compares against and reads as stale.
    mockRunExploration.mockResolvedValue({ id: "expl_now" });

    await buildDashboardDraft(
      ctx,
      input(
        [
          {
            ...chartBlock("Revenue"),
            comparison: { enabled: true, mode: "previousPeriod" as const },
          },
        ],
        {
          globalControls: { dateRange: { predefined: "last30Days" as const } },
        },
      ),
    );

    expect(mockRunExploration).toHaveBeenCalledTimes(2);
    for (const call of mockRunExploration.mock.calls) {
      expect(call[2]).toEqual({ cache: "never" });
    }
  });
});
