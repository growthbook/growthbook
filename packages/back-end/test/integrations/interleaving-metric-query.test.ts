import { postgresDialect } from "shared/dialects";
import type { InterleavingAnalysis } from "shared/validators";
import type { FactMetricInterface } from "shared/types/fact-table";
import { getInterleavingMetricQuery } from "back-end/src/integrations/sql/queries/interleaving-metric-query";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { factTableFactory } from "back-end/test/factories/FactTable.factory";

// One row per impression, item detail in the nested `items` JSON column
// (GrowthBook's generated SQL does the unnesting)
const EXPOSURE_QUERY = `SELECT
  user_id,
  received_at as timestamp,
  properties->>'experimentId' as experiment_id,
  properties->>'rankingId' as ranking_id,
  properties->'items' as items
FROM events
WHERE event_name = 'Interleave Exposure'`;

const cartTable = factTableFactory.build({
  id: "ft_cart",
  sql: "SELECT user_id, timestamp, item_id, ranking_id, value, event_name FROM events",
  columns: [
    {
      column: "event_name",
      datatype: "string",
      name: "",
      description: "",
      numberFormat: "",
      deleted: false,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      alwaysInlineFilter: false,
    },
  ],
});
const metricOn = (
  factTableId: string,
  overrides: Partial<FactMetricInterface["numerator"]> & {
    metricType?: FactMetricInterface["metricType"];
  } = {},
) => {
  const { metricType, ...numerator } = overrides;
  return factMetricFactory.build({
    metricType: metricType ?? "proportion",
    numerator: { factTableId, column: "$$count", ...numerator },
  });
};

const baseParams = {
  exposureQuery: EXPOSURE_QUERY,
  userIdType: "user_id",
  trackingKey: "featured-products-ranker",
  variationKeys: ["buyers-picks", "price-low"] as [string, string],
  startDate: new Date("2020-01-01"),
  endDate: null,
  factTable: cartTable,
};
const PAIRED: InterleavingAnalysis = { type: "paired" };
const OWNERSHIP: InterleavingAnalysis = {
  type: "ownership",
  attribution: "exposureCount",
};
const proportion = metricOn("ft_cart");

describe("getInterleavingMetricQuery", () => {
  it("emits paired and ownership CTEs only when requested", () => {
    const paired = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [{ metric: proportion, analyses: [PAIRED] }],
    });
    const ownership = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [{ metric: proportion, analyses: [OWNERSHIP] }],
    });
    const both = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [{ metric: proportion, analyses: [PAIRED, OWNERSHIP] }],
    });

    expect(paired).toContain("__exposures");
    expect(paired).toContain("jsonb_array_elements");
    expect(paired).toContain("__credited");
    expect(paired).toContain("__pairedUser");
    expect(paired).toContain("m0_sum_xy");
    expect(paired).not.toContain("users_pref_treatment");
    expect(paired).not.toContain("__share");
    expect(paired).toContain("'featured-products-ranker'");
    expect(ownership).toContain("__share");
    expect(ownership).toContain("m0_users_pref_treatment");
    expect(ownership).toMatch(
      /WHEN ou\.wins_t_0 = ou\.wins_c_0 THEN 1\s+ELSE 0\s+END\s*\)\s*\) AS m0_users_tied/,
    );
    expect(ownership).not.toContain("__credited");
    // Ownership alone reads __events at item grain directly
    expect(ownership).not.toContain("__itemEvents");
    expect(ownership).toContain("ev.value_0 * s.share_t, 0)) AS wins_t_0");
    expect(ownership).toMatch(/GROUP BY\s+m\.user_id,\s+m\.item_id/);
    // Mixed: both chains off one events scan, rolled up for ownership; one
    // value column feeds both analyses under the same m0_ prefix
    expect(both).toContain("m0_sum_xy");
    expect(both).toContain("m0_users_pref_treatment");
    expect(both).not.toContain("value_1");
    expect(both).toContain("__itemEvents");
    expect(both).toMatch(
      /GROUP BY\s+m\.user_id,\s+m\.ranking_id,\s+m\.item_id/,
    );
    expect(both).toContain("LEFT JOIN __pairedUser pu");
    expect(both).toContain("LEFT JOIN __ownerUser ou");

    // Exposures collapse to one row per (user, ranking, item) by grouping,
    // with both team arms explicit so an unknown variation is NULL, not 0
    expect(paired).toMatch(
      /GROUP BY\s+e\.user_id,\s+e\.ranking_id,\s+item ->> 'itemId'/,
    );
    expect(paired).toMatch(
      /MAX\(\s*CASE\s+WHEN item ->> 'variation' = 'price-low' THEN 1\s+WHEN item ->> 'variation' = 'buyers-picks' THEN 0\s+END\s*\) AS team/,
    );
    expect(paired).not.toContain("ROW_NUMBER");

    // Paired gates on engaged impressions with plain aggregates, no window
    expect(paired).toMatch(
      /SUM\(c\.team \* c\.value_0\) AS x_0,\s+SUM\(\(1 - c\.team\) \* c\.value_0\) AS y_0,\s+SUM\(c\.team\) AS n_0/,
    );
    expect(paired).toMatch(/WHEN im\.x_0 \+ im\.y_0 > 0 THEN im\.n_0/);
    expect(paired).not.toContain("OVER (");

    // Variation keys are escaped through the dialect
    const quoted = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [{ metric: proportion, analyses: [OWNERSHIP] }],
      variationKeys: ["o'brien", "control"] as [string, string],
    });
    expect(quoted).toContain("'o''brien'");
  });

  it("resolves numerators like experiment fact metrics", () => {
    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [
        // proportion: existence per group
        { metric: proportion, analyses: [PAIRED] },
        // mean of a row count: COUNT, not existence
        {
          metric: metricOn("ft_cart", { metricType: "mean" }),
          analyses: [PAIRED],
        },
        // mean of a column, with a row filter
        {
          analyses: [OWNERSHIP],
          metric: metricOn("ft_cart", {
            metricType: "mean",
            column: "value",
            rowFilters: [
              { column: "event_name", operator: "=", values: ["purchase"] },
            ],
          }),
        },
      ],
    });
    expect(sql).toMatch(/COALESCE\(MAX\(1\), 0\) AS value_0/);
    expect(sql).toMatch(/COUNT\(1\) AS value_1/);
    expect(sql).toMatch(
      /SUM\(\s*COALESCE\(\s*CASE\s+WHEN \(\(event_name = 'purchase'\)\) THEN m\.value\s+ELSE NULL\s+END,\s*0\s*\)\s*\) AS value_2/,
    );
    // Rows matching no metric's filters are dropped; metric 0/1 have none, so
    // nothing can be filtered from the events scan
    expect(sql).toMatch(
      /WHERE\s+m\.timestamp >= '2020-01-01 00:00:00'\s+GROUP BY/,
    );
    // Rolled up to user x item for ownership with the re-aggregation function
    expect(sql).toMatch(/SUM\(COALESCE\(ev\.value_2, 0\)\) AS value_2/);
  });
});
