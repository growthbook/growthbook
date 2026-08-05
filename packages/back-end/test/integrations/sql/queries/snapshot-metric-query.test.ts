import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { ExperimentMetricQueryParams } from "shared/types/integrations";
import type { MetricInterface } from "shared/types/metric";
import type { SqlDialect } from "shared/types/sql";
import { athenaDialect } from "back-end/src/integrations/dialects/athena";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { clickHouseDialect } from "back-end/src/integrations/dialects/clickhouse";
import { databricksDialect } from "back-end/src/integrations/dialects/databricks";
import { mssqlDialect } from "back-end/src/integrations/dialects/mssql";
import { mysqlDialect } from "back-end/src/integrations/dialects/mysql";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { prestoDialect } from "back-end/src/integrations/dialects/presto";
import { redshiftDialect } from "back-end/src/integrations/dialects/redshift";
import { snowflakeDialect } from "back-end/src/integrations/dialects/snowflake";
import { verticaDialect } from "back-end/src/integrations/dialects/vertica";
import { getSnapshotMetricQuery } from "back-end/src/integrations/sql/queries/snapshot-metric-query";

const datasource: DataSourceInterface = {
  id: "ds_test",
  name: "Test datasource",
  description: "",
  organization: "org_test",
  dateCreated: null,
  dateUpdated: null,
  params: "",
  settings: { queries: { identityJoins: [] } },
  type: "bigquery",
};

const settings: ExperimentSnapshotSettings = {
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
    stddev: 1,
  },
  regressionAdjustmentEnabled: false,
  attributionModel: "firstExposure",
  experimentId: "exp_test",
  queryFilter: "",
  segment: "",
  skipPartialData: false,
  datasourceId: datasource.id,
  exposureQueryId: "exposure_test",
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-01-31T00:00:00Z"),
  variations: [],
};

function buildMetric({
  id,
  valueColumn,
  denominator,
  ignoreZeros,
  cappingType = "percentile",
  aggregation,
}: {
  id: string;
  valueColumn: string;
  denominator?: string;
  ignoreZeros?: boolean;
  cappingType?: "" | "absolute" | "percentile";
  aggregation?: string;
}): MetricInterface {
  return {
    id,
    organization: "org_test",
    owner: "",
    datasource: datasource.id,
    dateCreated: null,
    dateUpdated: null,
    name: id,
    description: "",
    type: "count",
    denominator,
    inverse: false,
    aggregation,
    ignoreNulls: false,
    sql: `SELECT user_id, timestamp, ${valueColumn} AS value FROM purchases`,
    queryFormat: "sql",
    userIdTypes: ["user_id"],
    cappingSettings: {
      type: cappingType,
      value: 0.98,
      ignoreZeros,
    },
    windowSettings: {
      type: "conversion",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: 72,
      windowUnit: "hours",
    },
    priorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 1,
    },
    queries: [],
    runStarted: null,
  };
}

function buildQuery(
  dialect: SqlDialect,
  {
    ignoreZeros,
    numeratorIgnoreZeros,
    denominatorIgnoreZeros,
    numeratorCappingType = "percentile",
    denominatorCappingType = "percentile",
    denominatorAggregation,
    bandit = false,
  }: {
    ignoreZeros?: boolean;
    numeratorIgnoreZeros?: boolean;
    denominatorIgnoreZeros?: boolean;
    numeratorCappingType?: "" | "absolute" | "percentile";
    denominatorCappingType?: "" | "absolute" | "percentile";
    denominatorAggregation?: string;
    bandit?: boolean;
  },
): string {
  const denominator = buildMetric({
    id: "orders",
    valueColumn: "orders",
    ignoreZeros: denominatorIgnoreZeros ?? ignoreZeros,
    cappingType: denominatorCappingType,
    aggregation: denominatorAggregation,
  });
  const metric = buildMetric({
    id: "revenue_per_order",
    valueColumn: "revenue",
    denominator: denominator.id,
    ignoreZeros: numeratorIgnoreZeros ?? ignoreZeros,
    cappingType: numeratorCappingType,
  });

  const querySettings: ExperimentSnapshotSettings = bandit
    ? {
        ...settings,
        variations: [
          { id: "control", weight: 0.5 },
          { id: "treatment", weight: 0.5 },
        ],
        banditSettings: {
          reweight: true,
          decisionMetric: metric.id,
          seed: 1,
          currentWeights: [0.5, 0.5],
          historicalWeights: [
            {
              date: new Date("2026-01-15T00:00:00Z"),
              weights: [0.5, 0.5],
              totalUsers: 100,
            },
          ],
        },
      }
    : settings;

  const params: ExperimentMetricQueryParams = {
    settings: querySettings,
    unitsSettings: {
      experimentId: querySettings.experimentId,
      exposureQuery: { query: "", userIdType: "user_id" },
      startDate: querySettings.startDate,
      endDate: querySettings.endDate,
      skipPartialData: querySettings.skipPartialData,
      attributionModel: querySettings.attributionModel,
      queryFilter: querySettings.queryFilter,
      variations: querySettings.variations,
      metricSettings: querySettings.metricSettings,
    },
    metric,
    denominatorMetrics: [denominator],
    activationMetric: null,
    factTableMap: new Map(),
    dimensions: [],
    segment: null,
    unitsSource: "exposureTable",
    unitsTableFullName: "experiment_units",
  };

  return getSnapshotMetricQuery(dialect, datasource, params);
}

