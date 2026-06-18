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
    windowEndDate: null,
    exclusiveStart: false,
  };

  it("emits a single-level GROUP BY by default (saltBuckets = 0, salt off)", () => {
    expect(DEFAULT_SALT_BUCKETS).toBe(0);
    const sql = getInsertAggregatedFactTableDataQuery(
      bigQueryDialect,
      baseParams,
    );
    // No salt layer, no temp-table barrier, single statement.
    expect(sql).not.toContain("__salt");
    expect(sql).not.toContain("__dailyValuesPartial");
    expect(sql).not.toMatch(/CREATE\s+TEMP\s+TABLE/i);
    expect(sql).toContain("__dailyValues");
    // Single source scan: watermark carried as per-group MAX then lifted via
    // window — no separate __maxTimestamp CTE.
    expect(sql.match(/FROM\s+__factTable\b/gi)?.length).toBe(1);
    expect(sql).toMatch(/MAX\(timestamp\)\s+AS\s+__max_ts/i);
    expect(sql).toMatch(/MAX\(dv\.__max_ts\)\s+OVER\s*\(\)/i);
    expect(sql).not.toContain("__maxTimestamp");
    // Null-id filter retained.
    expect(sql).toMatch(/WHERE\s+user_id\s+IS\s+NOT\s+NULL/i);
  });

  it("threads windowEndDate as an exclusive upper bound on the source scan", () => {
    const sql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      ...baseParams,
      windowEndDate: new Date("2024-01-03T00:00:00Z"),
    });
    // Half-open chunk: timestamp >= start AND timestamp < end.
    expect(sql).toMatch(/m\.timestamp\s*>=/);
    expect(sql).toMatch(/m\.timestamp\s*</);
    expect(sql).toContain("2024-01-03");
    // Open-ended chunk: no upper bound.
    const open = getInsertAggregatedFactTableDataQuery(
      bigQueryDialect,
      baseParams,
    );
    expect(open).not.toMatch(/m\.timestamp\s*</);
  });

  it("emits a two-level CTE GROUP BY when saltBuckets > 0 on a dialect with intHash", () => {
    const sql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      ...baseParams,
      saltBuckets: 8,
    });
    // Single statement (no temp-table barrier — date-chunking keeps each chunk
    // small enough that optimizer fold is immaterial).
    expect(sql).not.toMatch(/CREATE\s+TEMP\s+TABLE/i);
    expect(sql.split(";").filter((s) => s.trim().length > 0).length).toBe(1);
    // Level-1 partial keyed on (idType, event_date, __salt).
    expect(sql).toContain("__dailyValuesPartial");
    expect(sql).toMatch(/FARM_FINGERPRINT/i);
    expect(sql).toMatch(/,\s*8\s*\)\s+AS\s+__salt/i);
    expect(sql).toMatch(/GROUP BY\s+1,\s*2,\s*3/i);
    // Level-2 merge collapses salt back to (idType, event_date).
    expect(sql).toMatch(/FROM\s+__dailyValuesPartial\s+GROUP BY\s+1,\s*2/i);
    // $$count partial is COUNT(); its salt-merge must be SUM, not COUNT.
    expect(sql).toMatch(/SUM\(\s*COALESCE\(\s*fact_count_value/i);
  });

  it("ignores saltBuckets on a dialect without intHash", () => {
    expect(postgresDialect.intHash).toBeUndefined();
    const sql = getInsertAggregatedFactTableDataQuery(postgresDialect, {
      ...baseParams,
      saltBuckets: 8,
    });
    expect(sql).not.toContain("__dailyValuesPartial");
    expect(sql).not.toContain("__salt");
    expect(sql).toContain("__dailyValues");
    expect(sql.match(/FROM\s+__factTable\b/gi)?.length).toBe(1);
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
