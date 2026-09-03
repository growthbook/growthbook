import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getAllFactTablesForOrganization,
  getFactTablesForDatasource,
} from "back-end/src/models/FactTableModel";
import {
  getProductAnalyticsColumns,
  searchProductAnalyticsResources,
} from "back-end/src/services/product-analytics-tools";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));
jest.mock("back-end/src/models/FactTableModel", () => ({
  getAllFactTablesForOrganization: jest.fn(),
  getFactTable: jest.fn(),
  getFactTablesForDatasource: jest.fn(),
}));
jest.mock("back-end/src/services/factTableColumns", () => ({
  runColumnsTopValuesQuery: jest.fn(),
}));

const metric = (id: string, name: string): FactMetricInterface =>
  ({
    id,
    name,
    datasource: "ds_1",
    metricType: "mean",
    managedBy: "",
    description: null,
    owner: "",
    tags: [],
    numerator: { factTableId: "ft_1", column: "value" },
  }) as FactMetricInterface;

const factTable = (id: string, name: string): FactTableInterface =>
  ({
    id,
    name,
    datasource: "ds_1",
    managedBy: "",
    eventName: null,
    columns: [],
    userIdTypes: ["user_id"],
  }) as FactTableInterface;

describe("product analytics tools", () => {
  const context = {
    models: {
      factMetrics: {
        getAll: jest.fn(),
        getByIds: jest.fn(),
      },
    },
  } as unknown as ReqContext;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getDataSourceById).mockResolvedValue({
      id: "ds_1",
    } as Awaited<ReturnType<typeof getDataSourceById>>);
    jest.mocked(getAllFactTablesForOrganization).mockResolvedValue([]);
    jest.mocked(getFactTablesForDatasource).mockResolvedValue([]);
  });

  it("ranks singular and plural metric names as exact matches", async () => {
    context.models.factMetrics.getAll = jest
      .fn()
      .mockResolvedValue([
        metric("fact__views", "Page View"),
        metric("fact__other", "Page Events"),
      ]);

    const result = await searchProductAnalyticsResources(context, {
      query: "page views",
      limit: 10,
      skip: 0,
    });

    expect(result.matches.map(({ id }) => id)).toEqual([
      "fact__views",
      "fact__other",
    ]);
  });

  it("scopes datasource searches before returning resources", async () => {
    context.models.factMetrics.getAll = jest
      .fn()
      .mockResolvedValue([
        metric("fact__included", "Included"),
        { ...metric("fact__excluded", "Excluded"), datasource: "ds_2" },
      ]);
    jest
      .mocked(getFactTablesForDatasource)
      .mockResolvedValue([factTable("ft_1", "Events")]);

    const result = await searchProductAnalyticsResources(context, {
      query: "",
      datasourceId: "ds_1",
      limit: 10,
      skip: 0,
    });

    expect(result.matches.map(({ id }) => id)).toEqual([
      "ft_1",
      "fact__included",
    ]);
    expect(result.totalMetrics).toBe(1);
  });

  it("rejects inaccessible Fact Metrics when listing columns", async () => {
    context.models.factMetrics.getByIds = jest
      .fn()
      .mockResolvedValue([metric("fact__visible", "Visible")]);

    await expect(
      getProductAnalyticsColumns(context, {
        source: "metric",
        metricIds: ["fact__visible", "fact__hidden"],
      }),
    ).rejects.toThrow(
      "One or more Fact Metrics were not found or are not accessible.",
    );
  });
});
