import { createCoreAndSupplementalResults } from "../src/supplemental";
import type {
  MetricSettingsForStatsEngine,
  AnalysisSettingsForStatsEngine,
} from "../src/models/settings";
import {
  DEFAULT_METRIC_SETTINGS,
  DEFAULT_ANALYSIS_SETTINGS,
} from "../src/models/settings";
import type {
  DimensionMetricData,
  BayesianVariationResponse,
} from "../src/gbstats";

describe("createCoreAndSupplementalResults", () => {
  const mockMetricData: DimensionMetricData[] = [
    {
      dimension: "",
      totalUnits: 1000,
      data: [
        {
          dimension: "",
          strata: "",
          baseline_id: "0",
          baseline_name: "Control",
          baseline_users: 500,
          baseline_count: 500,
          baseline_main_sum: 250,
          baseline_main_sum_squares: 150,
          v1_id: "1",
          v1_name: "Treatment",
          v1_users: 500,
          v1_count: 500,
          v1_main_sum: 280,
          v1_main_sum_squares: 170,
        },
      ],
    },
  ];

  it("returns core result when no supplemental calculations needed", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "mean",
      priorProper: false,
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      varIds: ["0", "1"],
      varNames: ["Control", "Treatment"],
      statsEngine: "frequentist",
      postStratificationEnabled: false,
    };

    const result = createCoreAndSupplementalResults(
      mockMetricData,
      2,
      metric,
      analysis,
    );

    expect(result).toHaveLength(1);
    expect(result[0].variations).toHaveLength(2);
    // No supplemental results for basic frequentist
    expect(result[0].variations[1]).not.toHaveProperty("supplementalResults");
  });

  it("generates flatPrior supplemental for Bayesian with proper prior", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "mean",
      priorProper: true,
      priorMean: 0,
      priorStddev: 0.5,
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      varIds: ["0", "1"],
      varNames: ["Control", "Treatment"],
      statsEngine: "bayesian",
      postStratificationEnabled: false,
    };

    const result = createCoreAndSupplementalResults(
      mockMetricData,
      2,
      metric,
      analysis,
    );

    expect(result[0].variations[1]).toHaveProperty("supplementalResults");
    const variation = result[0].variations[1] as BayesianVariationResponse;
    expect(variation.supplementalResults?.flatPrior).not.toBeNull();
  });
});
