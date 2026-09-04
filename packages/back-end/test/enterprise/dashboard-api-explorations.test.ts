const mockRunExploration = jest.fn();

jest.mock("back-end/src/enterprise/services/product-analytics", () => ({
  runProductAnalyticsExploration: (...args: unknown[]) =>
    mockRunExploration(...args),
}));

import { runNewApiExplorationBlocks } from "back-end/src/enterprise/services/dashboards";
import type { ReqContext } from "back-end/types/request";

const ctx = {} as ReqContext;

const metricConfig = {
  type: "metric" as const,
  datasource: "ds_abc",
  chartType: "line" as const,
  dateRange: { predefined: "last7Days" as const },
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

function chartBlock(overrides: Record<string, unknown> = {}) {
  return {
    type: "metric-exploration" as const,
    title: "Revenue",
    description: "",
    config: metricConfig,
    ...overrides,
  };
}

const runConfig = (call: number) =>
  mockRunExploration.mock.calls[call][1] as typeof metricConfig;

describe("runNewApiExplorationBlocks", () => {
  beforeEach(() => {
    mockRunExploration.mockReset();
    mockRunExploration.mockResolvedValue({ id: "expl_1" });
  });

  it("runs a chart block that arrived without an analysis id", async () => {
    const [block] = await runNewApiExplorationBlocks(ctx, [chartBlock()], {});

    expect(mockRunExploration).toHaveBeenCalledTimes(1);
    // Never cached: a fuzzy hit would store a date range the tile reads as stale.
    expect(mockRunExploration.mock.calls[0][2]).toEqual({ cache: "never" });
    expect(block).toMatchObject({ explorerAnalysisId: "expl_1" });
  });

  it("leaves a block that already names an analysis alone", async () => {
    const blocks = [chartBlock({ explorerAnalysisId: "expl_existing" })];

    const [block] = await runNewApiExplorationBlocks(ctx, blocks, {});

    expect(mockRunExploration).not.toHaveBeenCalled();
    expect(block).toMatchObject({ explorerAnalysisId: "expl_existing" });
  });

  it("leaves blocks with no chart of their own alone", async () => {
    const markdown = {
      type: "markdown" as const,
      title: "About",
      description: "",
      content: "hi",
    };

    const [block] = await runNewApiExplorationBlocks(ctx, [markdown], {});

    expect(mockRunExploration).not.toHaveBeenCalled();
    expect(block).toEqual(markdown);
  });

  it("enrolls a new block in the dashboard's date range, and queries that range", async () => {
    // A query that ignored the enrollment leaves the tile on "click Update".
    const [block] = await runNewApiExplorationBlocks(ctx, [chartBlock()], {
      globalControls: { dateRange: { predefined: "last90Days" } },
    });

    expect(block).toMatchObject({
      globalControlSettings: { dateRange: true },
    });
    expect(runConfig(0).dateRange).toMatchObject({ predefined: "last90Days" });
  });

  it("honors an explicit opt-out from the caller", async () => {
    const [block] = await runNewApiExplorationBlocks(
      ctx,
      [chartBlock({ globalControlSettings: { dateRange: false } })],
      { globalControls: { dateRange: { predefined: "last90Days" } } },
    );

    expect(block).toMatchObject({
      globalControlSettings: { dateRange: false },
    });
    expect(runConfig(0).dateRange).toMatchObject({ predefined: "last7Days" });
  });

  it("runs a second query for a dashboard-wide comparison", async () => {
    mockRunExploration
      .mockResolvedValueOnce({ id: "expl_primary" })
      .mockResolvedValueOnce({ id: "expl_previous" });

    const [block] = await runNewApiExplorationBlocks(ctx, [chartBlock()], {
      comparison: { enabled: true, mode: "previousPeriod" },
    });

    expect(mockRunExploration).toHaveBeenCalledTimes(2);
    expect(block).toMatchObject({
      explorerAnalysisId: "expl_primary",
      comparisonExplorerAnalysisId: "expl_previous",
    });
  });

  it("propagates a failure instead of writing a tile that cannot render", async () => {
    mockRunExploration.mockRejectedValueOnce(
      new Error("Metric not found on this datasource"),
    );

    await expect(
      runNewApiExplorationBlocks(ctx, [chartBlock()], {}),
    ).rejects.toThrow("Metric not found on this datasource");
  });
});
