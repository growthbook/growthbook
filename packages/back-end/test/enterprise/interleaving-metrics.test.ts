import { FactMetricInterface, ColumnInterface } from "shared/types/fact-table";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { resolveInterleavingMetrics } from "back-end/src/enterprise/services/interleavingMetrics";
import { ReqContext } from "back-end/types/request";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

jest.mock("back-end/src/models/MetricModel", () => ({
  getMetricMap: jest.fn(),
}));
jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTableMap: jest.fn(),
}));

const mockGetMetricMap = getMetricMap as jest.MockedFunction<
  typeof getMetricMap
>;
const mockGetFactTableMap = getFactTableMap as jest.MockedFunction<
  typeof getFactTableMap
>;

const DATASOURCE = "test-datasource";
const USER_ID_TYPE = "user_id";

const column = (name: string): ColumnInterface => ({
  column: name,
  datatype: "string",
  name: "",
  description: "",
  numberFormat: "",
  deleted: false,
  dateCreated: new Date(),
  dateUpdated: new Date(),
  alwaysInlineFilter: false,
});

const tableWith = (columns: string[]) =>
  factTableFactory.build({
    id: "ft_cart",
    datasource: DATASOURCE,
    userIdTypes: [USER_ID_TYPE],
    columns: columns.map(column),
  });

const metric = (overrides: Partial<FactMetricInterface> = {}) =>
  factMetricFactory.build({
    id: "fact__goal",
    datasource: DATASOURCE,
    metricType: "proportion",
    ...overrides,
    numerator: {
      factTableId: "ft_cart",
      column: "$$count",
      aggregation: "sum",
      rowFilters: [],
      ...overrides.numerator,
    },
  });

// Both the item_id and ranking_id columns present, so paired analyses resolve
// unless a test removes one.
const FULL_COLUMNS = ["item_id", "ranking_id", "value"];

function setup(
  metrics: FactMetricInterface[],
  factTables = [tableWith(FULL_COLUMNS)],
) {
  mockGetMetricMap.mockResolvedValue(
    new Map(metrics.map((m) => [m.id, m])) as Awaited<
      ReturnType<typeof getMetricMap>
    >,
  );
  mockGetFactTableMap.mockResolvedValue(
    new Map(factTables.map((t) => [t.id, t])) as Awaited<
      ReturnType<typeof getFactTableMap>
    >,
  );
}

