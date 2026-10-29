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

// Output columns are keyed by each metric's position in the snapshot's
// frozen metric list; these fixtures stand in for that list.
const withIndices = (
  metrics: { metric: FactMetricInterface; analyses: InterleavingAnalysis[] }[],
) => metrics.map((m, index) => ({ ...m, index }));

const baseParams = {
  interleavingExposureQuerySql: EXPOSURE_QUERY,
  userIdType: "user_id",
  trackingKey: "featured-products-ranker",
  variationKeys: ["buyers-picks", "price-low"] as [string, string],
  runs: [
    { dateStarted: new Date("2020-01-01"), dateEnded: new Date("2020-12-31") },
  ],
  startDate: new Date("2020-01-01"),
  endDate: new Date("2020-12-31"),
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
      metrics: withIndices([{ metric: proportion, analyses: [PAIRED] }]),
    });
    const preference = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: withIndices([{ metric: proportion, analyses: [PREFERENCE] }]),
    });
    const both = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: withIndices([
        { metric: proportion, analyses: [PAIRED, PREFERENCE] },
      ]),
    });

    expect(paired).toContain("__exposures");
    expect(paired).toContain("jsonb_array_elements");
    expect(paired).toContain("__credited");
    expect(paired).toContain("__pairedUser");
    expect(paired).toContain("m0_treatment_control_sum_product");
    expect(paired).not.toContain("users_pref_treatment");
    expect(paired).not.toContain("__share");
    expect(paired).not.toContain("first_exposure_timestamp");
    expect(paired).toContain("'featured-products-ranker'");
    expect(preference).toContain("__share");
    expect(preference).toContain("m0_users_pref_treatment");
    expect(preference).toMatch(
      /WHEN pref\.wins_t_0 = pref\.wins_c_0 THEN 1\s+ELSE 0\s+END\s*\)\s*\) AS m0_users_tied/,
    );
    expect(preference).not.toContain("__credited");
    // Preference has its own post-exposure event aggregation at item grain
    expect(preference).not.toContain("__itemEvents");
    expect(preference).toContain("__preferenceEvents");
    expect(preference).toContain("ev.value_0 * s.share_t, 0)) AS wins_t_0");
    expect(preference).toContain(
      "MIN(e.exposure_timestamp) AS first_exposure_timestamp",
    );
    expect(preference).toContain("__preferenceEventRows");
    expect(preference).toMatch(
      /INNER JOIN __share s ON \(\s*s\.user_id = m\.user_id\s+AND s\.item_id = cast\(m\.item_id as varchar\)\s*\)/,
    );
    expect(preference).toContain(
      "m.timestamp >= m.__gb_first_exposure_timestamp",
    );
    expect(preference).toMatch(
      /GROUP BY\s+m\.user_id,\s+cast\(m\.item_id as varchar\)/,
    );
    // Mixed: both chains aggregate one filtered event-row source at their own
    // grains; output columns are keyed by metric id
    expect(both).toContain("m0_treatment_control_sum_product");
    expect(both).toContain("m0_users_pref_treatment");
    expect(both).not.toContain("value_1");
    expect(both).toContain("__eventRows");
    expect(both).toContain("__preferenceEvents");
    expect(both).not.toContain("__itemEvents");
    const cteBefore = (sql: string, name: string, nextName: string) =>
      sql
        .slice(sql.indexOf(`${name} AS`), sql.indexOf(`${nextName} AS`))
        .trim()
        .replace(/,$/, "");
    expect(cteBefore(both, "__events", "__preferenceEventRows")).toBe(
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
    expect(paired).toMatch(/WHEN im\.has_event_0 = 1 THEN im\.exposures_0/);
    expect(paired).not.toContain("OVER (");

    // Variation keys are escaped through the dialect
    const quoted = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: withIndices([{ metric: proportion, analyses: [PREFERENCE] }]),
      variationKeys: ["o'brien", "control"] as [string, string],
    });
    expect(quoted).toContain("'o''brien'");
  });

  it("resolves numerators like experiment fact metrics", () => {
    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: withIndices([
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
      ]),
    });
    expect(sql).toMatch(/COALESCE\(MAX\(1\), 0\) AS value_0/);
    expect(sql).toMatch(/COUNT\(1\) AS value_1/);
    expect(sql).toMatch(
      /SUM\(\s*COALESCE\(\s*CASE\s+WHEN \(\(event_name = 'purchase'\)\) THEN m\.value\s+ELSE NULL\s+END,\s*0\s*\)\s*\) AS value_2/,
    );
    // Rows matching no metric's filters are dropped; metric 0/1 have none, so
    // the shared event-row source only has the date filter.
    expect(sql).toMatch(
      /__eventRows AS \([\s\S]*WHERE\s+\(\s+\(\s+m\.timestamp >= '2020-01-01 00:00:00'\s+AND m\.timestamp <= '2020-12-31 00:00:00'\s+\)\s+\)/,
    );
    expect(sql).toMatch(
      /__preferenceEvents AS \([\s\S]*m\.timestamp >= m\.__gb_first_exposure_timestamp[\s\S]*GROUP BY\s+m\.user_id,\s+cast\(m\.item_id as varchar\)/,
    );
  });

  // The exposure side comes from fieldText (always text) and the events side
  // from the warehouse column, so both are normalised before they can meet in
  // a join.
  it("casts item_id and ranking_id to string on both sides of the join", () => {
    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: withIndices([
        { metric: proportion, analyses: [PAIRED, PREFERENCE] },
      ]),
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

  // castToString is varchar(256) on SQL Server, which would merge two ids
  // sharing a 256-character prefix into one group/join key. Item ids come from
  // the customer's catalog and have no length bound.
  it("does not truncate join keys on SQL Server", () => {
    const sql = getInterleavingMetricQuery(mssqlDialect, {
      ...baseParams,
      metrics: withIndices([
        { metric: proportion, analyses: [PAIRED, PREFERENCE] },
      ]),
    });

    expect(sql).not.toContain("varchar(256)");
    expect(sql).toContain("as varchar(8000)) AS item_id");
    expect(sql).toContain("as varchar(8000)) AS ranking_id");
  });

  // A stopped experiment's tracking key can be reused, so a single window
  // spanning a stop/restart would also count whatever ran under that key in
  // between. Each run is filtered separately instead.
  it("counts only the experiment's own run windows", () => {
    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      runs: [
        {
          dateStarted: new Date("2020-01-01"),
          dateEnded: new Date("2020-02-01"),
        },
        {
          dateStarted: new Date("2020-06-01"),
          dateEnded: new Date("2020-07-01"),
        },
      ],
      metrics: withIndices([{ metric: proportion, analyses: [PAIRED] }]),
    });
    const squashed = sql.replace(/\s+/g, " ");

    // Both windows present, OR'd, in the exposure and the event filters
    expect(squashed).toContain(
      "( e.timestamp >= '2020-01-01 00:00:00' AND e.timestamp <= '2020-02-01 00:00:00' ) OR ( e.timestamp >= '2020-06-01 00:00:00' AND e.timestamp <= '2020-07-01 00:00:00' )",
    );
    expect(squashed).toContain(
      "( m.timestamp >= '2020-01-01 00:00:00' AND m.timestamp <= '2020-02-01 00:00:00' ) OR ( m.timestamp >= '2020-06-01 00:00:00' AND m.timestamp <= '2020-07-01 00:00:00' )",
    );
    // The dormant gap is never a bound of either range
    expect(squashed).not.toContain("'2020-02-01 00:00:00' AND");
  });

  it("rejects a query with no run windows", () => {
    expect(() =>
      getInterleavingMetricQuery(postgresDialect, {
        ...baseParams,
        runs: [],
        metrics: withIndices([{ metric: proportion, analyses: [PAIRED] }]),
      }),
    ).toThrow("at least one run");
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
      metrics: withIndices([
        { metric: metricOn("ft_virtual"), analyses: [PREFERENCE] },
      ]),
    });

    expect(sql).toContain("sku");
    expect(sql).not.toMatch(/cast\(m\.item_id as varchar\)/);
  });

  it("gates engaged impressions on event existence, not on the metric value", () => {
    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: withIndices([
        {
          analyses: [PAIRED],
          metric: metricOn("ft_cart", {
            metricType: "mean",
            column: "value",
            rowFilters: [
              { column: "event_name", operator: "=", values: ["purchase"] },
            ],
          }),
        },
      ]),
    });

    // The credit gate reads this metric's own earliest matching row
    const squashed = sql.replace(/\s+/g, " ");
    expect(squashed).toContain(
      "MIN( CASE WHEN ((event_name = 'purchase')) THEN m.timestamp ELSE NULL END ) AS first_event_ts_0",
    );
    expect(squashed).toContain("ev.first_event_ts_0 >= e.exposure_timestamp");
    expect(sql).toContain("MAX(c.has_event_0) AS has_event_0");
    expect(sql).toMatch(/WHEN im\.has_event_0 = 1 THEN im\.treatment_0/);
    expect(sql).toMatch(/WHEN im\.has_event_0 = 1 THEN im\.control_0/);
    expect(sql).toMatch(/WHEN im\.has_event_0 = 1 THEN im\.exposures_0/);
    // A signed metric no longer loses the impression when its values cancel
    expect(sql).not.toContain("im.treatment_0 + im.control_0");
  });

  it("takes the whole group's first event when the metric has no row filters", () => {
    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: withIndices([{ metric: proportion, analyses: [PAIRED] }]),
    });
    const squashed = sql.replace(/\s+/g, " ");
    expect(squashed).toContain("MIN(m.timestamp) AS first_event_ts_0");
    expect(squashed).not.toContain("ELSE NULL END ) AS first_event_ts_0");
  });

  it("gives each metric its own first-event timestamp", () => {
    const filtered = (event: string) =>
      metricOn("ft_cart", {
        metricType: "mean",
        column: "value",
        rowFilters: [{ column: "event_name", operator: "=", values: [event] }],
      });
    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: withIndices([
        { analyses: [PAIRED], metric: filtered("view") },
        { analyses: [PAIRED], metric: filtered("purchase") },
      ]),
    });
    const squashed = sql.replace(/\s+/g, " ");

    // __eventRows is the OR of both filters, so a shared MIN would let one
    // metric's pre-exposure row suppress the other's engagement
    expect(squashed).not.toContain("first_event_timestamp");
    for (const [i, event] of [
      [0, "view"],
      [1, "purchase"],
    ] as const) {
      expect(squashed).toContain(
        `MIN( CASE WHEN ((event_name = '${event}')) THEN m.timestamp ELSE NULL END ) AS first_event_ts_${i}`,
      );
      expect(squashed).toContain(
        `ev.first_event_ts_${i} >= e.exposure_timestamp`,
      );
    }
  });

  it("does not thread the engagement indicator through the preference chain", () => {
    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics: withIndices([{ metric: proportion, analyses: [PREFERENCE] }]),
    });
    expect(sql).not.toContain("has_event_");
    expect(sql).not.toContain("first_event_ts_");
  });

  it("casts the per-user paired aggregates so integer dialects cannot overflow", () => {
    const metrics = withIndices([{ metric: proportion, analyses: [PAIRED] }]);
    const mssql = getInterleavingMetricQuery(mssqlDialect, {
      ...baseParams,
      metrics,
    });
    const postgres = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      metrics,
    });

    // One cast each for treatment, control and exposures, and nowhere else:
    // user counts and the preference share cannot overflow
    expect(mssql.match(/as FLOAT/g) ?? []).toHaveLength(3);
    for (const col of ["treatment_0", "control_0", "exposures_0"]) {
      expect(postgres).toMatch(new RegExp(`::float AS ${col}`));
    }
  });
});

