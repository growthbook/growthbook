import fs from "fs";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import cloneDeep from "lodash/cloneDeep";
import { DataSourceInterface, DataSourceType } from "../../types/datasource";
import {
  AttributionModel,
  ExperimentInterface,
  ExperimentPhase,
  MetricOverride,
  Variation,
} from "../../types/experiment";
import { SegmentInterface } from "../../types/segment";
import { Dimension } from "../../src/types/Integration";
import { MetricInterface, MetricType } from "../../types/metric";
import { getSourceIntegrationObject } from "../../src/services/datasource";
import { getSnapshotSettings } from "../../src/services/experiments";
import { expandDenominatorMetrics } from "../../src/util/sql";
import {
  FactFilterInterface,
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "../../types/fact-table";

const currentDate = new Date();
const endDateString = "2022-02-01T00:00:00"; // premature end date to ensure some filter
const startDate = new Date(endDateString);
startDate.setDate(startDate.getDate() - 90); // its ok if start date is "too early" for sample data
const endDate = new Date(endDateString); // but end it a bit early so we know it is actually filtering

const USER_ID_TYPE = "user_id";
const OUTPUT_DIR = "/tmp/json";

// helper methods
function buildInterface(engine: string): DataSourceInterface {
  const engineInterface: DataSourceInterface = {
    id: "",
    name: "",
    description: "",
    organization: "",
    dateCreated: null,
    dateUpdated: null,
    params: "",
    settings: {
      queries: {
        exposure: [
          {
            id: "user_id",
            name: "",
            userIdType: USER_ID_TYPE,
            query: `SELECT\nuserId as user_id,timestamp as timestamp,experimentId as experiment_id,variationId as variation_id,browser\nFROM ${
              engine === "bigquery" ? "sample." : ""
            }experiment_viewed`,
            dimensions: ["browser"],
          },
        ],
        identityJoins: [
          {
            ids: ["user_id", "anonymous_id"],
            query: `SELECT DISTINCT\nuserId as user_id,anonymousId as anonymous_id\nFROM ${
              engine === "bigquery" ? "sample." : ""
            }orders`,
          },
        ],
      },
    },
    type: engine as DataSourceType,
  };
  return engineInterface;
}

function buildDimension(
  exp: TestExperimentConfig,
  engine: string
): Dimension | null {
  if (!exp.dimensionType) {
    return null;
  }

  if (exp.dimensionType == "experiment" && exp.dimensionMetric) {
    return { id: exp.dimensionMetric, type: "experiment" };
  } else if (exp.dimensionType == "user" && exp.dimensionMetric) {
    return {
      type: "user",
      dimension: {
        id: exp.dimensionMetric,
        organization: "",
        owner: "",
        datasource: "",
        userIdType: USER_ID_TYPE,
        name: exp.dimensionMetric,
        // lazy way to build user table
        sql: `SELECT DISTINCT userId AS user_id, ${
          exp.dimensionMetric
        } AS value FROM ${engine === "bigquery" ? "sample." : ""}orders`,
        dateCreated: null,
        dateUpdated: null,
      },
    };
  } else if (exp.dimensionType == "activation") {
    return { type: "activation" };
  } else if (exp.dimensionType == "date") {
    return { type: "date" };
  } else if (exp.dimensionType == "datecumulative") {
    return { type: "datecumulative" };
  } else {
    throw "invalid dimensionType and or dimensionMetric specified";
  }
}

function buildSegment(
  exp: TestExperimentConfig,
  engine: string
): SegmentInterface | null {
  if (exp.segment) {
    return {
      id: exp.segment,
      organization: "",
      owner: "",
      datasource: "",
      userIdType: USER_ID_TYPE,
      name: exp.segment,
      sql: `SELECT DISTINCT\nuserId as user_id,CAST('2022-01-01' AS DATE) as date\nFROM ${
        engine === "bigquery" ? "sample." : ""
      }experiment_viewed\nWHERE browser = 'Chrome'`,
      dateCreated: currentDate,
      dateUpdated: currentDate,
    };
  } else {
    return null;
  }
}

function addDatabaseToMetric(metric: MetricInterface): MetricInterface {
  const newMetric = { ...metric };
  newMetric.sql = newMetric.sql?.replace("FROM ", "FROM sample.");
  return newMetric;
}

// IMPORT AND BUILD TEST METRICS metricConfigs

// classic metrics
type TestMetricConfig = {
  id: string;
  type: MetricType;
  ignoreNulls: boolean;
  sql: string;
  denominator?: string;
};
import metricConfigData from "./json/metrics.json";
const metricConfigs = metricConfigData as TestMetricConfig[];

// Pseudo-MetricInterface, missing the fields in TestMetricConfig
const baseMetric: Omit<
  MetricInterface,
  "id" | "type" | "ignoreNulls" | "sql"
> = {
  organization: "",
  owner: "",
  datasource: "",
  name: "",
  conversionWindowHours: 72,
  conversionDelayHours: 0,
  description: "",
  inverse: false,
  dateCreated: null,
  dateUpdated: null,
  runStarted: null,
  userIdColumns: { user_id: "user_id", anonymous_id: "anonymous_id" },
  queries: [],
  aggregation: "",
  table: "",
  column: "",
  timestampColumn: "",
  conditions: [],
  queryFormat: "sql" as const,
};

const allActivationMetrics: MetricInterface[] = [
  {
    ...baseMetric,
    id: "cart_loaded",
    type: "binomial",
    ignoreNulls: false,
    sql:
      "SELECT\nuserId as user_id,\ntimestamp as timestamp\nFROM events\nWHERE event = 'Cart Loaded'",
  },
  {
    ...baseMetric,
    id: "cart_loaded_anonymous",
    userIdTypes: ["anonymous_id"],
    type: "binomial",
    ignoreNulls: false,
    sql:
      "SELECT\nanonymousId as anonymous_id,\ntimestamp as timestamp\nFROM events\nWHERE event = 'Cart Loaded'",
  },
];

// Build full metric objects
const analysisMetrics: MetricInterface[] = metricConfigs.map(
  (metricConfig) => ({ ...baseMetric, ...metricConfig })
);

// fact metrics
type ColumnConfig = Pick<ColumnInterface, "name" | "column">;
type FilterConfig = Pick<FactFilterInterface, "id" | "value">;

import columnConfigData from "./json/columns.json";
const columns: ColumnInterface[] = (columnConfigData as ColumnConfig[]).map(
  (f) => ({
    dateCreated: new Date(),
    dateUpdated: new Date(),
    numberFormat: "",
    datatype: "number",
    autoDetected: false,
    description: "",
    filters: [],
    deleted: false,
    ...f,
  })
);

import filterConfigData from "./json/filters.json";
const filters: FactFilterInterface[] = (filterConfigData as FilterConfig[]).map(
  (f) => ({
    dateCreated: new Date(),
    dateUpdated: new Date(),
    description: "",
    name: f.id,
    ...f,
  })
);

import factMetricConfigData from "./json/fact-metrics.json";
type FactMetricConfig = Pick<
  FactMetricInterface,
  "id" | "metricType" | "numerator"
>;
const factMetricConfigs = factMetricConfigData as FactMetricConfig[];
const baseFactMetric: Omit<
  FactMetricInterface,
  "id" | "metricType" | "numerator"
> = {
  organization: "",
  owner: "",
  datasource: "",
  name: "",
  description: "",
  projects: [],
  tags: [],

  dateCreated: new Date(),
  dateUpdated: new Date(),

  winRisk: 0,
  loseRisk: 0,
  maxPercentChange: 0,
  minPercentChange: 0,
  minSampleSize: 0,

  inverse: false,

  // defaults that can be overriden in fact-metrics.json
  denominator: null,

  conversionDelayHours: 0,
  hasConversionWindow: true,
  conversionWindowValue: 72,
  conversionWindowUnit: "hours",

  regressionAdjustmentDays: 14,
  regressionAdjustmentEnabled: false,
  regressionAdjustmentOverride: false,

  capValue: 0,
  capping: "",
};

const analysisFactMetrics: FactMetricInterface[] = factMetricConfigs.map(
  (factMetricConfig) => ({ ...baseFactMetric, ...factMetricConfig })
);

type FactTableConfig = Pick<FactTableInterface, "id" | "sql">;
import factTableConfigData from "./json/fact-tables.json";
const factTables: FactTableInterface[] = (factTableConfigData as FactTableConfig[]).map(
  (partialFactTable) => ({
    organization: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: partialFactTable.id,
    description: "",
    owner: "",
    projects: [],
    tags: [],
    datasource: "",
    eventName: "",
    userIdTypes: ["user_id", "anonymous_id"],
    columns: columns.filter((f) => f.name.startsWith(partialFactTable.id)),
    filters: filters.filter((f) => f.id.startsWith(partialFactTable.id)),
    ...partialFactTable,
  })
);

// BUILD METRIC MAPS
const metricMap = new Map<string, MetricInterface>();
analysisMetrics.forEach((m) => metricMap.set(m.id, m));
allActivationMetrics.forEach((m) => metricMap.set(m.id, m));

const factMetricMap = new Map(analysisFactMetrics.map((m) => [m.id, m]));

// IMPORT AND BUILD TEST EXPERIMENTS
import experimentConfigData from "./json/experiments.json";

type DimensionType =
  | "user"
  | "experiment"
  | "date"
  | "datecumulative"
  | "activation";
type TestExperimentConfig = {
  id: string;
  dimensionType?: DimensionType;
  dimensionMetric?: string;
  attributionModel: AttributionModel;
  segment?: string;
  queryFilter?: string;
  removeMultiplxposures?: boolean;
  metricOverrides?: MetricOverride[];
  guardrails?: string[];
};
const experimentConfigs = experimentConfigData as TestExperimentConfig[];

const baseExperimentPhase: ExperimentPhase = {
  dateStarted: startDate,
  dateEnded: endDate,
  name: "Main",
  reason: "",
  coverage: 1,
  variationWeights: [0.34, 0.33, 0.33],
  condition: "",
  namespace: {
    enabled: false,
    name: "",
    range: [0, 1],
  },
};

const baseExperiment: ExperimentInterface = {
  id: "BASE_ID_TO_BE_REPLACED",
  metrics: [],
  exposureQueryId: USER_ID_TYPE,
  hashAttribute: "",
  hashVersion: 2,
  releasedVariationId: "",
  trackingKey: "checkout-layout",
  datasource: "",
  organization: "",
  name: "",
  dateCreated: currentDate,
  dateUpdated: currentDate,
  owner: "",
  implementation: "code" as const,
  previewURL: "",
  status: "stopped" as const, // maybe needs to be 'running' for the conversion window trimming?
  tags: [],
  autoAssign: false,
  targetURLRegex: "",
  variations: [
    { name: "Control", key: "0", id: "0" },
    { name: "Variation 1", key: "1", id: "1" },
    { name: "Variation 2", key: "2", id: "2" },
  ] as Variation[],
  archived: false,
  phases: [baseExperimentPhase],
  autoSnapshots: false,
};

// All SQL DB engines are listed here
const engines: DataSourceType[] = [
  "bigquery",
  "postgres",
  "snowflake",
  "redshift",
  "athena",
  "presto",
  "databricks",
  "mysql",
  "mssql",
  "clickhouse",
];

// Output to store queries in
const testCases: { name: string; engine: string; sql: string }[] = [];

engines.forEach((engine) => {
  // TODO: get integration object
  const engineInterface = buildInterface(engine);
  const integration = getSourceIntegrationObject(engineInterface);

  experimentConfigs.forEach((experimentConfig) => {
    const experiment: ExperimentInterface = {
      ...baseExperiment,
      ...experimentConfig,
    };
    const jointMetrics: ExperimentMetricInterface[] = [
      ...analysisMetrics,
      ...analysisFactMetrics,
    ];
    jointMetrics.forEach((metric) => {
      experiment.metrics = [metric.id];
      // if override in experiment config, have to set it to the right id
      let denominatorMetrics: MetricInterface[] = [];
      let activationMetric: MetricInterface | null = null;
      if (experiment.activationMetric) {
        activationMetric =
          allActivationMetrics.find(
            (m) => m.id === experiment.activationMetric
          ) ?? null;
      }
      if (experiment.metricOverrides) {
        experiment.metricOverrides[0].id = metric.id;
      }
      if (!isFactMetric(metric) && metric.denominator) {
        denominatorMetrics.push(
          ...expandDenominatorMetrics(metric.denominator, metricMap)
            .map((m) => metricMap.get(m) as MetricInterface)
            .filter(Boolean)
        );
      }

      const factTablesCopy = cloneDeep<FactTableInterface[]>(factTables);
      if (engine === "bigquery") {
        if (activationMetric) {
          activationMetric = addDatabaseToMetric(activationMetric);
        }
        denominatorMetrics = denominatorMetrics.map(addDatabaseToMetric);
        if (isFactMetric(metric)) {
          factTablesCopy.forEach(
            (ft) => (ft.sql = ft.sql?.replace("FROM ", "FROM sample."))
          );
        } else {
          metric = addDatabaseToMetric(metric);
        }
      }
      const factTableMap = new Map(factTablesCopy.map((f) => [f.id, f]));

      const dimension: Dimension | null = buildDimension(
        experimentConfig,
        engine
      );
      const segment: SegmentInterface | null = buildSegment(
        experimentConfig,
        engine
      );

      let dimensionId = "";
      if (dimension) {
        if (dimension.type === "experiment") {
          dimensionId = "exp:" + dimension.id;
        } else if (dimension.type === "activation") {
          dimensionId = "pre:activation";
        } else if (dimension.type === "date") {
          dimensionId = "pre:date";
        } else if (dimension.type === "datecumulative") {
          dimensionId = "pre:datecumulative";
        } else if (dimension.type === "datedaily") {
          dimensionId = "pre:datedaily";
        } else {
          dimensionId = dimension.dimension.id;
        }
      }

      const snapshotSettings = getSnapshotSettings({
        experiment,
        phaseIndex: 0,
        settings: {
          dimensions: dimensionId ? [dimensionId] : [],
          differenceType: "relative",
          statsEngine: "frequentist",
          pValueCorrection: null,
          regressionAdjusted: metric.regressionAdjustmentEnabled ?? false,
          sequentialTesting: false,
          sequentialTestingTuningParameter: 0,
        },
        metricRegressionAdjustmentStatuses: [
          {
            metric: metric.id,
            reason: "",
            regressionAdjustmentEnabled:
              metric.regressionAdjustmentEnabled ?? false,
            regressionAdjustmentDays: metric.regressionAdjustmentDays ?? 0,
          },
        ],
        metricMap: isFactMetric(metric) ? factMetricMap : metricMap,
      });

      // non-pipeline version
      const sql = integration.getExperimentMetricQuery({
        settings: snapshotSettings,
        metric: metric,
        activationMetric: activationMetric,
        denominatorMetrics: denominatorMetrics,
        factTableMap: factTableMap,
        dimensions: dimension ? [dimension] : [],
        segment: segment,
        useUnitsTable: false,
      });

      testCases.push({
        name: `${engine} > ${experiment.id} > ${metric.id}`,
        engine: engine,
        sql: sql,
      });

      // pipeline version
      const pipelineEnabled = ["bigquery", "snowflake"];
      if (pipelineEnabled.includes(engine)) {
        const unitsTableFullName = `${
          engine === "bigquery" ? "sample." : ""
        }growthbook_tmp_units_${experiment.id}_${metric.id}`;
        const unitsSql = integration.getExperimentUnitsTableQuery({
          settings: snapshotSettings,
          activationMetric: activationMetric,
          factTableMap: factTableMap,
          dimensions: dimension ? [dimension] : [],
          segment: segment,
          unitsTableFullName: unitsTableFullName,
          includeIdJoins: true,
        });
        const metricSql = integration.getExperimentMetricQuery({
          settings: snapshotSettings,
          metric: metric,
          activationMetric: activationMetric,
          denominatorMetrics: denominatorMetrics,
          factTableMap: factTableMap,
          dimensions: dimension ? [dimension] : [],
          segment: segment,
          useUnitsTable: true,
          unitsTableFullName: unitsTableFullName,
        });

        // just prepend units table creation (rather than queueing jobs)
        testCases.push({
          name: `${engine} > ${experiment.id}_pipeline > ${metric.id}`,
          engine: engine,
          sql: unitsSql.concat(metricSql),
        });
      }
    });
  });
});

console.log(`Writing queries.json to '${OUTPUT_DIR}'...`);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(`${OUTPUT_DIR}/queries.json`, JSON.stringify(testCases));