function getCteBody(sql: string, cte: string): string {
  const start = new RegExp(`${cte}\\s+AS\\s*\\(`, "i").exec(sql);
  if (!start) {
    throw new Error(`Could not find ${cte}`);
  }

  const openParen = start.index + start[0].lastIndexOf("(");
  let depth = 1;
  let end = openParen + 1;
  while (depth > 0 && end < sql.length) {
    if (sql[end] === "(") depth += 1;
    if (sql[end] === ")") depth -= 1;
    end += 1;
  }
  if (depth !== 0) {
    throw new Error(`Could not find the end of ${cte}`);
  }

  return sql
    .slice(openParen + 1, end - 1)
    .replace(/\s+/g, " ")
    .trim();
}

const dialects: { name: string; dialect: SqlDialect }[] = [
  { name: "Athena", dialect: athenaDialect },
  { name: "BigQuery", dialect: bigQueryDialect },
  { name: "ClickHouse", dialect: clickHouseDialect },
  { name: "Databricks", dialect: databricksDialect },
  { name: "Microsoft SQL Server", dialect: mssqlDialect },
  { name: "MySQL", dialect: mysqlDialect },
  { name: "Postgres", dialect: postgresDialect },
  { name: "Presto", dialect: prestoDialect },
  { name: "Redshift", dialect: redshiftDialect },
  { name: "Snowflake", dialect: snowflakeDialect },
  { name: "Vertica", dialect: verticaDialect },
];

