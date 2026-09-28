import { format } from "shared/sql";
import { ExposureQuery } from "shared/types/datasource";
import { SnapshotBanditSettings } from "shared/types/experiment-snapshot";
import { SqlDialect } from "shared/types/sql";
import {
  FunnelFactMetricInterface,
  MetricFunnelStep,
} from "shared/types/fact-table";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import BigQuery from "back-end/src/integrations/BigQuery";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { redshiftDialect } from "back-end/src/integrations/dialects/redshift";
import { getExperimentFactMetricsQuery } from "back-end/src/integrations/sql/queries/experiment-fact-metrics-query";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { factTableFactory } from "back-end/test/factories/FactTable.factory";

const testExposureQuery: ExposureQuery = {
  id: "user_id",
  name: "Exposure",
  description: "Exposure",
  query: "SELECT user_id, timestamp, variation_id FROM events",
  userIdType: "user_id",
  dimensions: [],
};

const eventsFactTable = factTableFactory.build({
  id: "events",
  name: "Events",
  sql: "SELECT user_id, timestamp, event_name, amount FROM events",
  columns: [
    {
      column: "event_name",
      datatype: "string",
      name: "Event Name",
      description: "",
      numberFormat: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      deleted: false,
    },
  ],
});

const ordersFactTable = factTableFactory.build({
  id: "orders",
  name: "Orders",
  sql: "SELECT user_id, timestamp, amount FROM orders",
});

const refundsFactTable = factTableFactory.build({
  id: "refunds",
  name: "Refunds",
  sql: "SELECT user_id, timestamp, amount FROM refunds",
});

const factTableMap = new Map([
  [eventsFactTable.id, eventsFactTable],
  [ordersFactTable.id, ordersFactTable],
  [refundsFactTable.id, refundsFactTable],
]);

// @ts-expect-error -- context is not needed to read `.datasource`
const bqIntegration = new BigQuery("", {
  type: "bigquery",
  settings: { queries: { exposure: [testExposureQuery] } },
});

function buildStep(
  name: string,
  overrides: Partial<MetricFunnelStep> = {},
): MetricFunnelStep {
  return {
    name,
    factTableId: "events",
    rowFilters: [
      {
        column: "event_name",
        operator: "=" as const,
        values: [name],
      },
    ],
    optional: false,
    conversionWindow: null,
    ...overrides,
  };
}

function buildFunnelMetric({
  id = "fact__funnel",
  steps,
  concurrencyWindowSeconds = 0,
}: {
  id?: string;
  steps: MetricFunnelStep[];
  concurrencyWindowSeconds?: number;
}): FunnelFactMetricInterface {
  return {
    ...factMetricFactory.build({ id }),
    id,
    name: "Checkout Funnel",
    metricType: "funnel",
    numerator: null,
    funnelSettings: { steps, concurrencyWindowSeconds },
  };
}

const startDate = new Date("2023-01-01");
const endDate = new Date("2023-01-31");

const settings = {
  manual: false,
  dimensions: [],
  metricSettings: [],
  goalMetrics: [],
  secondaryMetrics: [],
  guardrailMetrics: [],
  activationMetric: null,
  defaultMetricPriorSettings: {
    override: false,
    proper: false,
    mean: 0,
    stddev: 0,
  },
  regressionAdjustmentEnabled: true,
  attributionModel: "firstExposure" as const,
  experimentId: "",
  queryFilter: "",
  segment: "",
  skipPartialData: false,
  datasourceId: "",
  exposureQueryId: "user_id",
  startDate,
  endDate,
  variations: [],
};

function buildSql(
  metrics: FunnelFactMetricInterface[],
  dialect: SqlDialect = bigQueryDialect,
  datasourceType: string = "bigquery",
  banditSettings?: SnapshotBanditSettings,
): string {
  const snapshotSettings = { ...settings, banditSettings };
  return getExperimentFactMetricsQuery(
    dialect,
    { ...bqIntegration.datasource, type: datasourceType as "bigquery" },
    {
      settings: snapshotSettings,
      unitsSource: "exposureQuery",
      unitsSettings: buildUnitsQuerySettingsFromSnapshot(snapshotSettings, {
        query: testExposureQuery.query,
        userIdType: testExposureQuery.userIdType,
      }),
      activationMetric: null,
      dimensions: [],
      segment: null,
      metrics,
      factTableMap,
    },
  );
}

