import { getInsertAggregatedFactTableDataQuery } from "back-end/src/integrations/sql/queries/insert-aggregated-fact-table-data-query";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
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

  it("emits a single-level GROUP BY with a single source scan", () => {
    const sql = getInsertAggregatedFactTableDataQuery(
      bigQueryDialect,
      baseParams,
    );
    // Single statement, single-level GROUP BY, no temp-table barrier.
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
});
