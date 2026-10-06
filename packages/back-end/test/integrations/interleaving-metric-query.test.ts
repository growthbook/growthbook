import fs from "fs";
import path from "path";
import { postgresDialect } from "shared/dialects";
import type { AttributionType } from "shared/validators";
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
  variationNames: ["buyers-picks", "price-low"] as [string, string],
  startDate: new Date("2020-01-01"),
  endDate: null,
  factTableSql: FACT_TABLE_SQL,
};
const proportionMetric = (attributionType: AttributionType) => ({
  attributionType,
  metricType: "proportion" as const,
  valueColumn: null,
});

describe("getInterleavingMetricQuery", () => {
  it("generates paired and ownership SQL and (optionally) writes them for live execution", () => {
    const paired = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [proportionMetric("paired")],
    });
    const ownership = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [proportionMetric("ownershipByExposureCount")],
    });
    const both = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [
        proportionMetric("paired"),
        proportionMetric("ownershipByExposureCount"),
      ],
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
      metrics: [proportionMetric("ownershipByExposureCount")],
      variationNames: ["o'brien", "control"] as [string, string],
    });
    expect(quoted).toContain("'o''brien'");

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
