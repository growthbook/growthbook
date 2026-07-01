import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import {
  getAggregatedFactTableStagingColumns,
  getInsertAggregatedFactTableStagingDataQuery,
} from "back-end/src/integrations/sql/queries/aggregated-fact-table-staging-query";
import { getInsertAggregatedFactTableDataQuery } from "back-end/src/integrations/sql/queries/insert-aggregated-fact-table-data-query";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { factTableFactory } from "./factories/FactTable.factory";
import { factMetricFactory } from "./factories/FactMetric.factory";

const FT_ID = "ft_test";
const factTable = factTableFactory.build({
  id: FT_ID,
  userIdTypes: ["id_a", "id_b", "id_c"],
  sql: "SELECT id_a, id_b, id_c, timestamp, amount, cnt FROM events",
});
const meanMetric = factMetricFactory.build({
  id: "fm_1",
  metricType: "mean",
  numerator: { factTableId: FT_ID, column: "amount", aggregation: "sum" },
});
const ratioMetric = factMetricFactory.build({
  id: "fm_2",
  metricType: "ratio",
  numerator: { factTableId: FT_ID, column: "amount", aggregation: "sum" },
  denominator: { factTableId: FT_ID, column: "cnt", aggregation: "sum" },
});
const startDate = new Date("2024-01-01");
const endDate = new Date("2024-02-01");

describe("getFactMetricCTE with projectIdTypes", () => {
  it("projects every listed idType column instead of only baseIdType", () => {
    const cte = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [{ metric: meanMetric, index: 0 }],
      factTable,
      baseIdType: "id_a",
      idJoinMap: {},
      startDate,
      endDate,
      projectIdTypes: ["id_a", "id_b", "id_c"],
      castIdToString: true,
    });
    expect(cte).toContain("as id_a");
    expect(cte).toContain("as id_b");
    expect(cte).toContain("as id_c");
    // Still projects the metric value column and wraps the fact-table SQL.
    expect(cte).toContain("m0_value");
    expect(cte).toMatch(/FROM\s+events/);
  });

  it("throws when a projected idType is not native to the fact table", () => {
    expect(() =>
      getFactMetricCTE(bigQueryDialect, {
        metricsWithIndices: [{ metric: meanMetric, index: 0 }],
        factTable,
        baseIdType: "id_a",
        idJoinMap: {},
        startDate,
        endDate,
        projectIdTypes: ["id_a", "not_an_id_type"],
      }),
    ).toThrow(/is not native to fact table/);
  });

  it("is unchanged from single-id projection when projectIdTypes is unset", () => {
    const cte = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [{ metric: meanMetric, index: 0 }],
      factTable,
      baseIdType: "id_a",
      idJoinMap: {},
      startDate,
      endDate,
    });
    expect(cte).toContain("as id_a");
    expect(cte).not.toContain("as id_b");
  });
});

describe("getAggregatedFactTableStagingColumns", () => {
  it("emits idTypes + timestamp + per-metric value/denominator cols in stable order", () => {
    // Ratio metric sorts before mean (fm_2 > fm_1 lexically, so mean is index 0).
    const cols = getAggregatedFactTableStagingColumns({
      idTypes: ["id_a", "id_b"],
      metrics: [ratioMetric, meanMetric],
      factTableId: FT_ID,
    });
    expect(cols).toEqual([
      "id_a",
      "id_b",
      "timestamp",
      "m0_value",
      "m1_value",
      "m1_denominator",
    ]);
  });
});

describe("getInsertAggregatedFactTableStagingDataQuery", () => {
  it("wraps the fact-table SQL once with all idType columns projected", () => {
    const sql = getInsertAggregatedFactTableStagingDataQuery(bigQueryDialect, {
      stagingTableFullName: "proj.ds.gb_agg_staging_ft_test_aftshared_1",
      factTable,
      idTypes: ["id_a", "id_b", "id_c"],
      metrics: [meanMetric],
      windowStartDate: startDate,
      windowEndDate: endDate,
    });
    expect(sql).toMatch(
      /INSERT INTO\s+proj\.ds\.gb_agg_staging_ft_test_aftshared_1/,
    );
    expect(sql).toContain("id_a");
    expect(sql).toContain("id_b");
    expect(sql).toContain("id_c");
    // The one and only source scan.
    expect(sql).toMatch(/FROM\s+events/);
  });
});

describe("getInsertAggregatedFactTableDataQuery with sourceTableFullName", () => {
  const stagingTable = "proj.ds.gb_agg_staging_ft_test_aftshared_1";

  it("reads the projected columns from the staging table instead of wrapping the fact-table SQL", () => {
    const sql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      factTable,
      idType: "id_b",
      metrics: [meanMetric, ratioMetric],
      tableFullName: "proj.ds.gb_aggregated_ft_test_id_b",
      windowStartDate: startDate,
      windowEndDate: null,
      exclusiveStart: false,
      sourceTableFullName: stagingTable,
    });
    // Reads staging, not the raw source.
    expect(sql).toContain(stagingTable);
    expect(sql).not.toMatch(/FROM\s+events/);
    // Projects only this idType from staging.
    expect(sql).toContain("id_b");
    expect(sql).not.toMatch(/SELECT[^(]*\bid_a\b/);
    // Downstream GROUP BY / aggregation shape unchanged.
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("m0_value");
  });

  it("still wraps the fact-table SQL when sourceTableFullName is unset", () => {
    const sql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      factTable,
      idType: "id_b",
      metrics: [meanMetric],
      tableFullName: "proj.ds.gb_aggregated_ft_test_id_b",
      windowStartDate: startDate,
      windowEndDate: null,
      exclusiveStart: false,
    });
    expect(sql).toMatch(/FROM\s+events/);
    expect(sql).not.toContain(stagingTable);
  });

  it("reuses the metric column alignment (index by sorted metric id) between staging build and read", () => {
    const stagingCols = getAggregatedFactTableStagingColumns({
      idTypes: ["id_a", "id_b"],
      metrics: [ratioMetric, meanMetric],
      factTableId: FT_ID,
    });
    const readSql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      factTable,
      idType: "id_a",
      metrics: [ratioMetric, meanMetric],
      tableFullName: "proj.ds.gb_aggregated_ft_test_id_a",
      windowStartDate: startDate,
      windowEndDate: null,
      exclusiveStart: false,
      sourceTableFullName: stagingTable,
    });
    // Every m{i}_* column the read projects must exist in the staging schema.
    for (const col of stagingCols) {
      if (col.startsWith("m")) {
        expect(readSql).toContain(col);
      }
    }
  });
});
