import { DatabaseSync } from "node:sqlite";
import type { DataSourceInterface } from "shared/types/datasource";
import type { CompoundFactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import { baseDialect, mysqlDialect, postgresDialect } from "shared/dialects";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import { getExperimentFactMetricStatisticsCTE } from "back-end/src/integrations/sql/ctes/experiment-fact-metric-statistics-cte";
import { getExperimentFactMetricsQuery } from "back-end/src/integrations/sql/queries/experiment-fact-metrics-query";
import { getMetricData } from "back-end/src/integrations/sql/fact-metrics/metric-data";
import {
  getMetricUsersColumn,
  getPercentileCapSource,
} from "back-end/src/integrations/sql/dates/unit-eligibility";
import { processExperimentFactMetricsQueryRows } from "back-end/src/integrations/sql/processing/process-experiment-fact-metrics-query-rows";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

// Runs the production statistics CTE against an in-memory SQLite fixture (same
// approach as clusterRollupExecution.test.ts) to check that a metric with
// `skipPartialData` only sums, and only counts, units exposed long enough ago,
// while the other metrics in the same query keep every unit.

const dialect: SqlDialect = {
  ...baseDialect,
  unpivotLabeledPairs: () => {
    throw new Error("unpivotLabeledPairs is not used by the statistics CTE");
  },
};

const factTable = factTableFactory.build({ id: "orders", sql: "*" });
const factTablesWithIndices = [{ factTable, index: 0 }];

const ASOF = new Date("2024-02-10T12:00:00.000Z");
const settings = {
  attributionModel: "firstExposure" as const,
  regressionAdjustmentEnabled: false,
  skipPartialData: false,
  metricSettings: [],
  startDate: new Date("2024-01-01"),
  endDate: new Date("2999-01-01"),
};

const buildMetric = (id: string, windowDays: number | null) =>
  factMetricFactory.build({
    id,
    metricType: "mean",
    numerator: { factTableId: "orders", column: "amount", aggregation: "sum" },
    skipPartialData: windowDays !== null,
    windowSettings: {
      type: windowDays === null ? "" : "conversion",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: windowDays ?? 1,
      windowUnit: "days",
    },
  });

const metricData = [
  buildMetric("all_units", null),
  buildMetric("one_day", 1),
  buildMetric("one_day_again", 1),
  buildMetric("two_days", 2),
].map((metric, index) =>
  getMetricData(
    dialect,
    { metric, index },
    settings,
    null,
    factTablesWithIndices,
    "m",
    `m${index}`,
    false,
  ),
);

// [user, hours exposed before ASOF, value of every metric]
const units: [string, number, number][] = [
  ["u1", 240, 1],
  ["u2", 36, 2],
  ["u3", 6, 4],
];

const fixture = units
  .map(([user, hoursAgo, value]) => {
    const exposed = dialect.toTimestamp(
      new Date(ASOF.getTime() - hoursAgo * 3600 * 1000),
    );
    return `SELECT '0' AS variation, '${user}' AS user_id, ${exposed} AS timestamp, ${metricData
      .map((d) => `${value} AS ${d.alias}_value`)
      .join(", ")}`;
  })
  .join("\n      UNION ALL ");

const unitEligibility = {
  timestampColumn: "timestamp",
  settings,
  activationMetric: null,
  asOf: ASOF,
};

describe("unit eligibility execution (SQL math)", () => {
  it("trims each opted-in metric to the units exposed long enough ago", () => {
    const sql = `WITH __userMetricAgg AS (
      ${fixture}
    )
    ${getExperimentFactMetricStatisticsCTE(dialect, {
      dimensionCols: [],
      metricData,
      eventQuantileData: [],
      baseIdType: "user_id",
      joinedMetricTableName: "__userMetricAgg",
      eventQuantileTableName: "__eventQuantileMetric",
      capValueTableName: "__capValue",
      factTablesWithIndices,
      percentileTableIndices: new Set<number>(),
      unitEligibility,
    })}`;

    const db = new DatabaseSync(":memory:");
    const rows = db.prepare(sql).all();
    db.close();

    // The two one-day metrics share one count of eligible units, and no metric
    // adds a column of its own to find it
    expect(processExperimentFactMetricsQueryRows(rows)).toEqual([
      {
        variation: "0",
        users: 3,
        count: 3,
        users_cw1440m: 2,
        users_cw2880m: 1,
        m0_id: "all_units",
        m0_main_sum: 7,
        m0_main_sum_squares: 21,
        m1_id: "one_day",
        m1_main_sum: 3,
        m1_main_sum_squares: 5,
        m2_id: "one_day_again",
        m2_main_sum: 3,
        m2_main_sum_squares: 5,
        m3_id: "two_days",
        m3_main_sum: 1,
        m3_main_sum_squares: 1,
      },
    ]);
    // Reading the results back names the column each metric's query wrote
    expect(
      metricData.map((d) => getMetricUsersColumn(d.metric, settings, null)),
    ).toEqual([null, "users_cw1440m", "users_cw1440m", "users_cw2880m"]);
  });

  it("counts a trimmed compound metric's component units over the units it analyzes", () => {
    const compound: CompoundFactMetricInterface = {
      ...buildMetric("compound", 1),
      metricType: "compound",
      numerator: null,
      funnelSettings: null,
      compoundSettings: {
        components: [
          { factTableId: "orders", rowFilters: [] },
          {
            factTableId: "orders",
            rowFilters: [{ column: "amount", operator: ">", values: ["0"] }],
          },
        ],
      },
    };
    const compoundData = getMetricData(
      dialect,
      { metric: compound, index: 0 },
      settings,
      null,
      factTablesWithIndices,
      "m",
      "m0",
      false,
    );
    // [hours exposed before ASOF, matched component 0, matched component 1]
    const compoundFixture = [
      [240, 1, 1],
      [36, 1, 0],
      [6, 1, 1],
    ]
      .map(
        ([hoursAgo, c0, c1]) =>
          `SELECT '0' AS variation, ${dialect.toTimestamp(
            new Date(ASOF.getTime() - hoursAgo * 3600 * 1000),
          )} AS timestamp, ${c0} AS m0_c0, ${c1} AS m0_c1`,
      )
      .join("\n      UNION ALL ");

    const db = new DatabaseSync(":memory:");
    const rows = db
      .prepare(
        `WITH __userMetricAgg AS (
      ${compoundFixture}
    )
    ${getExperimentFactMetricStatisticsCTE(dialect, {
      dimensionCols: [],
      metricData: [compoundData],
      eventQuantileData: [],
      baseIdType: "user_id",
      joinedMetricTableName: "__userMetricAgg",
      eventQuantileTableName: "__eventQuantileMetric",
      capValueTableName: "__capValue",
      factTablesWithIndices,
      percentileTableIndices: new Set<number>(),
      unitEligibility,
    })}`,
      )
      .all();
    db.close();

    // The unit exposed 6 hours ago matched both components but is left out
    expect(processExperimentFactMetricsQueryRows(rows)).toEqual([
      expect.objectContaining({
        users: 3,
        users_cw1440m: 2,
        m0_main_sum: 1,
        m0_c0_units: 2,
        m0_c1_units: 1,
      }),
    ]);
  });

  it("leaves units a metric does not analyze out of its percentile cap", () => {
    const capSource = getPercentileCapSource(
      dialect,
      "__userMetricAgg",
      [{ valueCol: "m0_value" }, { valueCol: "m1_value" }],
      metricData,
      unitEligibility,
    );
    const db = new DatabaseSync(":memory:");
    const rows = db
      .prepare(
        `WITH __userMetricAgg AS (${fixture})
        SELECT MAX(m0_value) AS m0_cap, MAX(m1_value) AS m1_cap FROM ${capSource}`,
      )
      .all();
    db.close();

    // u3 has the largest value but was exposed 6 hours ago
    expect(rows).toEqual([{ m0_cap: 4, m1_cap: 2 }]);
  });

  it("keeps the units left out as NULL from moving MySQL's percentile cap", () => {
    const db = new DatabaseSync(":memory:");
    const cap = (source: string) =>
      db
        .prepare(
          `WITH capSource AS (${source})
          ${mysqlDialect.percentileCapSelectClause(
            [
              {
                valueCol: "v",
                outputCol: "v_cap",
                percentile: 0.5,
                ignoreZeros: false,
                sourceIndex: 0,
              },
            ],
            "capSource",
          )}`,
        )
        .all();
    const eligible = "SELECT 10 AS v UNION ALL SELECT 20 UNION ALL SELECT 100";
    const leftOut = "SELECT NULL AS v UNION ALL SELECT NULL";

    expect(cap(`${eligible} UNION ALL ${leftOut}`)).toEqual([{ v_cap: 20 }]);
    // Still one row when every unit is left out: the statistics cross join
    // the cap, so no row would drop every metric in the query
    expect(cap(leftOut)).toEqual([{ v_cap: null }]);
    db.close();
  });

  it("reads the per-unit table directly when no capped metric is trimmed", () => {
    expect(
      getPercentileCapSource(
        dialect,
        "__userMetricAgg",
        [{ valueCol: "m0_value" }],
        metricData,
        unitEligibility,
      ),
    ).toEqual("__userMetricAgg");
    expect(
      getPercentileCapSource(
        dialect,
        "__userMetricAgg",
        [{ valueCol: "m1_value" }],
        metricData,
        undefined,
      ),
    ).toEqual("__userMetricAgg");
  });
});

describe("unit eligibility in the standard fact metrics query", () => {
  const buildSql = (
    extraSettings: object = {},
    metrics = metricData.map((d) => d.metric),
    factTables = [factTable],
  ) => {
    const snapshotSettings = {
      ...settings,
      dimensions: [],
      activationMetric: null,
      experimentId: "exp_1",
      queryFilter: "",
      segment: "",
      variations: [
        { id: "0", weight: 0.5 },
        { id: "1", weight: 0.5 },
      ],
      ...extraSettings,
    };
    return getExperimentFactMetricsQuery(
      postgresDialect,
      { settings: {} } as unknown as DataSourceInterface,
      {
        settings: snapshotSettings as never,
        unitsSource: "exposureQuery",
        unitsSettings: buildUnitsQuerySettingsFromSnapshot(
          snapshotSettings as never,
          {
            query:
              "SELECT user_id, timestamp, experiment_id, variation_id FROM assignments",
            identifierType: "user_id",
          },
        ),
        activationMetric: null,
        dimensions: [],
        segment: null,
        metrics,
        factTableMap: new Map(factTables.map((t) => [t.id, t])),
        unitsTableFullName: "",
      } as never,
    ).replace(/\s+/g, " ");
  };

  it("carries the exposure timestamp to the statistics and trims there", () => {
    const sql = buildSql();
    expect(sql).toContain("MIN(umj.timestamp) AS timestamp");
    expect(sql).toContain("AS users_cw1440m");
    expect(sql).toContain("m.timestamp <=");
    // The units themselves are not filtered
    expect(sql).not.toContain("first_exposure_timestamp <=");
  });

  it("computes a trimmed metric's percentile cap over the units it analyzes", () => {
    const refunds = factTableFactory.build({ id: "refunds", sql: "*" });
    const sql = buildSql(
      {},
      [
        buildMetric("all_units", null),
        factMetricFactory.build({
          ...buildMetric("capped", 1),
          numerator: {
            factTableId: "refunds",
            column: "amount",
            aggregation: "sum",
          },
          cappingSettings: { type: "percentile", value: 0.99 },
        }),
      ],
      [factTable, refunds],
    );
    // The cap's fact table carries the exposure timestamp too
    expect(sql.split("MIN(umj.timestamp) AS timestamp")).toHaveLength(3);
    expect(sql).toMatch(
      /CASE WHEN timestamp <= \S+ \S+ THEN m1_value ELSE NULL END \) AS m1_value FROM __userMetricAgg1 \) cap_source/,
    );
  });

  it("leaves the query alone when the experiment already trims every metric", () => {
    const sql = buildSql({ skipPartialData: true });
    expect(sql).not.toContain("users_cw");
    expect(sql).not.toContain("MIN(umj.timestamp) AS timestamp");
    expect(sql).toContain("first_exposure_timestamp <=");
  });
});
