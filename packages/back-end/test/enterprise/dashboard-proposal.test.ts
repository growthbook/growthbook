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

  it("carries every field the agent settled through to the draft", async () => {
    // `projects: []` is load-bearing and distinct from omitting it: empty means
    // every project, absent means fall back to the app's current selection.
    mockRunExploration.mockResolvedValue({ id: "expl_1" });
    // Revising, so the dashboard has to exist — an id that resolves to nothing
    // is refused rather than carried.
    const revising = {
      models: {
        dashboards: {
          getById: jest.fn().mockResolvedValue({ id: "dash_abc", blocks: [] }),
        },
      },
    } as unknown as ReqContext;

    const { draft } = await buildDashboardDraft(
      revising,
      input([chartBlock("Revenue")], {
        dashboardId: "dash_abc",
        projects: [],
        globalControls: { dateRange: { predefined: "last90Days" } },
      }),
    );

    expect(draft).toMatchObject({
      title: "Growth KPIs",
      dashboardId: "dash_abc",
      projects: [],
      globalControls: { dateRange: { predefined: "last90Days" } },
    });
  });

  it("omits every optional field when the agent settled none", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")]),
    );

    for (const key of [
      "dashboardId",
      "projects",
      "globalControls",
      "comparison",
    ]) {
      expect(key in draft).toBe(false);
    }
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

    expect(draft.comparison).toEqual({ enabled: true, mode: "previousPeriod" });
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

// Given only a `dashboardId`, the draft must come back as the dashboard already is.
describe("buildDashboardDraft — loading a saved dashboard", () => {
  const savedBlock = {
    id: "blk_1",
    uid: "uid_1",
    organization: "org_1",
    type: "metric-exploration" as const,
    title: "Revenue",
    description: "",
    layout: { x: 0, y: 0, w: 12, h: 8 },
    explorerAnalysisId: "expl_saved",
    config: metricConfig,
  };

  function ctxWith(dashboard: unknown) {
    return {
      models: {
        dashboards: { getById: jest.fn().mockResolvedValue(dashboard) },
      },
    } as unknown as ReqContext;
  }

  const saved = {
    id: "dash_abc",
    title: "Growth KPIs",
    projects: ["prj_1"],
    globalControls: { dateRange: { predefined: "last90Days" as const } },
    blocks: [savedBlock],
  };

  beforeEach(() => {
    mockRunExploration.mockReset();
  });

  it("returns the saved blocks untouched and runs nothing", async () => {
    const { draft, droppedBlocks, error } = await buildDashboardDraft(
      ctxWith(saved),
      { dashboardId: "dash_abc" },
    );

    expect(error).toBeUndefined();
    expect(droppedBlocks).toEqual([]);
    expect(draft.blocks).toEqual([savedBlock]);
    expect(mockRunExploration).not.toHaveBeenCalled();
  });

  it("takes the dashboard's own title, projects and controls", async () => {
    const { draft } = await buildDashboardDraft(ctxWith(saved), {
      dashboardId: "dash_abc",
    });

    expect(draft.dashboardId).toBe("dash_abc");
    expect(draft.title).toBe("Growth KPIs");
    expect(draft.projects).toEqual(["prj_1"]);
    expect(draft.globalControls).toEqual({
      dateRange: { predefined: "last90Days" },
    });
  });

  it("lets the caller override them", async () => {
    const { draft } = await buildDashboardDraft(ctxWith(saved), {
      dashboardId: "dash_abc",
      title: "Renamed",
      projects: [],
      globalControls: { dateRange: { predefined: "last7Days" as const } },
    });

    expect(draft.title).toBe("Renamed");
    // `[]` is "every project", so it wins over the dashboard's own list.
    expect(draft.projects).toEqual([]);
    expect(draft.globalControls).toEqual({
      dateRange: { predefined: "last7Days" },
    });
  });

  it("reports a dashboard that isn't there", async () => {
    const { error } = await buildDashboardDraft(ctxWith(null), {
      dashboardId: "dash_missing",
    });
    expect(error).toContain("dash_missing");
  });

  it("refuses an experiment dashboard", async () => {
    const { error } = await buildDashboardDraft(
      ctxWith({ ...saved, experimentId: "exp_1" }),
      { dashboardId: "dash_abc" },
    );
    expect(error).toContain("experiment");
  });

  it("refuses one with no blocks, rather than showing an empty preview", async () => {
    const { error } = await buildDashboardDraft(
      ctxWith({ ...saved, blocks: [] }),
      { dashboardId: "dash_abc" },
    );
    expect(error).toBeDefined();
  });
});