describe("getInterleavingMetricQuery dialects", () => {
  const metrics = withIndices([
    { metric: proportion, analyses: [PAIRED, PREFERENCE] },
  ]);
  // Trino/Presto cannot cast a JSON array to VARCHAR, so the probe tries that
  // cast first (identity for a text column) and falls back to json_format.
  const TRINO_UNNEST =
    "UNNEST(CAST(json_parse(COALESCE(try_cast(e.items AS VARCHAR), json_format(CAST(e.items AS JSON)))) AS ARRAY(JSON)))";
  const unnestFragment: {
    name: string;
    dialect: typeof postgresDialect;
    fragment: string;
  }[] = [
    {
      name: "postgres",
      dialect: postgresDialect,
      fragment: "jsonb_array_elements((e.items)::jsonb)",
    },
    {
      name: "bigquery",
      dialect: bigQueryDialect,
      fragment: "UNNEST(JSON_QUERY_ARRAY(e.items))",
    },
    {
      name: "snowflake",
      dialect: snowflakeDialect,
      fragment: "FLATTEN(INPUT => PARSE_JSON(e.items::string))",
    },
    {
      name: "databricks",
      dialect: databricksDialect,
      fragment: "explode(from_json(CAST(e.items AS STRING), 'array<string>'))",
    },
    {
      name: "clickhouse",
      dialect: clickHouseDialect,
      fragment: "ARRAY JOIN JSONExtractArrayRaw(toString(e.items))",
    },
    {
      name: "mysql",
      dialect: mysqlDialect,
      fragment: "JSON_TABLE(e.items, '$[*]' COLUMNS (item JSON PATH '$'))",
    },
    {
      name: "mssql",
      dialect: mssqlDialect,
      fragment: "CROSS APPLY OPENJSON(e.items)",
    },
    { name: "athena", dialect: athenaDialect, fragment: TRINO_UNNEST },
    { name: "presto", dialect: prestoDialect, fragment: TRINO_UNNEST },
  ];

  it.each(unnestFragment)("builds for $name", ({ dialect, fragment }) => {
    const sql = getInterleavingMetricQuery(dialect, { ...baseParams, metrics });
    const squashed = sql.replace(/\s+/g, " ");
    // The formatter inserts spaces around parens, so compare without them
    expect(sql.replace(/\s+/g, "")).toContain(fragment.replace(/\s+/g, ""));
    // The competitive filter and item grouping go through fieldText
    expect(squashed).toContain("= 'true'");
    expect(squashed).toContain("AS item_id");
    expect(squashed).toContain("m0_treatment_sum");
    // The engagement indicator and the per-user cast reach every dialect
    expect(squashed).toContain("AS has_event_0");
    expect(squashed).toContain("AS exposures_0");
    expect(squashed).toContain("m0_users_tied");
    // Equi-join only; the timestamp test is in the credited value
    expect(squashed).not.toMatch(/ON \([^)]*>=/);
  });

  it("rejects dialects without JSON array support", () => {
    expect(() =>
      getInterleavingMetricQuery(redshiftDialect, { ...baseParams, metrics }),
    ).toThrow("not supported");
  });

  it("evaluates preference row filters against a single relation", () => {
    const filteredTable = factTableFactory.build({
      id: "ft_cart",
      sql: "SELECT user_id, timestamp, item_id, ranking_id, value FROM events",
      columns: [],
      filters: [
        {
          id: "flt_item",
          name: "one item",
          value: "item_id = 'a'",
          description: "",
          dateCreated: new Date(),
          dateUpdated: new Date(),
          managedBy: "",
        },
      ],
    });
    const withFilter = (id: string, filterId: string) =>
      factMetricFactory.build({
        id,
        metricType: "proportion",
        numerator: {
          factTableId: "ft_cart",
          column: "$$count",
          rowFilters: [
            { operator: "saved_filter", values: [filterId], column: "" },
          ],
        },
      });

    const sql = getInterleavingMetricQuery(postgresDialect, {
      ...baseParams,
      factTable: filteredTable,
      // Multiple metrics force filters to remain metric-specific.
      metrics: [
        { metric: withFilter("fact__a", "flt_item"), analyses: [PREFERENCE] },
        { metric: withFilter("fact__b", "flt_item"), analyses: [PREFERENCE] },
      ],
    });

    expect(sql.replace(/\s+/g, " ")).toContain("item_id = 'a'");

    const preferenceEvents = sql.slice(
      sql.indexOf("__preferenceEvents AS ("),
      sql.indexOf("__preferenceUser AS ("),
    );
    expect(preferenceEvents).toContain("item_id = 'a'");
    expect(preferenceEvents).toContain("__preferenceEventRows");
    expect(preferenceEvents).not.toContain("__share");
    expect(preferenceEvents).not.toMatch(/\bJOIN\b/);
  });
});
