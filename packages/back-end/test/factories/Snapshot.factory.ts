import { Factory } from "fishery";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";

export const snapshotFactory = Factory.define<ExperimentSnapshotInterface>(
  ({ sequence, params }) => ({
    id: `snp_${sequence}`,
    organization: params.organization ?? "org_1",
    experiment: `exp_${sequence}`,
    phase: 0,
    dimension: null,

    dateCreated: new Date(),
    runStarted: null,

    status: params.status ?? "success",
    settings: {
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
      experimentId: `exp_${sequence}`,
      queryFilter: "",
      segment: "",
      skipPartialData: false,
      datasourceId: "ds_1",
      exposureQueryId: "eq_1",
      startDate: new Date(),
      endDate: new Date(),
      variations: [],
    },
    type: params.type,
    triggeredBy: params.triggeredBy,

    queries: [],

    unknownVariations: [],
    multipleExposures: 0,
    analyses: [],
  }),
);
