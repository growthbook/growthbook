import { ExposureQuery } from "shared/types/datasource";
import {
  CompoundFactMetricInterface,
  FactMetricInterface,
} from "shared/types/fact-table";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import { bigQueryDialect } from "shared/dialects";
import BigQuery from "back-end/src/integrations/BigQuery";
import { getExperimentFactMetricsQuery } from "back-end/src/integrations/sql/queries/experiment-fact-metrics-query";
import { getInsertMetricSourceCovariateDataLegacyQuery } from "back-end/src/integrations/sql/queries/insert-metric-source-covariate-data-legacy-query";
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
  sql: "SELECT user_id, timestamp, event_name FROM events",
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
const factTableMap = new Map([
  [eventsFactTable.id, eventsFactTable],
  [ordersFactTable.id, ordersFactTable],
]);

// @ts-expect-error -- context is not needed to read `.datasource`
const bqIntegration = new BigQuery("", {
  type: "bigquery",
  settings: { queries: { exposure: [testExposureQuery] } },
});

const eventFilter = (value: string) => [
  { column: "event_name", operator: "=" as const, values: [value] },
];

function buildCompoundMetric(
  components: CompoundFactMetricInterface["compoundSettings"]["components"],
  overrides: Partial<CompoundFactMetricInterface> = {},
): CompoundFactMetricInterface {
  return {
    ...factMetricFactory.build({ id: "fact__compound" }),
    name: "Viewed pricing and ordered",
    metricType: "compound",
    numerator: null,
    funnelSettings: null,
    compoundSettings: { components },
    ...overrides,
  };
}

const crossTableCompound = buildCompoundMetric([
  { factTableId: "events", rowFilters: eventFilter("view_pricing") },
  { factTableId: "orders", rowFilters: [] },
]);

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

function buildSql(metrics: FactMetricInterface[]): string {
  return getExperimentFactMetricsQuery(
    bigQueryDialect,
    bqIntegration.datasource,
    {
      settings,
      unitsSource: "exposureQuery",
      unitsSettings: buildUnitsQuerySettingsFromSnapshot(settings, {
        query: testExposureQuery.query,
        identifierType: testExposureQuery.userIdType,
      }),
      activationMetric: null,
      dimensions: [],
      segment: null,
      metrics,
      factTableMap,
    },
  );
}

const flatten = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("compound fact metric SQL", () => {
  it("counts each component per unit and passes units that matched all of them", () => {
    const sql = flatten(buildSql([crossTableCompound]));

    // One 0/1 column per component, on the component's own fact table.
    expect(sql).toContain("THEN 1 ELSE 0 END AS m0_c0");
    expect(sql).toContain("1 AS m0_c1");
    // Summed per unit, per source.
    expect(sql).toContain("SUM(umj.m0_c0) AS m0_c0");
    expect(sql).toContain("SUM(umj.m0_c1) AS m0_c1");
    // The pass test reads each component from its own source.
    expect(sql).toContain(
      "SUM( CAST( CASE WHEN m.m0_c0 >= 1 AND m1.m0_c1 >= 1 THEN 1 ELSE 0 END AS FLOAT64 ) ) AS m0_main_sum",
    );
    expect(sql).toContain("LEFT JOIN __userMetricAgg1 m1");
    // Descriptive per-component unit counts for the drilldown.
    expect(sql).toContain(
      "SUM( CASE WHEN m.m0_c0 >= 1 THEN 1 ELSE 0 END ) AS m0_c0_units",
    );
    expect(sql).toContain(
      "SUM( CASE WHEN m1.m0_c1 >= 1 THEN 1 ELSE 0 END ) AS m0_c1_units",
    );
    expect(sql).not.toContain("m0_value");
  });

  it("emits a covariate pass test when CUPED is on", () => {
    const sql = flatten(
      buildSql([
        buildCompoundMetric(crossTableCompound.compoundSettings.components, {
          regressionAdjustmentOverride: true,
          regressionAdjustmentEnabled: true,
          regressionAdjustmentDays: 14,
        }),
      ]),
    );

    expect(sql).toContain("SUM(umj.m0_covariate_c1) AS m0_covariate_c1");
    expect(sql).toContain(
      "CASE WHEN m.m0_covariate_c0 >= 1 AND m1.m0_covariate_c1 >= 1 THEN 1 ELSE 0 END",
    );
    expect(sql).toContain("AS m0_covariate_sum");
  });

  it("reads single-table components from one source", () => {
    const sql = flatten(
      buildSql([
        buildCompoundMetric([
          { factTableId: "events", rowFilters: eventFilter("view_pricing") },
          { factTableId: "events", rowFilters: eventFilter("start_trial") },
        ]),
      ]),
    );

    expect(sql).toContain(
      "CASE WHEN m.m0_c0 >= 1 AND m.m0_c1 >= 1 THEN 1 ELSE 0 END",
    );
    expect(sql).not.toContain("__userMetricAgg1");
  });
});

