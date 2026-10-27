import {
  ExplorationConfig,
  draftExplorationMetricValidator,
  explorationConfigValidator,
  internalExplorationConfigValidator,
} from "shared/validators";
import { FactTableInterface } from "shared/types/fact-table";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTablesByIds } from "back-end/src/models/FactTableModel";
import { FactMetricModel } from "back-end/src/models/FactMetricModel";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { BadRequestError } from "back-end/src/util/errors";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTable: jest.fn(),
  getFactTablesByIds: jest.fn(),
}));

jest.mock("back-end/src/models/FactMetricModel", () => ({
  FactMetricModel: { validateFactMetric: jest.fn() },
}));

const getDataSourceByIdMock = jest.mocked(getDataSourceById);
const getFactTablesByIdsMock = jest.mocked(getFactTablesByIds);

const makeConfig = (
  datasetOverrides: Partial<
    Extract<ExplorationConfig["dataset"], { type: "funnel" }>
  > = {},
): ExplorationConfig => ({
  type: "funnel",
  datasource: "ds_1",
  dimensions: [],
  chartType: "bar",
  dateRange: {
    predefined: "last30Days",
    lookbackValue: null,
    lookbackUnit: null,
    startDate: null,
    endDate: null,
  },
  dataset: {
    type: "funnel",
    unit: "user_id",
    steps: [
      {
        name: "Step 1",
        factTableId: "ft_1",
        rowFilters: [],
        optional: false,
        conversionWindow: null,
      },
      {
        name: "Step 2",
        factTableId: "ft_2",
        rowFilters: [],
        optional: false,
        conversionWindow: null,
      },
    ],
    ...datasetOverrides,
  },
});

const makePermissions = () => ({
  canRunProductAnalyticsExplorationQueries: jest.fn(() => true),
  canCreateFactMetric: jest.fn(() => true),
  throwPermissionError: jest.fn(() => {
    throw new Error("permission denied");
  }),
});

const makeFactTable = (
  id: string,
  userIdTypes: string[] = ["user_id"],
): FactTableInterface =>
  ({
    id,
    datasource: "ds_1",
    userIdTypes,
  }) as FactTableInterface;

