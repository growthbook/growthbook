import { vi } from "vitest";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getAllFactTablesForOrganization,
  getFactTable,
  getFactTablesForDatasource,
} from "back-end/src/models/FactTableModel";
import { runColumnsTopValuesQuery } from "back-end/src/services/factTableColumns";
import {
  getProductAnalyticsColumnValues,
  getProductAnalyticsColumns,
  searchProductAnalyticsResources,
} from "back-end/src/services/product-analytics-tools";

vi.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: vi.fn(),
}));
vi.mock("back-end/src/models/FactTableModel", () => ({
  getAllFactTablesForOrganization: vi.fn(),
  getFactTable: vi.fn(),
  getFactTablesForDatasource: vi.fn(),
}));
vi.mock("back-end/src/services/factTableColumns", () => ({
  runColumnsTopValuesQuery: vi.fn(),
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

const factTable = (
  id: string,
  name: string,
  overrides: Partial<FactTableInterface> = {},
): FactTableInterface =>
  ({
    id,
    name,
    datasource: "ds_1",
    managedBy: "",
    eventName: null,
    columns: [],
    userIdTypes: ["user_id"],
    ...overrides,
  }) as FactTableInterface;

describe("product analytics tools", () => {
  const context = {
    models: {
      factMetrics: {
        getAll: vi.fn(),
        getByIds: vi.fn(),
      },
    },
  } as unknown as ReqContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDataSourceById).mockResolvedValue({
      id: "ds_1",
    } as Awaited<ReturnType<typeof getDataSourceById>>);
    vi.mocked(getAllFactTablesForOrganization).mockResolvedValue([]);
    vi.mocked(getFactTablesForDatasource).mockResolvedValue([]);
  });

  it("ranks singular and plural metric names as exact matches", async () => {
    context.models.factMetrics.getAll = vi
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
    context.models.factMetrics.getAll = vi
      .fn()
      .mockResolvedValue([
        metric("fact__included", "Included"),
        { ...metric("fact__excluded", "Excluded"), datasource: "ds_2" },
      ]);
    vi.mocked(getFactTablesForDatasource).mockResolvedValue([
      factTable("ft_1", "Events"),
    ]);

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
    context.models.factMetrics.getByIds = vi
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

  it("returns only user ID types shared by every unit-requiring metric", async () => {
    const firstMetric = {
      ...metric("fact__first", "First"),
      metricType: "proportion",
      numerator: { factTableId: "ft_1", column: "value" },
    } as FactMetricInterface;
    const secondMetric = {
      ...metric("fact__second", "Second"),
      metricType: "proportion",
      numerator: { factTableId: "ft_2", column: "value" },
    } as FactMetricInterface;
    context.models.factMetrics.getByIds = vi
      .fn()
      .mockResolvedValue([firstMetric, secondMetric]);
    vi.mocked(getFactTable).mockImplementation(async (_context, id) => {
      if (id === "ft_1") {
        return factTable("ft_1", "First", {
          userIdTypes: ["user_id", "anonymous_id"],
        });
      }
      return factTable("ft_2", "Second", {
        userIdTypes: ["anonymous_id", "device_id"],
      });
    });

    const result = await getProductAnalyticsColumns(context, {
      source: "metric",
      metricIds: ["fact__first", "fact__second"],
    });

    expect(result.userIdTypes).toEqual(["anonymous_id"]);
    expect(result.unitNote).toContain('default: "anonymous_id"');
  });

  it("does not let a no-unit metric restrict valid user ID types", async () => {
    const unitMetric = {
      ...metric("fact__unit", "Unit Metric"),
      metricType: "proportion",
      numerator: { factTableId: "ft_1", column: "value" },
    } as FactMetricInterface;
    const noUnitMetric = {
      ...metric("fact__no_unit", "No Unit Metric"),
      metricType: "mean",
      numerator: { factTableId: "ft_2", column: "value" },
    } as FactMetricInterface;
    context.models.factMetrics.getByIds = vi
      .fn()
      .mockResolvedValue([unitMetric, noUnitMetric]);
    vi.mocked(getFactTable).mockImplementation(async (_context, id) => {
      if (id === "ft_1") {
        return factTable("ft_1", "First", {
          userIdTypes: ["user_id"],
        });
      }
      return factTable("ft_2", "Second", {
        userIdTypes: ["account_id"],
      });
    });

    const result = await getProductAnalyticsColumns(context, {
      source: "metric",
      metricIds: ["fact__unit", "fact__no_unit"],
    });

    expect(result.userIdTypes).toEqual(["user_id"]);
    expect(result.metrics).toEqual([
      expect.objectContaining({ metricId: "fact__unit", needsUnit: true }),
      expect.objectContaining({ metricId: "fact__no_unit", needsUnit: false }),
    ]);
  });

  it("passes search terms into the warehouse query before limiting", async () => {
    const countryColumn = {
      column: "country",
      name: "Country",
      datatype: "string",
      deleted: false,
    } as FactTableInterface["columns"][number];
    vi.mocked(getFactTable).mockResolvedValue(
      factTable("ft_1", "Events", {
        sql: "SELECT country, timestamp FROM events",
        timestampColumn: "timestamp",
        columns: [countryColumn],
      }),
    );
    vi.mocked(runColumnsTopValuesQuery).mockResolvedValue({
      country: ["United States"],
    });

    const result = await getProductAnalyticsColumnValues(context, {
      source: "fact_table",
      factTableId: "ft_1",
      columns: ["country"],
      searchTerm: "states",
      limit: 5,
    });

    expect(runColumnsTopValuesQuery).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ id: "ds_1" }),
      expect.objectContaining({ timestampColumn: "timestamp" }),
      [countryColumn],
      { limit: 5, searchTerm: "states" },
    );
    expect(result.values).toEqual({ country: ["United States"] });
  });
});
