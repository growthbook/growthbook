import { ExplorationConfig } from "shared/validators";
import { FactTableInterface } from "shared/types/fact-table";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTablesByIds } from "back-end/src/models/FactTableModel";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTable: jest.fn(),
  getFactTablesByIds: jest.fn(),
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
        factTable: "ft_1",
        rowFilters: [],
        optional: false,
        conversionWindow: null,
      },
      {
        name: "Step 2",
        factTable: "ft_2",
        rowFilters: [],
        optional: false,
        conversionWindow: null,
      },
    ],
    ...datasetOverrides,
  },
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
          { ...makeConfig().dataset.steps[1], factTable: "" },
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
