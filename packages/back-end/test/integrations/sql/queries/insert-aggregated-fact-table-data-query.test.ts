import {
  getInsertAggregatedFactTableDataQuery,
  DEFAULT_SALT_BUCKETS,
} from "back-end/src/integrations/sql/queries/insert-aggregated-fact-table-data-query";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { factTableFactory } from "../../../factories/FactTable.factory";
import { factMetricFactory } from "../../../factories/FactMetric.factory";

describe("getInsertAggregatedFactTableDataQuery", () => {
  const factTable = factTableFactory.build({
    id: "ft_target",
    userIdTypes: ["user_id"],
  });
  const sumMetric = factMetricFactory.build({
    id: "fact_sum",
    metricType: "mean",
    numerator: {
      factTableId: "ft_target",
      column: "value",
      aggregation: "sum",
    },
  });
  const countMetric = factMetricFactory.build({
    id: "fact_count",
    metricType: "mean",
    numerator: {
      factTableId: "ft_target",
      column: "$$count",
      aggregation: "sum",
    },
  });
  const baseParams = {
    factTable,
    idType: "user_id",
    metrics: [sumMetric, countMetric],
    tableFullName: "`proj.dataset.gb_aggregated_ft_target_user_id`",
    windowStartDate: new Date("2024-01-01T00:00:00Z"),
    exclusiveStart: false,
  };

  it("emits a salted two-level GROUP BY on BigQuery with the default 8 buckets", () => {
    expect(DEFAULT_SALT_BUCKETS).toBe(8);
    const sql = getInsertAggregatedFactTableDataQuery(
      bigQueryDialect,
      baseParams,
    );
    // Level-1 partial CTE with the salt column.
    expect(sql).toContain("__dailyValuesPartial");
    expect(sql).toContain("__salt");
    expect(sql).toMatch(/FARM_FINGERPRINT/i);
    expect(sql).toMatch(/,\s*8\s*\)\s+AS\s+__salt/i);
    // Level-2 merge CTE collapses salt back to (idType, event_date).
    expect(sql).toMatch(/FROM\s+__dailyValuesPartial\s+GROUP BY/i);
    // $$count partial is COUNT(); its salt-merge must be SUM, not COUNT.
    expect(sql).toMatch(/SUM\(\s*COALESCE\(\s*fact_count_value/i);
    // __factTable referenced exactly once (no double-scan for max_timestamp).
    expect(sql.match(/FROM\s+__factTable\b/gi)?.length).toBe(1);
    expect(sql).not.toContain("__maxTimestamp");
    expect(sql).toMatch(/MAX\(dv\.slice_max_timestamp\)\s+OVER\s*\(\)/i);
  });

  it("threads params.saltBuckets into the MOD divisor", () => {
    const sql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      ...baseParams,
      saltBuckets: 16,
    });
    expect(sql).toMatch(/,\s*16\s*\)\s+AS\s+__salt/i);
    expect(sql).not.toMatch(/,\s*8\s*\)\s+AS\s+__salt/i);
  });

  it("falls back to a single-level GROUP BY when the dialect has no intHash", () => {
    expect(postgresDialect.intHash).toBeUndefined();
    const sql = getInsertAggregatedFactTableDataQuery(
      postgresDialect,
      baseParams,
    );
    expect(sql).not.toContain("__dailyValuesPartial");
    expect(sql).not.toContain("__salt");
    expect(sql).toContain("__dailyValues");
    // Double-scan fix still applies to the fallback path.
    expect(sql.match(/FROM\s+__factTable\b/gi)?.length).toBe(1);
    expect(sql).not.toContain("__maxTimestamp");
  });
});

describe("getAggregationMetadata.mergePartialsFunction", () => {
  // Every aggregation kind must round-trip a partial through mergePartials and
  // land in the same intermediate state, so the persisted (idType, event_date)
  // row is identical to the un-salted single-level output. Spot-check the
  // non-idempotent ones.
  it("merges $$count partials with SUM (COUNT -> SUM)", () => {
    const m = factMetricFactory.build({
      numerator: { factTableId: "ft", column: "$$count", aggregation: "sum" },
    });
    const meta = getAggregationMetadata(bigQueryDialect, {
      metric: m,
      useDenominator: false,
    });
    expect(meta.partialAggregationFunction("x")).toMatch(/^COUNT\(/i);
    expect(meta.mergePartialsFunction("x")).toMatch(/^SUM\(/i);
  });

  it("merges count-distinct partials with the HLL merge primitive", () => {
    const m = factMetricFactory.build({
      numerator: {
        factTableId: "ft",
        column: "value",
        aggregation: "count distinct",
      },
    });
    const meta = getAggregationMetadata(bigQueryDialect, {
      metric: m,
      useDenominator: false,
    });
    expect(meta.partialAggregationFunction("x")).toMatch(/HLL_COUNT\.INIT/i);
    expect(meta.mergePartialsFunction("x")).toMatch(
      /HLL_COUNT\.MERGE_PARTIAL/i,
    );
    // Merge stays a sketch (intermediateDataType), not a finalized cardinality.
    expect(meta.mergePartialsFunction("x")).not.toMatch(/HLL_COUNT\.EXTRACT/i);
  });
});