const resolve = (
  metricIds: string[],
  analyses: { type: "paired" | "preference" }[] = [{ type: "preference" }],
) =>
  resolveInterleavingMetrics({} as ReqContext, {
    datasourceId: DATASOURCE,
    userIdType: USER_ID_TYPE,
    metrics: metricIds.map((id) => ({ id, analyses })),
  });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("resolveInterleavingMetrics", () => {
  it("resolves a valid metric to its metric and fact table", async () => {
    const m = metric();
    setup([m]);

    const resolved = await resolve(["fact__goal"]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0].metric.id).toBe("fact__goal");
    expect(resolved[0].factTable.id).toBe("ft_cart");
    expect(resolved[0].config.analyses).toEqual([{ type: "preference" }]);
  });

  it("accepts mean and proportion metrics", async () => {
    for (const metricType of ["mean", "proportion"] as const) {
      setup([metric({ metricType })]);
      await expect(resolve(["fact__goal"])).resolves.toHaveLength(1);
    }
  });

  it("accepts a paired analysis when ranking_id is present", async () => {
    setup([metric()]);
    await expect(
      resolve(["fact__goal"], [{ type: "paired" }]),
    ).resolves.toHaveLength(1);
  });

  it("rejects a metric id that is not a fact metric", async () => {
    setup([]);
    await expect(resolve(["fact__goal"])).rejects.toThrow(
      "must be an existing fact metric",
    );
  });

  it("rejects a metric from another datasource", async () => {
    setup([metric({ datasource: "other-datasource" })]);
    await expect(resolve(["fact__goal"])).rejects.toThrow(
      "must belong to datasource test-datasource",
    );
  });

  it("rejects a metric whose fact table is missing", async () => {
    setup([metric()], []);
    await expect(resolve(["fact__goal"])).rejects.toThrow(
      "Fact table not found",
    );
  });

  it("rejects a fact table without the interleaving's identifier type", async () => {
    const table = tableWith(FULL_COLUMNS);
    table.userIdTypes = ["anonymous_id"];
    setup([metric()], [table]);
    await expect(resolve(["fact__goal"])).rejects.toThrow(
      "requires the 'user_id' identifier type",
    );
  });

  it("rejects a fact table with no item_id column", async () => {
    setup([metric()], [tableWith(["ranking_id", "value"])]);
    await expect(resolve(["fact__goal"])).rejects.toThrow(
      "requires an 'item_id' column",
    );
  });

  it("treats a deleted item_id column as absent", async () => {
    const table = tableWith(FULL_COLUMNS);
    table.columns = table.columns.map((c) =>
      c.column === "item_id" ? { ...c, deleted: true } : c,
    );
    setup([metric()], [table]);
    await expect(resolve(["fact__goal"])).rejects.toThrow(
      "requires an 'item_id' column",
    );
  });

  it("rejects a paired analysis when ranking_id is missing", async () => {
    setup([metric()], [tableWith(["item_id", "value"])]);
    await expect(resolve(["fact__goal"], [{ type: "paired" }])).rejects.toThrow(
      "needs an 'ranking_id' column",
    );
  });

  it("allows a preference analysis without ranking_id", async () => {
    setup([metric()], [tableWith(["item_id", "value"])]);
    await expect(resolve(["fact__goal"])).resolves.toHaveLength(1);
  });

  it("rejects metric types other than mean and proportion", async () => {
    setup([metric({ metricType: "ratio" })]);
    await expect(resolve(["fact__goal"])).rejects.toThrow(
      "must be mean or proportion metrics",
    );
  });

  it("rejects funnel metrics, which have no numerator", async () => {
    const m = metric();
    // @ts-expect-error exercising the runtime guard for a metric with no numerator
    m.numerator = null;
    setup([m]);
    await expect(resolve(["fact__goal"])).rejects.toThrow(
      "must read from a fact table",
    );
  });

  it("rejects $$distinctDates and sketch aggregations", async () => {
    const cases: Partial<FactMetricInterface["numerator"]>[] = [
      { column: "$$distinctDates" },
      { aggregation: "count distinct" },
      { aggregation: "hll merge" },
      { aggregation: "kll merge" },
    ];
    for (const numerator of cases) {
      setup([metric({ numerator } as Partial<FactMetricInterface>)]);
      await expect(resolve(["fact__goal"])).rejects.toThrow(
        "must use sum, max, or count aggregations",
      );
    }
  });

  it("rejects a metric with an aggregate filter", async () => {
    setup([
      metric({
        numerator: {
          factTableId: "ft_cart",
          column: "$$distinctUsers",
          aggregation: "sum",
          rowFilters: [],
          aggregateFilterColumn: "$$count",
          aggregateFilter: ">= 2",
        },
      } as Partial<FactMetricInterface>),
    ]);
    await expect(resolve(["fact__goal"])).rejects.toThrow(
      "cannot use a user filter yet",
    );
  });

  it("accepts $$distinctUsers when no aggregate filter is set", async () => {
    setup([
      metric({
        numerator: {
          factTableId: "ft_cart",
          column: "$$distinctUsers",
          aggregation: "sum",
          rowFilters: [],
        },
      } as Partial<FactMetricInterface>),
    ]);
    await expect(resolve(["fact__goal"])).resolves.toHaveLength(1);
  });

  it("reports only the first invalid metric", async () => {
    setup([
      metric({ id: "fact__a", metricType: "ratio" }),
      metric({ id: "fact__b", datasource: "other-datasource" }),
    ]);
    await expect(resolve(["fact__a", "fact__b"])).rejects.toThrow(
      "must be mean or proportion metrics",
    );
  });
});