describe("legacy ratio percentile-cap populations", () => {
  it.each(dialects)(
    "$name includes users without denominator events in the denominator cap population",
    ({ dialect }) => {
      const sql = buildQuery(dialect, { ignoreZeros: false });
      const denominatorCapPopulation = getCteBody(
        sql,
        "__userDenominatorCapPopulation",
      );

      expect(denominatorCapPopulation).toMatch(
        /SELECT COALESCE\(d\.value,\s*0\) AS value FROM __userMetricAgg m LEFT JOIN __userDenominatorAgg d ON/i,
      );

      const numeratorCap = getCteBody(sql, "__capValue");
      const denominatorCap = getCteBody(sql, "__capValueDenominator");
      expect(numeratorCap).toMatch(
        /FROM __userMetricAgg WHERE value IS NOT NULL/i,
      );
      expect(denominatorCap).toMatch(
        /FROM __userDenominatorCapPopulation WHERE value IS NOT NULL/i,
      );
      expect(numeratorCap).not.toMatch(/value\s*!=\s*0/i);
      expect(denominatorCap).not.toMatch(/value\s*!=\s*0/i);
    },
  );

  it.each(dialects)(
    "$name excludes zero-valued users only when ignoreZeros is enabled",
    ({ dialect }) => {
      const sql = buildQuery(dialect, { ignoreZeros: true });
      const numeratorCap = getCteBody(sql, "__capValue");
      const denominatorCap = getCteBody(sql, "__capValueDenominator");

      expect(sql).not.toMatch(/__userDenominatorCapPopulation\s+AS\s*\(/i);
      expect(denominatorCap).toMatch(
        /FROM __userDenominatorAgg WHERE value IS NOT NULL/i,
      );
      expect(numeratorCap).toMatch(/value\s*!=\s*0/i);
      expect(denominatorCap).toMatch(/value\s*!=\s*0/i);
    },
  );

  it("does not change the denominator aggregation input for custom SQL aggregations", () => {
    const sql = buildQuery(bigQueryDialect, {
      ignoreZeros: false,
      denominatorAggregation: "AVG(COALESCE(value, 1))",
    });
    const denominatorAgg = getCteBody(sql, "__userDenominatorAgg");
    const denominatorCapPopulation = getCteBody(
      sql,
      "__userDenominatorCapPopulation",
    );

    expect(denominatorAgg).toMatch(
      /AVG\(COALESCE\(value,\s*1\)\) as value FROM __distinctUsers d JOIN __denominator0 m ON/i,
    );
    expect(denominatorAgg).toMatch(
      /WHERE m\.timestamp\s*>=\s*d\.timestamp AND m\.timestamp\s*<=/i,
    );
    expect(denominatorCapPopulation).toMatch(
      /SELECT COALESCE\(d\.value,\s*0\) AS value/i,
    );
  });

  it.each(["uncapped", "absolute"] as const)(
    "does not materialize a denominator cap population for %s ratios",
    (mode) => {
      const cappingType = mode === "absolute" ? "absolute" : "";
      const sql = buildQuery(bigQueryDialect, {
        ignoreZeros: false,
        numeratorCappingType: cappingType,
        denominatorCappingType: cappingType,
      });

      expect(sql).not.toMatch(/__userDenominatorCapPopulation\s+AS\s*\(/i);
      expect(sql).not.toMatch(/__capValueDenominator\s+AS\s*\(/i);
      expect(getCteBody(sql, "__userDenominatorAgg")).toMatch(
        /FROM __distinctUsers d JOIN __denominator0 m ON/i,
      );
    },
  );

  it("does not materialize a denominator cap population for numerator-only capping", () => {
    const sql = buildQuery(bigQueryDialect, {
      ignoreZeros: false,
      denominatorCappingType: "",
    });

    expect(sql).toMatch(/__capValue\s+AS\s*\(/i);
    expect(sql).not.toMatch(/__userDenominatorCapPopulation\s+AS\s*\(/i);
    expect(sql).not.toMatch(/__capValueDenominator\s+AS\s*\(/i);
  });

  it("treats an omitted ignoreZeros setting as include zeros", () => {
    const sql = buildQuery(bigQueryDialect, { ignoreZeros: undefined });

    expect(sql).toMatch(/__userDenominatorCapPopulation\s+AS\s*\(/i);
    expect(getCteBody(sql, "__capValueDenominator")).not.toMatch(
      /value\s*!=\s*0/i,
    );
  });

  it.each([
    {
      name: "numerator only",
      numeratorIgnoreZeros: true,
      denominatorIgnoreZeros: false,
      hasDenominatorCapPopulation: true,
    },
    {
      name: "denominator only",
      numeratorIgnoreZeros: false,
      denominatorIgnoreZeros: true,
      hasDenominatorCapPopulation: false,
    },
  ])(
    "applies ignoreZeros independently when enabled for the $name",
    ({
      numeratorIgnoreZeros,
      denominatorIgnoreZeros,
      hasDenominatorCapPopulation,
    }) => {
      const sql = buildQuery(bigQueryDialect, {
        numeratorIgnoreZeros,
        denominatorIgnoreZeros,
      });
      const numeratorCap = getCteBody(sql, "__capValue");
      const denominatorCap = getCteBody(sql, "__capValueDenominator");

      expect(/value\s*!=\s*0/i.test(numeratorCap)).toBe(numeratorIgnoreZeros);
      expect(denominatorCap).toMatch(
        denominatorIgnoreZeros
          ? /FROM __userDenominatorAgg WHERE value IS NOT NULL AND value != 0/i
          : /FROM __userDenominatorCapPopulation WHERE value IS NOT NULL/i,
      );
      expect(/__userDenominatorCapPopulation\s+AS\s*\(/i.test(sql)).toBe(
        hasDenominatorCapPopulation,
      );
    },
  );

  it("does not join a missing numerator cap into denominator-only capped bandit queries", () => {
    const sql = buildQuery(bigQueryDialect, {
      ignoreZeros: false,
      numeratorCappingType: "",
      bandit: true,
    });
    const banditStatistics = getCteBody(sql, "__banditPeriodStatistics");
    const denominatorCap = getCteBody(sql, "__capValueDenominator");

    expect(denominatorCap).toMatch(
      /FROM __userDenominatorCapPopulation WHERE value IS NOT NULL/i,
    );
    expect(banditStatistics).toMatch(/CROSS JOIN __capValueDenominator capd/i);
    expect(sql).not.toMatch(/__capValue\s+AS\s*\(/i);
    expect(banditStatistics).not.toMatch(/CROSS JOIN __capValue cap\b/i);
  });

  it.each([
    {
      name: "numerator-only",
      denominatorCappingType: "" as const,
      hasDenominatorCap: false,
    },
    {
      name: "dual-capped",
      denominatorCappingType: "percentile" as const,
      hasDenominatorCap: true,
    },
  ])(
    "joins the numerator cap into $name bandit queries",
    ({ denominatorCappingType, hasDenominatorCap }) => {
      const sql = buildQuery(bigQueryDialect, {
        ignoreZeros: false,
        denominatorCappingType,
        bandit: true,
      });
      const banditStatistics = getCteBody(sql, "__banditPeriodStatistics");

      expect(sql).toMatch(/__capValue\s+AS\s*\(/i);
      expect(banditStatistics).toMatch(/CROSS JOIN __capValue cap\b/i);
      expect(
        /CROSS JOIN __capValueDenominator capd\b/i.test(banditStatistics),
      ).toBe(hasDenominatorCap);
    },
  );
});
