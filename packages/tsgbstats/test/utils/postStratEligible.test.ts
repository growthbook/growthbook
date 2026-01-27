import { testPostStratEligible } from "../../src/utils/postStratEligible";
import type {
  MetricSettingsForStatsEngine,
  AnalysisSettingsForStatsEngine,
} from "../../src/models/settings";
import {
  DEFAULT_METRIC_SETTINGS,
  DEFAULT_ANALYSIS_SETTINGS,
} from "../../src/models/settings";

describe("testPostStratEligible", () => {
  it("returns true when post-stratification is enabled and statistic is eligible", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "mean",
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      postStratificationEnabled: true,
    };

    expect(testPostStratEligible(metric, analysis)).toBe(true);
  });

  it("returns false when post-stratification is disabled", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "mean",
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      postStratificationEnabled: false,
    };

    expect(testPostStratEligible(metric, analysis)).toBe(false);
  });

  it("returns false for quantile_unit statistic type", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "quantile_unit",
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      postStratificationEnabled: true,
    };

    expect(testPostStratEligible(metric, analysis)).toBe(false);
  });

  it("returns false for quantile_event statistic type", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "quantile_event",
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      postStratificationEnabled: true,
    };

    expect(testPostStratEligible(metric, analysis)).toBe(false);
  });
});
