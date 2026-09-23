import {
  getPipelineValidationCreateTableQuery,
  getPipelineValidationInsertQuery,
} from "shared/enterprise";
import { ExposureQuery } from "shared/types/datasource";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import Redshift from "back-end/src/integrations/Redshift";
import { factTableFactory } from "../factories/FactTable.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

// Every rule below comes from the AWS Redshift developer guide. None of this
// SQL has run on a real Redshift, so these assertions are the only guard.

const factTable = factTableFactory.build({
  id: "ft_events",
  sql: "SELECT * FROM events",
  userIdTypes: ["user_id"],
});
const factTableMap = new Map([["ft_events", factTable]]);

const sumMetric = factMetricFactory.build({
  id: "fact_sum",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "amount", aggregation: "sum" },
});
const countDistinctMetric = factMetricFactory.build({
  id: "fact_cd",
  metricType: "mean",
  numerator: {
    factTableId: "ft_events",
    column: "order_id",
    aggregation: "count distinct",
  },
});
const raMetric = factMetricFactory.build({
  id: "fact_ra",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "amount", aggregation: "sum" },
  regressionAdjustmentEnabled: true,
});
const metrics = [sumMetric, countDistinctMetric, raMetric];

const exposureQuery: ExposureQuery = {
  id: "exposure",
  name: "Exposure",
  description: "",
  query: "SELECT * FROM exposures",
  userIdType: "user_id",
  dimensions: ["country"],
};
const resolvedExposureQuery = {
  query: exposureQuery.query,
  userIdType: exposureQuery.userIdType,
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
    stddev: 0,
  },
  regressionAdjustmentEnabled: true,
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

const watermark = new Date("2024-01-10T12:00:00.999Z");
const unitsTable = "analytics.gb_units_exp_1";
const unitsTempTable = "analytics.gb_units_exp_1_tmp";
const metricSourceTable = "analytics.gb_metric_source";
const covariateTable = "analytics.gb_metric_source_covariate";
const aggregatedTable = "analytics.gb_aggregated_ft_events_user_id";

// @ts-expect-error -- context not needed for this unit test
const redshift = new Redshift("", {
  type: "redshift",
  settings: { queries: { exposure: [exposureQuery] } },
});

const unitsParams = {
  settings,
  exposureQuery: resolvedExposureQuery,
  activationMetric: null,
  dimensions: [{ type: "experiment" as const, id: "country" }],
  factTableMap,
  unitsTableFullName: unitsTable,
};
const covariateInsertParams = {
  settings,
  exposureQuery: resolvedExposureQuery,
  activationMetric: null,
  factTableMap,
  factTableId: "ft_events",
  metricSourceCovariateTableFullName: covariateTable,
  unitsSourceTableFullName: unitsTable,
  metrics: [raMetric],
  lastCovariateSuccessfulMaxTimestamp: watermark,
};

const ddl: Record<string, string> = {
  "units create":
    redshift.getCreateExperimentIncrementalUnitsQuery(unitsParams),
  "metric source create": redshift.getCreateMetricSourceTableQuery({
    settings,
    exposureQuery: resolvedExposureQuery,
    factTableId: "ft_events",
    metrics,
    factTableMap,
    metricSourceTableFullName: metricSourceTable,
  }),
  "covariate create": redshift.getCreateMetricSourceCovariateTableQuery({
    settings,
    exposureQuery: resolvedExposureQuery,
    factTableId: "ft_events",
    metrics: [raMetric],
    metricSourceCovariateTableFullName: covariateTable,
  }),
  "aggregated fact table create": redshift.getCreateAggregatedFactTableQuery({
    factTableId: "ft_events",
    idType: "user_id",
    metrics,
    tableFullName: aggregatedTable,
  }),
};

const inserts: Record<string, string> = {
  "metric source insert": redshift.getInsertMetricSourceDataQuery({
    settings,
    exposureQuery: resolvedExposureQuery,
    activationMetric: null,
    factTableMap,
    factTableId: "ft_events",
    metricSourceTableFullName: metricSourceTable,
    unitsSourceTableFullName: unitsTable,
    metrics,
    lastMaxTimestamp: watermark,
    incrementalRefreshStartTime: settings.endDate,
  }),
  "covariate insert": redshift.getInsertMetricSourceCovariateDataQuery({
    ...covariateInsertParams,
    alignLegacyScanToDailyGrain: false,
  }),
  "covariate insert from aggregated fact table":
    redshift.getInsertMetricSourceCovariateFromAggregatedFactTableQuery({
      ...covariateInsertParams,
      aggregatedTableFullName: aggregatedTable,
      idType: "user_id",
    }),
  "aggregated fact table insert":
    redshift.getInsertAggregatedFactTableDataQuery({
      factTable,
      idType: "user_id",
      metrics,
      tableFullName: aggregatedTable,
      windowStartDate: watermark,
      exclusiveStart: true,
      windowEndDate: new Date("2024-01-15"),
    }),
};

