import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import { Dimension } from "shared/types/integrations";
import Postgres from "back-end/src/integrations/Postgres";
import { factTableFactory } from "../factories/FactTable.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

const exposureQuery: ExposureQuery = {
  id: "exposure",
  name: "Exposure",
  description: "",
  query: "*",
  userIdType: "user_id",
  dimensions: [],
};

const factTable = factTableFactory.build({
  id: "ft_events",
  name: "Events",
  sql: "SELECT * FROM events",
  userIdTypes: ["user_id"],
});

const metric = factMetricFactory.build({
  id: "fact_amount",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "amount", aggregation: "sum" },
});

const baseSettings: ExperimentSnapshotSettings = {
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
  regressionAdjustmentEnabled: false,
  attributionModel: "firstExposure",
  experimentId: "exp_1",
  queryFilter: "",
  segment: "",
  skipPartialData: false,
  datasourceId: "ds_1",
  exposureQueryId: "exposure",
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-02-01"),
  variations: [],
};

// @ts-expect-error -- context not needed for this unit test
const integration = new Postgres("", {
  type: "postgres",
  settings: { queries: { exposure: [exposureQuery] } },
});

function buildSql(
  dimensionsForAnalysis: Dimension[],
  settings: ExperimentSnapshotSettings = baseSettings,
) {
  return integration.getIncrementalRefreshStatisticsQuery({
    settings,
    exposureQuery: { query: "*", identifierType: "user_id" },
    activationMetric: null,
    dimensionsForPrecomputation: [],
    dimensionsForAnalysis,
    factTableMap: new Map([["ft_events", factTable]]),
    metricSources: [
      { factTableId: "ft_events", tableFullName: "metric_source" },
    ],
    unitsSourceTableFullName: "units",
    metrics: [metric],
    lastMaxTimestamp: null,
  });
}

function cte(sql: string, name: string): string {
  const start = sql.indexOf(`${name} AS (`);
  expect(start).toBeGreaterThan(0);
  const end = sql.indexOf(" AS (", start + name.length + 5);
  // The formatter's line breaks aren't what's under test
  return sql
    .slice(start, end)
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")");
}

describe("incremental refresh statistics query experiment dimensions", () => {
  it("caps an unsliced dimension to its top values ranked over the units table", () => {
    const sql = buildSql([{ type: "experiment", id: "country" }]);

    const top = cte(sql, "__dimTop_country");
    expect(top).toMatch(/COUNT\(DISTINCT e\.user_id\) AS units/i);
    expect(top).toMatch(/FROM\s+units e/);
    expect(top).toMatch(/rn <= 18/);

    const units = cte(sql, "__experimentUnits");
    expect(units).toMatch(
      /LEFT JOIN __dimTop_country __dimTop_country ON \(__dimTop_country\.dimension_value = CAST\(e\.dim_exp_country AS VARCHAR\)\)/i,
    );
    expect(units).toMatch(
      /WHEN __dimTop_country\.dimension_value IS NULL AND e\.dim_exp_country IS NOT NULL THEN CAST\('__Other__' AS VARCHAR\) ELSE CAST\(e\.dim_exp_country AS VARCHAR\) END\) AS dim_exp_country/i,
    );
  });

  it("ranks only the units the statistics query analyzes", () => {
    const sql = buildSql([{ type: "experiment", id: "country" }], {
      ...baseSettings,
      skipPartialData: true,
    });
    expect(cte(sql, "__dimTop_country")).toMatch(
      /WHERE e\.first_exposure_timestamp <= '2024-02-01 00:00:00' AND e\.dim_exp_country IS NOT NULL/,
    );
  });

  it("buckets a sliced dimension by its slices instead of ranking it", () => {
    const sql = buildSql([
      { type: "experiment", id: "country", specifiedSlices: ["US", "CA"] },
    ]);
    expect(sql).not.toContain("__dimTop_country");
    expect(cte(sql, "__experimentUnits")).toMatch(
      /WHEN CAST\(e\.dim_exp_country AS VARCHAR\) IN \('US', 'CA'\) THEN CAST\(e\.dim_exp_country AS VARCHAR\) ELSE CAST\('__Other__' AS VARCHAR\)/i,
    );
  });

  it("builds a combo from the capped constituent", () => {
    const sql = buildSql([
      {
        type: "combo",
        dimensions: [
          { type: "experiment", id: "country" },
          { type: "experiment", id: "browser", specifiedSlices: ["Chrome"] },
        ],
      },
    ]);
    expect(sql).toContain("__dimTop_country AS (");
    expect(sql).not.toContain("__dimTop_browser");
    // The combo reads the already-capped alias from the units CTE
    expect(cte(sql, "__experimentUnitsFinal")).toMatch(
      /COALESCE\(CAST\(dim_exp_country AS VARCHAR\), '__NULL_DIMENSION'\)/i,
    );
  });
});
