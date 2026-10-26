import {
  athenaDialect,
  bigQueryDialect,
  clickHouseDialect,
  databricksDialect,
  mssqlDialect,
  mysqlDialect,
  postgresDialect,
  prestoDialect,
  redshiftDialect,
  snowflakeDialect,
} from "shared/dialects";
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
    id: `fact__${metricType ?? "proportion"}_${numerator.column ?? "count"}`,
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
const PREFERENCE: InterleavingAnalysis = {
  type: "preference",
  attribution: "exposureCount",
};
const proportion = metricOn("ft_cart");

describe("getInterleavingMetricQuery", () => {
  it("emits paired and preference CTEs only when requested", () => {
    const paired = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [{ metric: proportion, analyses: [PAIRED] }],
    });
    const preference = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [{ metric: proportion, analyses: [PREFERENCE] }],
    });
    const both = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [{ metric: proportion, analyses: [PAIRED, PREFERENCE] }],
    });

    expect(paired).toContain("__exposures");
    expect(paired).toContain("jsonb_array_elements");
    expect(paired).toContain("__credited");
    expect(paired).toContain("__pairedUser");
    expect(paired).toContain(
      "fact__proportion_count_treatment_control_sum_product",
    );
    expect(paired).not.toContain("users_pref_treatment");
    expect(paired).not.toContain("__share");
    expect(paired).not.toContain("first_exposure_timestamp");
    expect(paired).toContain("'featured-products-ranker'");
    expect(preference).toContain("__share");
    expect(preference).toContain("fact__proportion_count_users_pref_treatment");
    expect(preference).toMatch(
      /WHEN pref\.wins_t_0 = pref\.wins_c_0 THEN 1\s+ELSE 0\s+END\s*\)\s*\) AS fact__proportion_count_users_tied/,
    );
    expect(preference).not.toContain("__credited");
    // Preference has its own post-exposure event aggregation at item grain
    expect(preference).not.toContain("__itemEvents");
    expect(preference).toContain("__preferenceEvents");
    expect(preference).toContain("ev.value_0 * s.share_t, 0)) AS wins_t_0");
    expect(preference).toContain(
      "MIN(e.exposure_timestamp) AS first_exposure_timestamp",
    );
    expect(preference).toMatch(
      /INNER JOIN __share s ON \(\s*s\.user_id = m\.user_id\s+AND s\.item_id = cast\(m\.item_id as varchar\)\s*\)/,
    );
    expect(preference).toContain("m.timestamp >= s.first_exposure_timestamp");
    expect(preference).toMatch(
      /GROUP BY\s+m\.user_id,\s+cast\(m\.item_id as varchar\)/,
    );
    // Mixed: both chains aggregate one filtered event-row source at their own
    // grains; output columns are keyed by metric id
    expect(both).toContain(
      "fact__proportion_count_treatment_control_sum_product",
    );
    expect(both).toContain("fact__proportion_count_users_pref_treatment");
    expect(both).not.toContain("value_1");
    expect(both).toContain("__eventRows");
    expect(both).toContain("__preferenceEvents");
    expect(both).not.toContain("__itemEvents");
    const cteBefore = (sql: string, name: string, nextName: string) =>
      sql
        .slice(sql.indexOf(`${name} AS`), sql.indexOf(`${nextName} AS`))
        .trim()
        .replace(/,$/, "");
    expect(cteBefore(both, "__events", "__preferenceEvents")).toBe(
      cteBefore(paired, "__events", "__credited"),
    );
    expect(both).toMatch(
      /GROUP BY\s+m\.user_id,\s+cast\(m\.ranking_id as varchar\),\s+cast\(m\.item_id as varchar\)/,
    );
    expect(both).toContain("LEFT JOIN __pairedUser pu");
    expect(both).toContain("LEFT JOIN __preferenceUser pref");

    // Exposures collapse to one row per (user, ranking, item) by grouping,
    // with both team arms explicit so an unknown variation is NULL, not 0
    expect(paired).toMatch(
      /GROUP BY\s+e\.user_id,\s+cast\(e\.ranking_id as varchar\),\s+cast\(item ->> 'itemId' as varchar\)/,
    );
    expect(paired).toMatch(
      /MAX\(\s*CASE\s+WHEN item ->> 'variation' = 'price-low' THEN 1\s+WHEN item ->> 'variation' = 'buyers-picks' THEN 0\s+END\s*\) AS team/,
    );
    expect(paired).not.toContain("ROW_NUMBER");

    // Paired gates on engaged impressions with plain aggregates, no window
    expect(paired).toMatch(
      /SUM\(c\.team \* c\.value_0\) AS treatment_0,\s+SUM\(\(1 - c\.team\) \* c\.value_0\) AS control_0,\s+SUM\(c\.team\) AS exposures_0/,
    );
    expect(paired).toMatch(
      /WHEN im\.treatment_0 \+ im\.control_0 > 0 THEN im\.exposures_0/,
    );
    expect(paired).not.toContain("OVER (");

    // Variation keys are escaped through the dialect
    const quoted = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [{ metric: proportion, analyses: [PREFERENCE] }],
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
          analyses: [PREFERENCE],
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
    // the shared event-row source only has the date filter.
    expect(sql).toMatch(
      /__eventRows AS \([\s\S]*WHERE\s+m\.timestamp >= '2020-01-01 00:00:00'\s*\)/,
    );
    expect(sql).toMatch(
      /__preferenceEvents AS \([\s\S]*m\.timestamp >= s\.first_exposure_timestamp[\s\S]*GROUP BY\s+m\.user_id,\s+cast\(m\.item_id as varchar\)/,
    );
  });

  // The exposure side comes from fieldText (always text) and the events side
  // from the warehouse column, so both are normalised before they can meet in
  // a join.
  it("casts item_id and ranking_id to string on both sides of the join", () => {
    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: [{ metric: proportion, analyses: [PAIRED, PREFERENCE] }],
    });

    expect(sql).toContain("cast(item ->> 'itemId' as varchar) AS item_id");
    expect(sql).toContain("cast(e.ranking_id as varchar) AS ranking_id");
    expect(sql).toContain("cast(m.item_id as varchar) AS item_id");
    expect(sql).toContain("cast(m.ranking_id as varchar) AS ranking_id");

    // Projected and grouped by the same expression, or the GROUP BY would not
    // cover the SELECT
    expect(sql).toMatch(
      /GROUP BY\s+e\.user_id,\s+cast\(e\.ranking_id as varchar\),\s+cast\(item ->> 'itemId' as varchar\)/,
    );
    expect(sql).toMatch(
      /GROUP BY\s+m\.user_id,\s+cast\(m\.ranking_id as varchar\),\s+cast\(m\.item_id as varchar\)/,
    );

    // Joins read the already-cast CTE columns, so they stay equi-joins
    expect(sql).toContain("ev.item_id = e.item_id");
    expect(sql).toContain("ev.ranking_id = e.ranking_id");
    expect(sql).toContain("ev.item_id = s.item_id");
  });

  it("resolves a virtual item_id through getColumnExpression", () => {
    const virtualTable = factTableFactory.build({
      id: "ft_virtual",
      sql: "SELECT user_id, timestamp, sku, ranking_id, value FROM events",
      columns: [
        {
          column: "item_id",
          datatype: "string",
          name: "",
          description: "",
          numberFormat: "",
          deleted: false,
          dateCreated: new Date(),
          dateUpdated: new Date(),
          alwaysInlineFilter: false,
          isVirtual: true,
          sql: "CONCAT('sku-', sku)",
        },
      ],
    });

    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      factTable: virtualTable,
      metrics: [{ metric: metricOn("ft_virtual"), analyses: [PREFERENCE] }],
    });

    expect(sql).toContain("sku");
    expect(sql).not.toMatch(/cast\(m\.item_id as varchar\)/);
  });
});

