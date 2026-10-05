import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExperimentMetricInterface } from "shared/experiments";
import { getMetricSettingsForStatsEngine } from "back-end/src/services/stats";
import { factMetricFactory } from "../factories/FactMetric.factory";

const baseSettings: ExperimentSnapshotSettings = {
  manual: false,
  dimensions: [],
  metricSettings: [],
  goalMetrics: ["fact_cluster"],
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
  experimentId: "exp_cluster",
  queryFilter: "",
  segment: "",
  skipPartialData: false,
  datasourceId: "ds_1",
  exposureQueryId: "cluster_exposure",
  exposureQueryIdentifierType: "region_id",
  startDate: new Date("2023-01-01"),
  endDate: new Date("2023-01-31"),
  variations: [],
  isClusterExperiment: true,
  clusterSubUnitIdentifier: "user_id",
};

const emptyMetricMap = new Map<string, ExperimentMetricInterface>();

describe("getMetricSettingsForStatsEngine - cluster metrics", () => {
  it("maps a cluster metric to a plain ratio when regression adjustment is off", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster",
      metricType: "mean",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
      regressionAdjustmentEnabled: false,
    });

    const result = getMetricSettingsForStatsEngine(
      metric,
      emptyMetricMap,
      baseSettings,
      true,
    );

    expect(result.statistic_type).toBe("ratio");
    expect(result.main_metric_type).toBe("count");
    expect(result.denominator_metric_type).toBe("count");
    // No covariate when RA is off.
    expect(result.covariate_metric_type).toBeUndefined();
  });

  it("maps a converted-mean cluster metric to ratio_ra when regression adjustment is on", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster",
      metricType: "mean",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
      regressionAdjustmentOverride: true,
      regressionAdjustmentEnabled: true,
      regressionAdjustmentDays: 14,
    });

    const result = getMetricSettingsForStatsEngine(
      metric,
      emptyMetricMap,
      baseSettings,
      true,
    );

    expect(result.statistic_type).toBe("ratio_ra");
    expect(result.main_metric_type).toBe("count");
    expect(result.denominator_metric_type).toBe("count");
    expect(result.covariate_metric_type).toBe("count");
  });

  it("maps a native-ratio cluster metric to ratio_ra when regression adjustment is on", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster",
      metricType: "ratio",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
      denominator: { factTableId: "orders", column: "qty", aggregation: "sum" },
      regressionAdjustmentOverride: true,
      regressionAdjustmentEnabled: true,
      regressionAdjustmentDays: 14,
    });

    const result = getMetricSettingsForStatsEngine(
      metric,
      emptyMetricMap,
      baseSettings,
      true,
    );

    expect(result.statistic_type).toBe("ratio_ra");
    expect(result.denominator_metric_type).toBe("count");
    expect(result.covariate_metric_type).toBe("count");
  });

  it("does not apply regression adjustment when the experiment-level flag is off", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster",
      metricType: "mean",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
      regressionAdjustmentOverride: true,
      regressionAdjustmentEnabled: true,
      regressionAdjustmentDays: 14,
    });

    const result = getMetricSettingsForStatsEngine(
      metric,
      emptyMetricMap,
      { ...baseSettings, regressionAdjustmentEnabled: false },
      true,
    );

    expect(result.statistic_type).toBe("ratio");
    expect(result.covariate_metric_type).toBeUndefined();
  });
});