// The model cannot send `layout`, so without carry-over every edit re-packs the grid.
describe("buildDashboardDraft — revising a saved dashboard", () => {
  function savedBlock(
    title: string,
    layout: { x: number; y: number; w: number; h: number },
    id = `blk_${title}`,
  ) {
    return {
      id,
      uid: `uid_${title}`,
      organization: "org_1",
      type: "metric-exploration" as const,
      title,
      description: "",
      layout,
      explorerAnalysisId: "expl_old",
      config: metricConfig,
    };
  }

  function ctxWith(blocks: unknown[]) {
    return {
      models: {
        dashboards: {
          getById: jest.fn().mockResolvedValue({
            id: "dash_abc",
            title: "Growth KPIs",
            blocks,
          }),
        },
      },
    } as unknown as ReqContext;
  }

  beforeEach(() => {
    mockRunExploration.mockReset();
    mockRunExploration.mockResolvedValue({ id: "expl_new" });
  });

  it("gives a carried-over block back its position", async () => {
    const ctx = ctxWith([savedBlock("Revenue", { x: 12, y: 4, w: 12, h: 6 })]);

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue", "small")], { dashboardId: "dash_abc" }),
    );

    // `sizeHint: "small"` would have packed it at x:0,y:0,w:8.
    expect(draft.blocks[0]["layout"]).toEqual({ x: 12, y: 4, w: 12, h: 6 });
  });

  it("gives it back its identity, so per-block uids survive an edit", async () => {
    const ctx = ctxWith([savedBlock("Revenue", { x: 0, y: 0, w: 24, h: 8 })]);

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], { dashboardId: "dash_abc" }),
    );

    expect(draft.blocks[0]["id"]).toBe("blk_Revenue");
    expect(draft.blocks[0]["uid"]).toBe("uid_Revenue");
    // Re-run, so the result pointer is the new one.
    expect(draft.blocks[0]["explorerAnalysisId"]).toBe("expl_new");
  });

  it("stacks a newly added block below everything it kept", async () => {
    const ctx = ctxWith([savedBlock("Revenue", { x: 0, y: 0, w: 12, h: 6 })]);

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue"), chartBlock("Signups", "medium")], {
        dashboardId: "dash_abc",
      }),
    );

    expect(draft.blocks[0]["layout"]).toEqual({ x: 0, y: 0, w: 12, h: 6 });
    // Below the kept block's bottom edge (y 0 + h 6).
    expect(draft.blocks[1]["layout"]).toMatchObject({ x: 0, y: 6 });
  });

  it("treats a retitled block as new rather than claiming someone else's slot", async () => {
    const ctx = ctxWith([savedBlock("Revenue", { x: 12, y: 4, w: 12, h: 6 })]);

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue renamed")], { dashboardId: "dash_abc" }),
    );

    expect(draft.blocks[0]["id"]).toBeUndefined();
    expect(draft.blocks[0]["layout"]).not.toEqual({ x: 12, y: 4, w: 12, h: 6 });
  });

  it("does not let two same-titled blocks claim one original", async () => {
    const ctx = ctxWith([savedBlock("Revenue", { x: 0, y: 0, w: 12, h: 6 })]);

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue"), chartBlock("Revenue")], {
        dashboardId: "dash_abc",
      }),
    );

    expect(draft.blocks[0]["id"]).toBe("blk_Revenue");
    expect(draft.blocks[1]["id"]).toBeUndefined();
  });

  it("packs from scratch when the proposal is not a revision", async () => {
    const { draft } = await buildDashboardDraft(
      {} as ReqContext,
      input([chartBlock("Revenue", "small"), chartBlock("Signups", "small")]),
    );

    expect(draft.blocks[0]["layout"]).toMatchObject({ x: 0, y: 0 });
    expect(draft.blocks[1]["layout"]).toMatchObject({ x: 8, y: 0 });
  });

  // Requiring a title on an edit made the agent interrogate the user for a name
  // it could not see, having only the id.
  it("keeps the saved name when the edit does not carry one", async () => {
    const ctx = ctxWith([savedBlock("Revenue", { x: 0, y: 0, w: 24, h: 8 })]);

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], {
        dashboardId: "dash_abc",
        title: undefined,
      }),
    );

    expect(draft.title).toBe("Growth KPIs");
  });

  // Omitting these used to blank them, so an edit silently reverted the date
  // range and comparison the user had set.
  it("keeps the saved globalControls and comparison when the edit omits them", async () => {
    const ctx = ctxWith([savedBlock("Revenue", { x: 0, y: 0, w: 24, h: 8 })]);
    (ctx.models.dashboards.getById as jest.Mock).mockResolvedValue({
      id: "dash_abc",
      title: "Growth KPIs",
      blocks: [savedBlock("Revenue", { x: 0, y: 0, w: 24, h: 8 })],
      globalControls: { dateRange: { type: "last", days: 60 } },
      comparison: { enabled: true, mode: "previousPeriod" },
    });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], {
        dashboardId: "dash_abc",
        title: undefined,
      }),
    );

    expect(draft.globalControls).toEqual({
      dateRange: { type: "last", days: 60 },
    });
    expect(draft.comparison).toEqual({ enabled: true, mode: "previousPeriod" });
  });

  it("still renames when the edit carries a title", async () => {
    const ctx = ctxWith([savedBlock("Revenue", { x: 0, y: 0, w: 24, h: 8 })]);

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], {
        dashboardId: "dash_abc",
        title: "Renamed",
      }),
    );

    expect(draft.title).toBe("Renamed");
  });
});

