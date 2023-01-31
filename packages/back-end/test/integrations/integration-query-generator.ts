import fs from "fs";

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

const currentDate = new Date();
const endDateString = "2022-02-01T00:00:00"; // premature end date to ensure some filter
const startDate = new Date(endDateString);
startDate.setDate(startDate.getDate() - 90); // its ok if start date is "too early" for sample data
const endDate = new Date(endDateString); // but end it a bit early so we know it is actually filtering

const USER_ID_TYPE = "user_id";
const OUTPUT_DIR = "/tmp/json";

// import experimentConfigs
import experimentConfigData from "./experiments.json";
type DimensionType = "user" | "experiment" | "date" | "activation";
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
// missing following experiment config for now
// as it hangs on MySQL. May require fixing the actual
// query generated for this use case.
//  {
//   "id": "dimension_activation",
//   "dimensionType": "activation",
//   "activationMetric": "cart_loaded",
//   "attributionModel": "firstExposure"
// },

// import metricConfigs
import metricConfigData from "./metrics.json";
type TestMetricConfig = {
  id: string;
  type: MetricType;
  ignoreNulls: boolean;
  sql: string;
  denominator?: string;
};
const metricConfigs = metricConfigData as TestMetricConfig[];

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
  "databricks",
];

const baseExperimentPhase: ExperimentPhase = {
  dateStarted: startDate,
  dateEnded: endDate,
  phase: "main",
  reason: "",
  coverage: 1,
  variationWeights: [0.34, 0.33, 0.33],
};

const baseExperiment: ExperimentInterface = {
  id: "BASE_ID_TO_BE_REPLACED",
  metrics: metricConfigs.map((m) => m.id),
  exposureQueryId: USER_ID_TYPE,
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
    { name: "Control" },
    { name: "Variation 1" },
    { name: "Variation 2" },
  ] as Variation[],
  archived: false,
  phases: [baseExperimentPhase],
  autoSnapshots: false,
  removeMultipleExposures: true,
};

// Pseudo-MetricInterface, missing the fields in TestMetricConfig
const baseMetric = {
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
];

// Build full metric objects
const analysisMetrics: MetricInterface[] = metricConfigs.map(
  (metricConfig) => ({ ...baseMetric, ...metricConfig })
);

const testCases: { name: string; engine: string; sql: string }[] = [];

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
            query: `SELECT\nuserid as user_id,timestamp as timestamp,experimentid as experiment_id,variationid as variation_id,browser\nFROM ${
              engine === "bigquery" ? "sample." : ""
            }experiment_viewed`,
            dimensions: ["browser"],
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
      // TODO: fake date trunc just to avoid exporting dateTrunc from SqlIntegration
      sql: `SELECT DISTINCT\nuserid as user_id,DATE('2022-01-01') as date\nFROM ${
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

engines.forEach((engine) => {
  // TODO: get integration object
  const engineInterface = buildInterface(engine);
  const integration = getSourceIntegrationObject(engineInterface);

  experimentConfigs.forEach((experimentConfig) => {
    const experiment: ExperimentInterface = {
      ...baseExperiment,
      ...experimentConfig,
    };
    analysisMetrics.forEach((metric) => {
      // if override in experiment config, have to set it to the right id
      if (experiment.metricOverrides) {
        experiment.metricOverrides[0].id = metric.id;
      }

      let activationMetrics: MetricInterface[] = [];
      if (experiment.activationMetric) {
        activationMetrics = allActivationMetrics.filter(
          (m) => m.id === experiment.activationMetric
        );
      }
      let denominatorMetrics: MetricInterface[] = [];
      if (metric.denominator) {
        denominatorMetrics = analysisMetrics.filter(
          (m) => m.id === metric.denominator
        );
      }

      if (engine === "bigquery") {
        activationMetrics = activationMetrics.map(addDatabaseToMetric);
        denominatorMetrics = denominatorMetrics.map(addDatabaseToMetric);
        metric = addDatabaseToMetric(metric);
      }
      const dimension: Dimension | null = buildDimension(
        experimentConfig,
        engine
      );
      const segment: SegmentInterface | null = buildSegment(
        experimentConfig,
        engine
      );

      const sql = integration.getExperimentMetricQuery({
        experiment: experiment,
        phase: baseExperimentPhase,
        metric: metric,
        activationMetrics: activationMetrics,
        denominatorMetrics: denominatorMetrics,
        dimension: dimension,
        segment: segment,
      });

      testCases.push({
        name: `${engine} > ${experiment.id} > ${metric.id}`,
        engine: engine,
        sql: sql,
      });
    });
  });
});

console.log(`Writing queries.json to '${OUTPUT_DIR}'...`);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(`${OUTPUT_DIR}/queries.json`, JSON.stringify(testCases));
