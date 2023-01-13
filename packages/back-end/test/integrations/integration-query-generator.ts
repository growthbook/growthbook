import {
  DataSourceBase,
  DataSourceInterface,
  DataSourceType,
} from "../../types/datasource";
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
const USER_ID_TYPE = "user_id";

// import experimentOverrides
import experimentOverridesData from "./experiments.json";
type DimensionType = "user" | "experiment" | "date" | "activation";
type TestExperimentOverride = {
  id: string;
  conversionWindowHours: number;
  conversionDelayHour: number;
  dimensionType?: DimensionType;
  dimensionMetric?: string;
  attributionModel: AttributionModel;
  segment?: string;
  queryFilter?: string;
  removeMultiplxposures?: boolean;
  metricOverrides?: MetricOverride[];
  guardrails?: string[];
};
const experimentOverrides = experimentOverridesData as TestExperimentOverride[];

// import metricOverrides
import metricOverridesData from "./metrics.json";
type TestMetricOverride = {
  id: string;
  type: MetricType;
  ignoreNulls: boolean;
  sql: string;
  denominator?: string;
};
const metricOverrides = metricOverridesData as TestMetricOverride[];

// All SQL DB engines are listed here
const engines: DataSourceType[] = [
  "bigquery",
  "postgres",
  "snowflake",
  "redshift",
  "athena",
  "presto",
  "mysql",
  "mssql",
  "clickhouse",
];

const baseExperimentPhase: ExperimentPhase = {
  dateStarted: currentDate, // TODO: change date
  dateEnded: currentDate, // TODO: change date
  phase: "main",
  reason: "",
  coverage: 1,
  variationWeights: [0.34, 0.33, 0.33],
};

const baseExperiment: ExperimentInterface = {
  id: "BASE_ID_TO_BE_REPLACED",
  metrics: metricOverrides.map((m) => m.id),
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
};

const baseInterface: DataSourceBase = {
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
          query:
            "SELECT\nuserid as user_id,timestamp as timestamp,experimentid as experiment_id,variationid as variation_id\nFROM experiment_viewed",
          dimensions: [],
        },
      ],
    },
  },
};

// Pseudo-MetricInterface, missing the fields in TestMetricOverride
const baseMetric = {
  organization: "",
  owner: "",
  datasource: "",
  name: "",
  conversionWindowHours: 0,
  conversionDelayHours: 72,
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
      "SELECT\nuserId as user_id,\ntimestamp as timestamp\nFROM sample.events\nWHERE event = 'Cart Loaded'",
  },
];

// Build full metric objects
const analysisMetrics: MetricInterface[] = metricOverrides.map(
  (metricOverride) => ({ ...baseMetric, ...metricOverride })
);

const testCases: { name: string; engine: string; sql: string }[] = [];

function buildDimension(exp: TestExperimentOverride): Dimension | null {
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
        sql: `SELECT DISTINCT user_id, ${exp.dimensionMetric} FROM sample.orders`, // lazy way to build user table
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

function buildSegment(exp: TestExperimentOverride): SegmentInterface | null {
  if (exp.segment) {
    return {
      id: exp.segment,
      organization: "",
      owner: "",
      datasource: "",
      userIdType: USER_ID_TYPE,
      name: exp.segment,
      // TODO: fake date trunc just to avoid exporting dateTrunc from SqlIntegration
      sql: `SELECT DISTINCT\nuserid as user_id,'2022-01-01' as date\nFROM sample.experiment_viewed\nWHERE browser = 'Chrome'`,
      dateCreated: currentDate,
      dateUpdated: currentDate,
    };
  } else {
    return null;
  }
}

engines.forEach((engine) => {
  // TODO: get integration object
  const engineInterface: DataSourceInterface = {
    ...baseInterface,
    type: engine as DataSourceType,
  };
  const integration = getSourceIntegrationObject(engineInterface);

  experimentOverrides.forEach((experimentOverride) => {
    const experiment: ExperimentInterface = {
      ...baseExperiment,
      ...experimentOverride,
    };
    analysisMetrics.forEach((metric) => {
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

      const dimension: Dimension | null = buildDimension(experimentOverride);
      const segment: SegmentInterface | null = buildSegment(experimentOverride);

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

// TODO: output in a way to pass into Python script
console.log(JSON.stringify(testCases, null, 2));
