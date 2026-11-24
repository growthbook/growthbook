import pick from "lodash/pick";
import { DEFAULT_TARGET_MDE } from "shared/constants";
import type {
  ExperimentSnapshotSettings,
  MetricForSnapshot,
} from "shared/types/experiment-snapshot";
import type { ExperimentMetricInterface } from "shared/experiments";
import { getMetricSettingsForStatsEngine } from "back-end/src/services/stats";
import { factMetricFactory } from "../factories/FactMetric.factory";

const metric = factMetricFactory.build({
  id: "fact_a",
  inverse: true,
  priorSettings: { override: true, proper: true, mean: 0.2, stddev: 0.4 },
  targetMDE: 0.05,
});

const computed = (
  overrides: Partial<NonNullable<MetricForSnapshot["computedSettings"]>>,
): MetricForSnapshot => ({
  id: "fact_a",
  computedSettings: {
    regressionAdjustmentEnabled: false,
    regressionAdjustmentAvailable: true,
    regressionAdjustmentDays: 14,
    regressionAdjustmentReason: "",
    properPrior: false,
    properPriorMean: 0.1,
    properPriorStdDev: 0.5,
    windowSettings: metric.windowSettings,
    ...overrides,
  },
});

const statsEngineInputs = (
  m: ExperimentMetricInterface,
  metricSettings: MetricForSnapshot[],
) =>
  pick(
    getMetricSettingsForStatsEngine(m, new Map(), {
      metricSettings,
      goalMetrics: ["fact_a"],
      secondaryMetrics: [],
      guardrailMetrics: ["fact_a"],
      regressionAdjustmentEnabled: false,
    } as unknown as ExperimentSnapshotSettings),
    [
      "inverse",
      "prior_proper",
      "prior_mean",
      "prior_stddev",
      "target_mde",
      "business_metric_type",
    ],
  );

describe("the stats engine's priors, target MDE and roles for a metric", () => {
  it("reads the snapshot's computed settings over the definition", () => {
    expect(statsEngineInputs(metric, [computed({ targetMDE: 0.2 })])).toEqual({
      inverse: true,
      prior_proper: false,
      prior_mean: 0.1,
      prior_stddev: 0.5,
      target_mde: 0.2,
      business_metric_type: ["goal", "guardrail"],
    });
  });

  it("takes the default target MDE when the computed settings have none", () => {
    expect(statsEngineInputs(metric, [computed({})]).target_mde).toBe(
      DEFAULT_TARGET_MDE,
    );
  });

  it("reads the definition without computed settings", () => {
    expect(statsEngineInputs(metric, [])).toEqual({
      inverse: true,
      prior_proper: true,
      prior_mean: 0.2,
      prior_stddev: 0.4,
      target_mde: 0.05,
      business_metric_type: ["goal", "guardrail"],
    });
    expect(
      statsEngineInputs({ ...metric, targetMDE: undefined }, []).target_mde,
    ).toBe(DEFAULT_TARGET_MDE);
  });
});
