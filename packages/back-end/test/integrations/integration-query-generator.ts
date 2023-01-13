import {
  DataSourceBase,
  DataSourceInterface,
  DataSourceType,
} from "../../types/datasource";
import {
  AttributionModel,
  ExperimentInterface,
  ExperimentPhase,
  Variation,
} from "../../types/experiment";
import { MetricInterface, MetricType } from "../../types/metric";
import { getSourceIntegrationObject } from "../../src/services/datasource";

const currentDate = new Date();

// import experimentOverrides
import experimentOverridesData from "./experiments.json";
interface ExperimentOverrideInterface {
  id: string;
  conversionWindowHours: number;
  conversionDelayHour: number;
  dimension: null;
  attributionModel: AttributionModel;
}
const experimentOverrides: ExperimentOverrideInterface[] = experimentOverridesData as ExperimentOverrideInterface[];

// import metricOverrides
import metricOverridesData from "./metrics.json";
interface MetricOverrideInterface {
  id: string;
  type: MetricType;
  ignoreNulls: boolean;
  sql: string;
  denominator?: string;
}
const metricOverrides: MetricOverrideInterface[] = metricOverridesData as MetricOverrideInterface[];

// TODO: list of all db engines
const engines: DataSourceType[] = [
  "bigquery",
  "postgres",
  "snowflake",
  "redshift",
  "athena",
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

// Pseudo-ExperimentInterface, missing following fields:
// id: string;
//  metricOverrides?: MetricOverride[];
//  guardrails?: string[];
//  activationMetric?: string;
//  removeMultipleExposures?: boolean;
//  segment?: string
//  queryFilter?: string
//  attributionModel?: AttributionModel;
// And we have "dimensions" which isn't a field in ExperimentInterface, but
// we're going to add it anyways
const baseExperiment = {
  metrics: metricOverrides.map((m) => m.id),
  exposureQueryId: "user_id",
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

// Pseudo-MetricInterface, missing following fields:
// id: string
// type: MetricType
// ignoreNulls: boolean
// sql: string
// denominator?: string  // this should be the `id` of the denominator
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
          userIdType: "",
          query:
            "SELECT\nuserid as user_id,timestamp as timestamp,experimentid as experiment_id,variationid as variation_id\nFROM experiment_viewed",
          dimensions: [],
        },
      ],
    },
  },
};

const testCases: { name: string; engine: string; sql: string }[] = [];

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
    metricOverrides.forEach((metricOverride) => {
      const metric = {
        ...baseMetric,
        ...metricOverride,
      };
      // TODO: actually apply following params
      const activationMetrics: MetricInterface[] = []; // [...];
      const denominatorMetrics: MetricInterface[] = []; // [...];
      const dimension = null; //: Dimension | null = {...};
      const segment = null; //: SegmentInterface | null = {...};

      // TODO: generate SQL
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
