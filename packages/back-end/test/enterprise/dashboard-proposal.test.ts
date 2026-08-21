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

  it("omits dashboardId and globalControls when not given", async () => {
    mockRunExploration.mockResolvedValue({ id: "expl_1" });

    const { draft } = await buildDashboardDraft(
      ctx,
      input([chartBlock("Revenue")]),
    );

    expect("dashboardId" in draft).toBe(false);
    expect("globalControls" in draft).toBe(false);
  });
});