const maxTimestamps: Record<string, string> = {
  "units max timestamp": redshift.getMaxTimestampIncrementalUnitsQuery({
    unitsTableFullName: unitsTable,
    lastMaxTimestamp: null,
  }),
  "metric source max timestamp": redshift.getMaxTimestampMetricSourceQuery({
    metricSourceTableFullName: metricSourceTable,
    lastMaxTimestamp: null,
  }),
  "aggregated fact table max timestamp":
    redshift.getAggregatedFactTableMaxTimestampQuery({
      tableFullName: aggregatedTable,
      scanStartDate: new Date("2024-01-01"),
    }),
};

const queries: Record<string, string> = {
  ...ddl,
  ...inserts,
  ...maxTimestamps,
  "units update": redshift.getUpdateExperimentIncrementalUnitsQuery({
    ...unitsParams,
    segment: null,
    incrementalRefreshStartTime: new Date("2024-01-15"),
    lastMaxTimestamp: watermark,
    unitsTempTableFullName: unitsTempTable,
  }),
  "units drop": redshift.getDropOldIncrementalUnitsQuery({
    unitsTableFullName: unitsTable,
  }),
  "units rename": redshift.getAlterNewIncrementalUnitsQuery({
    unitsTableName: "gb_units_exp_1",
    unitsTableFullName: unitsTable,
    unitsTempTableFullName: unitsTempTable,
  }),
  statistics: redshift.getIncrementalRefreshStatisticsQuery({
    settings,
    exposureQuery: resolvedExposureQuery,
    activationMetric: null,
    dimensionsForPrecomputation: [],
    dimensionsForAnalysis: [],
    factTableMap,
    metricSources: [
      {
        factTableId: "ft_events",
        tableFullName: metricSourceTable,
        covariateTableFullName: covariateTable,
      },
    ],
    unitsSourceTableFullName: unitsTable,
    metrics,
    lastMaxTimestamp: watermark,
  }),
  "pipeline validation create": getPipelineValidationCreateTableQuery({
    tableFullName: "analytics.gb_units_validation_abcde",
    integration: redshift,
  }),
  "pipeline validation insert": getPipelineValidationInsertQuery({
    tableFullName: "analytics.gb_units_validation_abcde",
    integration: redshift,
  }),
};

describe("Redshift incremental refresh SQL", () => {
  const all = Object.entries(queries);

  it.each(all)(
    "%s: no CREATE OR REPLACE TABLE, which Redshift lacks",
    (_, sql) => {
      expect(sql).not.toMatch(/\bOR\s+REPLACE\s+TABLE\b/i);
    },
  );

  it.each(all)(
    "%s: no CURRENT_TIMESTAMP, which is leader-node only",
    (_, sql) => {
      expect(sql).not.toMatch(/\bCURRENT_TIMESTAMP\b/i);
    },
  );

  it.each(all)("%s: no bare DOUBLE, which is not a type", (_, sql) => {
    expect(sql).not.toMatch(/\bDOUBLE\b(?!\s+PRECISION)/i);
  });

  it.each(Object.entries(ddl))(
    "%s: no bare VARCHAR column, which defaults to VARCHAR(256)",
    (_, sql) => {
      expect(sql).toMatch(/\bVARCHAR\(65535\)/);
      expect(sql).not.toMatch(/\bVARCHAR\b(?!\()/i);
    },
  );

  it.each([
    ["metric source create", ddl["metric source create"]],
    ["aggregated fact table create", ddl["aggregated fact table create"]],
  ])("%s: stores count distinct as HLLSKETCH", (_, sql) => {
    expect(sql).toMatch(/\bfact_cd_value HLLSKETCH\b/);
  });

  it.each(Object.entries(inserts))(
    "%s: aliases the derived table it selects from",
    (_, sql) => {
      expect(sql).toMatch(/^SELECT\s+\*\s+FROM\s+\(/m);
      expect(sql).toMatch(/\) __insertRows\s*$/);
    },
  );

  it.each(Object.entries(maxTimestamps))(
    "%s: prints the watermark at microsecond precision",
    (_, sql) => {
      expect(sql).toContain(
        "to_char(MAX(max_timestamp), 'YYYY-MM-DD HH24:MI:SS.US') AS max_timestamp_raw",
      );
    },
  );
});