describe("getInterleavingMetricQuery dialects", () => {
  const metrics = [{ metric: proportion, analyses: [PAIRED, PREFERENCE] }];
  const unnestFragment: [string, typeof postgresDialect, string][] = [
    ["postgres", postgresDialect, "jsonb_array_elements((e.items)::jsonb)"],
    ["bigquery", bigQueryDialect, "UNNEST(JSON_QUERY_ARRAY(e.items))"],
    [
      "snowflake",
      snowflakeDialect,
      "FLATTEN(INPUT => PARSE_JSON(e.items::string))",
    ],
    [
      "databricks",
      databricksDialect,
      "explode(from_json(CAST(e.items AS STRING), 'array<string>'))",
    ],
    [
      "clickhouse",
      clickHouseDialect,
      "ARRAY JOIN JSONExtractArrayRaw(toString(e.items))",
    ],
    [
      "mysql",
      mysqlDialect,
      "JSON_TABLE(e.items, '$[*]' COLUMNS (item JSON PATH '$'))",
    ],
    ["mssql", mssqlDialect, "CROSS APPLY OPENJSON(e.items)"],
    [
      "athena",
      athenaDialect,
      "UNNEST(CAST(json_parse(CAST(e.items AS VARCHAR)) AS ARRAY(JSON)))",
    ],
    [
      "presto",
      prestoDialect,
      "UNNEST(CAST(json_parse(CAST(e.items AS VARCHAR)) AS ARRAY(JSON)))",
    ],
  ];

  it.each(unnestFragment)("builds for %s", (_name, dialect, fragment) => {
    const sql = getInterleavingMetricQuery(dialect, { ...baseParams, metrics });
    const squashed = sql.replace(/\s+/g, " ");
    // The formatter inserts spaces around parens, so compare without them
    expect(sql.replace(/\s+/g, "")).toContain(fragment.replace(/\s+/g, ""));
    // The competitive filter and item grouping go through fieldText
    expect(squashed).toContain("= 'true'");
    expect(squashed).toContain("AS item_id");
    expect(squashed).toContain("fact__proportion_count_treatment_sum");
    expect(squashed).toContain("fact__proportion_count_users_tied");
    // Equi-join only; the timestamp test is in the credited value
    expect(squashed).not.toMatch(/ON \([^)]*>=/);
  });

  it("rejects dialects without JSON array support", () => {
    expect(() =>
      getInterleavingMetricQuery(redshiftDialect, { ...baseParams, metrics }),
    ).toThrow("not supported");
  });
});