// An id that resolves to nothing used to reach the draft, binding the preview to
// a dashboard that isn't there: "Update dashboard" over a 404.
describe("buildDashboardDraft — an unresolvable dashboardId", () => {
  beforeEach(() => {
    mockRunExploration.mockReset();
    mockRunExploration.mockResolvedValue({ id: "expl_1" });
  });

  it("refuses rather than binding the preview to it", async () => {
    const ctx = {
      models: { dashboards: { getById: jest.fn().mockResolvedValue(null) } },
    } as unknown as ReqContext;

    const { draft, error } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], { dashboardId: "dash_gone" }),
    );

    expect(error).toContain("dash_gone");
    expect(draft.dashboardId).toBeUndefined();
  });

  it("refuses when the lookup throws, rather than silently creating a copy", async () => {
    const ctx = {
      models: {
        dashboards: {
          getById: jest.fn().mockRejectedValue(new Error("mongo down")),
        },
      },
    } as unknown as ReqContext;

    const { error } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")], { dashboardId: "dash_abc" }),
    );

    expect(error).toBeDefined();
  });
});

// Dropping a tile that already exists is a deletion: the preview PUTs the block
// list as the dashboard's complete set.
describe("buildDashboardDraft — a failed re-run on an existing tile", () => {
  const saved = {
    id: "blk_rev",
    uid: "uid_rev",
    organization: "org_1",
    type: "metric-exploration" as const,
    title: "Revenue",
    description: "",
    layout: { x: 0, y: 0, w: 24, h: 8 },
    explorerAnalysisId: "expl_old",
    config: metricConfig,
  };

  const ctxWith = (blocks: unknown[]) =>
    ({
      models: {
        dashboards: {
          getById: jest.fn().mockResolvedValue({ id: "dash_abc", blocks }),
        },
      },
    }) as unknown as ReqContext;

  beforeEach(() => {
    mockRunExploration.mockReset();
  });

  it("keeps the saved tile rather than deleting it", async () => {
    mockRunExploration.mockRejectedValue(new Error("warehouse down"));

    const { draft, droppedBlocks } = await buildDashboardDraft(
      ctxWith([saved]),
      input([chartBlock("Revenue")], { dashboardId: "dash_abc" }),
    );

    expect(draft.blocks).toEqual([saved]);
    expect(droppedBlocks).toEqual([
      {
        title: "Revenue",
        type: "metric-exploration",
        reason: "the query could not be re-run",
        kept: true,
      },
    ]);
  });

  // A failed rename that collides with another saved tile's title claims that
  // tile, so the real original is left unclaimed and Update would delete it.
  it("refuses when a failed tile leaves another saved one unclaimed", async () => {
    mockRunExploration.mockRejectedValue(new Error("warehouse down"));
    const signups = {
      ...saved,
      id: "blk_sig",
      uid: "uid_sig",
      title: "Signups",
    };

    const { draft, error } = await buildDashboardDraft(
      ctxWith([saved, signups]),
      input([chartBlock("Signups")], { dashboardId: "dash_abc" }),
    );

    expect(error).toContain('Could not run "Signups"');
    expect(draft.blocks).toEqual([]);
  });
});

// A rename plus a failed re-run is indistinguishable from a brand-new tile, and
// guessing wrong deletes the original.
describe("buildDashboardDraft — a failed tile that cannot be traced back", () => {
  const saved = {
    id: "blk_rev",
    uid: "uid_rev",
    organization: "org_1",
    type: "metric-exploration" as const,
    title: "Revenue",
    description: "",
    layout: { x: 0, y: 0, w: 24, h: 8 },
    explorerAnalysisId: "expl_old",
    config: metricConfig,
  };

  const ctxWith = (blocks: unknown[]) =>
    ({
      models: {
        dashboards: {
          getById: jest.fn().mockResolvedValue({ id: "dash_abc", blocks }),
        },
      },
    }) as unknown as ReqContext;

  beforeEach(() => {
    mockRunExploration.mockReset();
  });

  it("refuses while a saved tile is unaccounted for", async () => {
    mockRunExploration.mockRejectedValue(new Error("warehouse down"));

    const { error } = await buildDashboardDraft(
      ctxWith([saved]),
      input([chartBlock("Revenue renamed")], { dashboardId: "dash_abc" }),
    );

    expect(error).toContain("Revenue renamed");
    expect(error).toContain("deletes it");
  });

  it("drops it once every saved tile is claimed", async () => {
    // "Revenue" claims the saved tile and runs; only the new one fails.
    mockRunExploration
      .mockResolvedValueOnce({ id: "expl_new" })
      .mockRejectedValue(new Error("warehouse down"));

    const { draft, droppedBlocks, error } = await buildDashboardDraft(
      ctxWith([saved]),
      input([chartBlock("Revenue"), chartBlock("Signups")], {
        dashboardId: "dash_abc",
      }),
    );

    expect(error).toBeUndefined();
    expect(draft.blocks).toHaveLength(1);
    expect(droppedBlocks[0].title).toBe("Signups");
  });
});