/** Collapses the generated SQL's whitespace so assertions can span clauses. */
function flatten(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/** The final statistics SELECT, i.e. everything after the last CTE. */
function statisticsSelect(sql: string): string {
  return sql.slice(sql.lastIndexOf("One row per variation/dimension"));
}

const threeStepFunnel = buildFunnelMetric({
  steps: [
    buildStep("view"),
    buildStep("add_to_cart", {
      optional: true,
      conversionWindow: { unit: "hours", value: 2 },
    }),
    buildStep("purchase", {
      conversionWindow: { unit: "days", value: 1 },
    }),
  ],
  concurrencyWindowSeconds: 300,
});

const crossFactTableFunnel = buildFunnelMetric({
  id: "fact__cross_funnel",
  steps: [
    buildStep("view"),
    buildStep("purchase", {
      factTableId: "orders",
      rowFilters: [],
      conversionWindow: { unit: "days", value: 1 },
    }),
  ],
});

describe("funnel fact metric SQL", () => {
  it("matches the BigQuery snapshot", () => {
    expect(
      format(flatten(buildSql([threeStepFunnel])), "bigquery"),
    ).toMatchSnapshot();
  });

  it("matches the Redshift snapshot", () => {
    expect(
      format(
        flatten(buildSql([threeStepFunnel], redshiftDialect, "redshift")),
        "redshift",
      ),
    ).toMatchSnapshot();
  });

  it("shares one WITHIN GROUP ordering across all step arrays on Redshift", () => {
    // Redshift rejects a SELECT whose WITHIN GROUP (ORDER BY) clauses differ
    // across aggregates, so every step array must sort by the same shared
    // event-timestamp expression.
    const sql = buildSql([threeStepFunnel], redshiftDialect, "redshift");
    const orderings = [
      ...sql.matchAll(/WITHIN GROUP\s*\(\s*ORDER BY\s+([^)]+?)\s*\)/gi),
    ].map((m) => m[1].replace(/\s+/g, " "));
    expect(orderings.length).toBeGreaterThanOrEqual(2);
    expect(new Set(orderings).size).toBe(1);
  });

  it("emits one sum per step and no main_sum", () => {
    const sql = buildSql([threeStepFunnel]);

    expect(sql).toContain("m0_step_0_sum");
    expect(sql).toContain("m0_step_1_sum");
    expect(sql).toContain("m0_step_2_sum");
    expect(sql).not.toContain("m0_step_3_sum");
    expect(sql).not.toContain("m0_main_sum");
    expect(sql).not.toContain("m0_main_sum_squares");
  });

  it("gates each step's timestamp on that step's row filters", () => {
    const sql = buildSql([threeStepFunnel]);

    expect(sql).toContain("(event_name = 'view')");
    expect(sql).toContain("(event_name = 'add_to_cart')");
    expect(sql).toContain("(event_name = 'purchase')");
  });

  it("does not reference a value column the fact table never projects", () => {
    // A funnel's fact-table CTE emits per-step timestamps and no `_value`, so
    // any downstream reference to one would be an unresolvable column.
    expect(buildSql([threeStepFunnel])).not.toContain("m0_value");
  });

  it("counts units that never entered the funnel", () => {
    // PA funnels filter these out; an experiment's denominator is every
    // exposed unit, so the first step must not become a WHERE clause.
    expect(buildSql([threeStepFunnel])).not.toMatch(
      /WHERE\s+\S*m0_step_0_resolved_ts IS NOT NULL/,
    );
  });

  it("anchors a step after an optional step on the last required step", () => {
    const sql = buildSql([threeStepFunnel]);

    // Step 1 is optional; step 2 skips it and windows off required step 0.
    expect(sql).toContain("m0_step_0_resolved_ts");
    expect(sql).not.toContain(
      "COALESCE(r.m0_step_1_resolved_ts, r.m0_step_0_resolved_ts)",
    );
    // Step 2's window uses step 0 directly (concurrency lower bound).
    expect(sql).toMatch(
      /DATETIME_SUB\(\s*r\.m0_step_0_resolved_ts,\s*INTERVAL 300 SECOND\s*\)/,
    );
  });

  it("falls through an optional first step to exposure", () => {
    const sql = buildSql([
      buildFunnelMetric({
        steps: [
          buildStep("view", { optional: true }),
          buildStep("purchase", {
            conversionWindow: { unit: "hours", value: 2 },
          }),
        ],
      }),
    ]);

    // Optional step 0 is ignored as an anchor; step 1 windows off exposure.
    expect(sql).toContain("r.timestamp");
    expect(sql).not.toContain("COALESCE(r.m0_step_0_resolved_ts, r.timestamp)");
  });

  it("resolves a windowed first step to a scalar in the aggregate", () => {
    const sql = buildSql([
      buildFunnelMetric({
        steps: [
          buildStep("view", {
            conversionWindow: { unit: "hours", value: 6 },
          }),
          buildStep("purchase"),
        ],
      }),
    ]);

    // Step 0 anchors on exposure, so it's resolved to a scalar via
    // MIN(CASE ... within window) in the aggregate — not an array + resolve CTE.
    expect(sql).toContain("m0_step_0_resolved_ts");
    expect(sql).not.toContain("m0_step_0_arr");
    expect(sql).not.toContain("__funnelResolve_0");
    // 6 hours = 21600 seconds, applied against exposure in the aggregate.
    expect(sql).toContain("21600");
  });

  it("applies the per-step conversion window and the concurrency window", () => {
    const sql = buildSql([threeStepFunnel]);

    // 2 hours for step 1, 1 day for step 2, 300s of concurrency slack on both.
    expect(sql).toContain("7200");
    expect(sql).toContain("86400");
    expect(sql).toContain("300");
  });

  it("omits the upper bound for a step with no conversion window", () => {
    const sql = buildSql([
      buildFunnelMetric({
        steps: [buildStep("view"), buildStep("purchase")],
      }),
    ]);

    expect(sql).toContain("m0_step_1_resolved_ts");
    expect(sql).not.toContain("7200");
  });

  it("gives each funnel in a shared query its own step columns", () => {
    const sql = buildSql([
      buildFunnelMetric({
        id: "fact__funnel_a",
        steps: [buildStep("view"), buildStep("purchase")],
      }),
      buildFunnelMetric({
        id: "fact__funnel_b",
        steps: [buildStep("view"), buildStep("signup"), buildStep("purchase")],
      }),
    ]);

    expect(sql).toContain("m0_step_1_sum");
    expect(sql).not.toContain("m0_step_2_sum");
    expect(sql).toContain("m1_step_2_sum");
  });

  it("resolves a single-source funnel in place, with nothing to flatten", () => {
    const sql = flatten(buildSql([threeStepFunnel]));

    expect(sql).not.toContain("__unitMetricsBase");
    expect(sql).toMatch(/FROM __userMetricAgg r/);
    expect(statisticsSelect(sql)).toContain("FROM __unitMetrics m");
  });

  it("rejects dialects that cannot express funnel resolution", () => {
    expect(() => buildSql([threeStepFunnel], bigQueryDialect, "mysql")).toThrow(
      /not supported for mysql/,
    );
  });

  it("rejects funnel metrics in bandit experiments", () => {
    const banditSettings: SnapshotBanditSettings = {
      reweight: true,
      decisionMetric: "fact__other",
      seed: 1,
      currentWeights: [0.5, 0.5],
      historicalWeights: [
        { date: startDate, weights: [0.5, 0.5], totalUsers: 100 },
      ],
    };

    expect(() =>
      buildSql([threeStepFunnel], bigQueryDialect, "bigquery", banditSettings),
    ).toThrow(/not supported in Bandit experiments/);
  });

  describe("steps spanning several fact tables", () => {
    it("matches the BigQuery snapshot", () => {
      expect(
        format(flatten(buildSql([crossFactTableFunnel])), "bigquery"),
      ).toMatchSnapshot();
    });

    it("reads each step's timestamps from its own fact table", () => {
      const sql = flatten(buildSql([crossFactTableFunnel]));

      const eventsCte = sql.slice(
        sql.indexOf("__factTable as ("),
        sql.indexOf("__factTable1 as ("),
      );
      const ordersCte = sql.slice(sql.indexOf("__factTable1 as ("));

      expect(eventsCte).toContain("m0_step_0_ts");
      expect(eventsCte).not.toContain("m0_step_1_ts");
      expect(ordersCte).toContain("m0_step_1_ts");
      expect(ordersCte).toContain("FROM orders");
    });

    it("gathers every step onto one row per unit before resolving", () => {
      const sql = flatten(buildSql([crossFactTableFunnel]));

      // Step 1's candidates live in the orders per-user aggregate, so
      // resolution can only run after both aggregates are joined.
      expect(sql).toMatch(
        /__unitMetricsBase AS \([\s\S]*m1\.m0_step_1_arr[\s\S]*LEFT JOIN __userMetricAgg1 m1/,
      );
      expect(sql).toMatch(/FROM __unitMetricsBase r/);
    });

    it("joins each source once, leaving statistics nothing to re-join", () => {
      const statistics = statisticsSelect(
        flatten(buildSql([crossFactTableFunnel])),
      );

      expect(statistics).toContain("FROM __unitMetrics m");
      expect(statistics).not.toContain("LEFT JOIN __userMetricAgg");
      expect(statistics).not.toContain("LEFT JOIN __unitMetrics");
    });

    it("reads a cross-fact-table ratio's columns off the flattened table", () => {
      // The ratio's denominator lives on source 1. Once every source is
      // flattened onto one row per unit, statistics read it from `m` rather
      // than joining __userMetricAgg1 again under an `m1` alias.
      const crossFactTableRatio = factMetricFactory.build({
        id: "fact__cross_ratio",
        metricType: "ratio",
        numerator: { factTableId: "events", column: "amount" },
        denominator: { factTableId: "orders", column: "amount" },
      });
      const statistics = statisticsSelect(
        flatten(buildSql([crossFactTableFunnel, crossFactTableRatio])),
      );

      expect(statistics).toContain("m.m1_denominator");
      expect(statistics).not.toContain("m1.m1_denominator");
      expect(statistics).not.toContain("LEFT JOIN __userMetricAgg1");
    });

    it("labels the query with every fact table it reads", () => {
      expect(buildSql([crossFactTableFunnel])).toContain(
        "Cross-Fact Table Metrics: Events & Orders",
      );
    });

    it("supports funnels spanning more than two fact tables", () => {
      const sql = flatten(
        buildSql([
          buildFunnelMetric({
            steps: [
              buildStep("view"),
              buildStep("purchase", { factTableId: "orders", rowFilters: [] }),
              buildStep("refund", { factTableId: "refunds", rowFilters: [] }),
            ],
          }),
        ]),
      );

      expect(sql).toContain("__factTable2 as (");
      expect(sql).toContain("LEFT JOIN __userMetricAgg2 m2");
    });
  });
});
