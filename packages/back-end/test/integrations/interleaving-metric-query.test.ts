import fs from "fs";
import path from "path";
import { postgresDialect } from "shared/dialects";
import type { InterleavingAnalysis } from "shared/validators";
import { getInterleavingMetricQuery } from "back-end/src/integrations/sql/queries/interleaving-metric-query";

// The demo storefront's telemetry schema (local-groceries-international):
// one row per impression, item detail in the nested `items` JSON column
// (GrowthBook's generated SQL does the unnesting)
const EXPOSURE_QUERY = `SELECT
  user_id,
  received_at as timestamp,
  properties->>'experimentId' as experiment_id,
  properties->>'interleaveId' as interleave_id,
  properties->'items' as items
FROM events
WHERE event_name = 'Interleave Exposure'`;

const FACT_TABLE_SQL = `SELECT
  user_id,
  received_at as timestamp,
  properties->>'item_id' as item_id,
  properties->>'interleave_id' as interleave_id,
  (properties->>'value')::float as value
FROM events
WHERE event_name = 'Add to Cart'`;

const baseParams = {
  exposureQuery: EXPOSURE_QUERY,
  userIdType: "user_id",
  trackingKey: "featured-products-ranker",
  variationKeys: ["buyers-picks", "price-low"] as [string, string],
  startDate: new Date("2020-01-01"),
  endDate: null,
  factTableSql: FACT_TABLE_SQL,
  signals: [],
};
const PAIRED: InterleavingAnalysis = { type: "paired" };
const OWNERSHIP: InterleavingAnalysis = {
  type: "ownership",
  attribution: "exposureCount",
};
const proportionMetric = (analysis: InterleavingAnalysis) => ({
  analysis,
  metricType: "proportion" as const,
  valueColumn: null,
});

describe("getInterleavingMetricQuery", () => {
  it("generates paired and ownership SQL and (optionally) writes them for live execution", () => {
    const paired = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [proportionMetric(PAIRED)],
    });
    const ownership = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [proportionMetric(OWNERSHIP)],
    });
    const both = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [proportionMetric(PAIRED), proportionMetric(OWNERSHIP)],
    });

    // Structural assertions on both variants
    // Paired-only: no ownership CTEs; ownership-only: no paired CTEs
    expect(paired).toContain("__exposures");
    expect(paired).toContain("jsonb_array_elements");
    expect(paired).toContain("__credited");
    expect(paired).toContain("m0_sum_xy");
    expect(paired).not.toContain("users_pref_treatment");
    expect(paired).toContain("'featured-products-ranker'");
    expect(ownership).toContain("m0_users_pref_treatment");
    expect(ownership).not.toContain("__credited");
    // Mixed: both logics in one query, single events scan
    expect(both).toContain("m0_sum_xy");
    expect(both).toContain("m1_users_pref_treatment");
    expect(both).toContain("__eventsAll");

    // Escapes quotes in variation names
    const quoted = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [proportionMetric(OWNERSHIP)],
      variationKeys: ["o'brien", "control"] as [string, string],
    });
    expect(quoted).toContain("'o''brien'");
  });

  it("generates one signal share CTE per distinct engagement signal", () => {
    const byClick: InterleavingAnalysis = {
      type: "ownership",
      attribution: "engagementSignal",
      signalMetricId: "fact__click",
    };
    const byCart: InterleavingAnalysis = {
      type: "ownership",
      attribution: "engagementSignal",
      signalMetricId: "fact__cart",
    };
    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      // Same signal twice (shared CTE) plus a second signal
      metrics: [
        proportionMetric(byClick),
        proportionMetric(byClick),
        proportionMetric(byCart),
        proportionMetric(OWNERSHIP),
      ],
      signals: [
        { id: "fact__click", factTableSql: "SELECT 1 AS click" },
        { id: "fact__cart", factTableSql: "SELECT 2 AS cart" },
      ],
    });
    expect(sql).toContain("__signalShare_0");
    expect(sql).toContain("__signalShare_1");
    expect(sql).not.toContain("__signalShare_2");
    expect(sql).toMatch(/SELECT\s+1 AS click/);
    expect(sql).toMatch(/SELECT\s+2 AS cart/);
    // Signal joins need interleave_id on exposures even without paired
    expect(sql).toContain("e.interleave_id AS interleave_id");
    expect(sql).not.toContain("__credited");
    expect(sql).toContain("ea.value_1 * ss_0.share_t, 0)) AS wins_t_1");
    expect(sql).toContain("ea.value_2 * ss_1.share_t, 0)) AS wins_t_2");
    expect(sql).toContain("ea.value_3 * ui.share_t, 0)) AS wins_t_3");
    expect(sql).toContain("m3_users_pref_treatment");

    expect(() =>
      getInterleavingMetricQuery(postgresDialect, {
        ...baseParams,
        metrics: [proportionMetric(byClick)],
      }),
    ).toThrow("Missing fact table SQL for signal metric fact__click");

    // Optionally dump to disk so the SQL can be executed against the demo
    // telemetry database (set INTERLEAVING_SQL_OUT to a directory)
    const outDir = process.env.INTERLEAVING_SQL_OUT;
    if (outDir) {
      fs.writeFileSync(path.join(outDir, "paired.sql"), paired);
      fs.writeFileSync(path.join(outDir, "ownership.sql"), ownership);
      fs.writeFileSync(path.join(outDir, "both.sql"), both);
    }
  });
});