describe("compound fact metric incremental refresh SQL", () => {
  const resolvedExposureQuery = {
    query: testExposureQuery.query,
    identifierType: testExposureQuery.userIdType,
  };
  const cachedCompound = buildCompoundMetric(
    crossTableCompound.compoundSettings.components,
    {
      id: "fact__cached",
      regressionAdjustmentOverride: true,
      regressionAdjustmentEnabled: true,
      regressionAdjustmentDays: 14,
    },
  );

  it("stores one integer count per component in its own fact table's cache", () => {
    const sql = flatten(
      bqIntegration.getCreateMetricSourceTableQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        factTableId: "orders",
        metrics: [cachedCompound],
        factTableMap,
        metricSourceTableFullName: "proj.ds.metric_source_orders",
      }),
    );
    expect(sql).toContain("fact__cached_c1 INT64");
    expect(sql).not.toContain("fact__cached_c0");
  });

  it("writes per-day component counts", () => {
    const sql = flatten(
      bqIntegration.getInsertMetricSourceDataQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        factTableMap,
        factTableId: "events",
        metricSourceTableFullName: "proj.ds.metric_source_events",
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [cachedCompound],
        lastMaxTimestamp: null,
        incrementalRefreshStartTime: endDate,
      }),
    );
    expect(sql).toContain("SUM(m0_c0) AS fact__cached_c0");
    expect(sql).toContain("fact__cached_c0 AS fact__cached_c0");
    expect(sql).not.toContain("m0_c1");
    expect(sql).not.toContain("_value");
  });

  it("writes pre-exposure component counts to the covariate cache", () => {
    const sql = flatten(
      getInsertMetricSourceCovariateDataLegacyQuery(
        bigQueryDialect,
        bqIntegration.datasource,
        {
          settings,
          exposureQuery: resolvedExposureQuery,
          activationMetric: null,
          factTableMap,
          factTableId: "orders",
          metricSourceCovariateTableFullName: "proj.ds.covariate_orders",
          unitsSourceTableFullName: "proj.ds.units",
          metrics: [cachedCompound],
          lastCovariateSuccessfulMaxTimestamp: null,
          alignLegacyScanToDailyGrain: false,
        },
      ),
    );
    expect(sql).toContain("(user_id, fact__cached_c1)");
    expect(sql).toContain("AS m0_covariate_c1");
    expect(sql).toContain("COALESCE(c.m0_covariate_c1, 0) AS fact__cached_c1");
    expect(sql).not.toContain("m0_c0");
  });

  it("merges days per unit and applies the pass test across caches", () => {
    const sql = flatten(
      bqIntegration.getIncrementalRefreshStatisticsQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        dimensionsForPrecomputation: [],
        dimensionsForAnalysis: [],
        factTableMap,
        metricSources: [
          {
            factTableId: "events",
            tableFullName: "proj.ds.metric_source_events",
            covariateTableFullName: "proj.ds.covariate_events",
          },
          {
            factTableId: "orders",
            tableFullName: "proj.ds.metric_source_orders",
            covariateTableFullName: "proj.ds.covariate_orders",
          },
        ],
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [cachedCompound],
        lastMaxTimestamp: null,
      }),
    );
    expect(sql).toContain("SUM(umj.fact__cached_c1) AS fact__cached_c1");
    expect(sql).toContain("m1.fact__cached_c1 AS m0_c1");
    expect(sql).toContain("MAX(fact__cached_c1) AS m0_covariate_c1");
    expect(sql).toContain(
      "CASE WHEN m.m0_c0 >= 1 AND m1.m0_c1 >= 1 THEN 1 ELSE 0 END",
    );
    expect(sql).toContain(
      "CASE WHEN m.m0_covariate_c0 >= 1 AND m1.m0_covariate_c1 >= 1 THEN 1 ELSE 0 END",
    );
  });
});