describe("runProductAnalyticsExploration funnel validation", () => {
  const create = jest.fn();
  const context = {
    permissions: makePermissions(),
    models: {
      analyticsExplorations: {
        findLatestByConfig: jest.fn(),
        create,
      },
    },
  } as unknown as ReqContext;

  beforeEach(() => {
    jest.clearAllMocks();
    getDataSourceByIdMock.mockResolvedValue({
      id: "ds_1",
      type: "postgres",
    });
  });

  it.each([
    {
      name: "fewer than two steps",
      config: makeConfig({ steps: [makeConfig().dataset.steps[0]] }),
      error: "Funnels require at least two steps",
    },
    {
      name: "a missing unit",
      config: makeConfig({ unit: null }),
      error: "Funnel unit is required",
    },
    {
      name: "a step without a fact table",
      config: makeConfig({
        steps: [
          makeConfig().dataset.steps[0],
          { ...makeConfig().dataset.steps[1], factTableId: "" },
        ],
      }),
      error: "Funnel steps require fact tables",
    },
  ])(
    "rejects $name before creating an exploration",
    async ({ config, error }) => {
      getFactTablesByIdsMock.mockResolvedValue([
        makeFactTable("ft_1"),
        makeFactTable("ft_2"),
      ]);

      await expect(
        runProductAnalyticsExploration(context, config, { cache: "never" }),
      ).rejects.toThrow(error);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("rejects a unit unavailable on a step's fact table before creating an exploration", async () => {
    getFactTablesByIdsMock.mockResolvedValue([
      makeFactTable("ft_1"),
      makeFactTable("ft_2", ["anonymous_id"]),
    ]);

    await expect(
      runProductAnalyticsExploration(context, makeConfig(), {
        cache: "never",
      }),
    ).rejects.toThrow(
      'Funnel unit "user_id" must exist on every step\'s fact table',
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe("draft metric explorations", () => {
  const draftMetric = draftExplorationMetricValidator.parse({
    name: "Revenue per user",
    description: "",
    owner: "",
    tags: [],
    projects: [],
    datasource: "ds_1",
    inverse: false,
    metricType: "mean",
    numerator: {
      factTableId: "ft_1",
      column: "revenue",
      aggregation: "sum",
      rowFilters: [],
    },
    denominator: null,
    funnelSettings: null,
    quantileSettings: null,
    cappingSettings: { type: "", value: 0 },
    windowSettings: {
      type: "conversion",
      windowValue: 3,
      windowUnit: "days",
      delayValue: 0,
      delayUnit: "hours",
    },
    priorSettings: { override: false, proper: false, mean: 0, stddev: 1 },
    maxPercentChange: 0.5,
    minPercentChange: 0.01,
    minSampleSize: 100,
    winRisk: 0.0025,
    loseRisk: 0.0125,
    regressionAdjustmentOverride: false,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 14,
  });
  const config: ExplorationConfig = {
    ...makeConfig(),
    type: "metric",
    chartType: "bigNumber",
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          metricId: "fact__preview",
          name: "Revenue",
          unit: "user_id",
          denominatorUnit: null,
          rowFilters: [],
          draftMetric,
        },
      ],
    },
  };
  const getByIds = jest.fn(async () => []);
  const create = jest.fn();
  const findLatestByConfig = jest.fn();
  const permissions = makePermissions();
  const context = {
    org: { id: "org_1" },
    permissions,
    models: {
      factMetrics: { getByIds },
      analyticsExplorations: {
        create,
        findLatestByConfig,
        getConfigHashes: jest.fn(() => {
          throw new Error("query boundary");
        }),
      },
    },
  } as unknown as ReqContext;

  beforeEach(() => {
    jest.clearAllMocks();
    getDataSourceByIdMock.mockResolvedValue({ id: "ds_1", type: "postgres" });
    getFactTablesByIdsMock.mockResolvedValue([makeFactTable("ft_1")]);
    jest.mocked(FactMetricModel.validateFactMetric).mockResolvedValue();
    permissions.canRunProductAnalyticsExplorationQueries.mockReturnValue(true);
    permissions.canCreateFactMetric.mockReturnValue(true);
  });
  const internal = { cache: "never", allowDraftMetrics: true } as const;

  it("uses and validates the unsaved calculation without loading a saved metric", async () => {
    await expect(
      runProductAnalyticsExploration(context, config, internal),
    ).rejects.toThrow("query boundary");
    expect(getByIds).toHaveBeenCalledWith([]);
    expect(FactMetricModel.validateFactMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fact__preview",
        organization: "org_1",
        metricType: "mean",
        numerator: draftMetric.numerator,
      }),
      null,
      expect.any(Map),
      context,
    );
    expect(getFactTablesByIdsMock).toHaveBeenCalledWith(context, ["ft_1"]);
  });

  it("turns metric validation failures into a BadRequestError before creating a query", async () => {
    jest
      .mocked(FactMetricModel.validateFactMetric)
      .mockRejectedValueOnce(new Error("Could not find numerator fact table"));
    const run = runProductAnalyticsExploration(context, config, internal);
    await expect(run).rejects.toThrow(BadRequestError);
    await expect(run).rejects.toThrow("Could not find numerator fact table");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects without run-queries permission before the cache or any warehouse query", async () => {
    permissions.canRunProductAnalyticsExplorationQueries.mockReturnValue(false);
    await expect(
      runProductAnalyticsExploration(context, config, {
        cache: "preferred",
        allowDraftMetrics: true,
      }),
    ).rejects.toThrow("permission denied");
    expect(findLatestByConfig).not.toHaveBeenCalled();
    expect(FactMetricModel.validateFactMetric).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a draft the user could not save as a fact metric", async () => {
    permissions.canCreateFactMetric.mockReturnValue(false);
    await expect(
      runProductAnalyticsExploration(context, config, internal),
    ).rejects.toThrow("permission denied");
    expect(FactMetricModel.validateFactMetric).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("ignores drafts from callers that do not opt in", async () => {
    await expect(
      runProductAnalyticsExploration(context, config, { cache: "never" }),
    ).rejects.toThrow("Metric not found: fact__preview");
    expect(FactMetricModel.validateFactMetric).not.toHaveBeenCalled();
  });

  it("keeps draftMetric out of the public validator only", () => {
    const publicValue = explorationConfigValidator.parse(config).dataset;
    const internalValue =
      internalExplorationConfigValidator.parse(config).dataset;
    expect(
      publicValue.type === "metric" && publicValue.values[0],
    ).not.toHaveProperty("draftMetric");
    expect(
      internalValue.type === "metric" && internalValue.values[0].draftMetric,
    ).toEqual(draftMetric);
  });
});
