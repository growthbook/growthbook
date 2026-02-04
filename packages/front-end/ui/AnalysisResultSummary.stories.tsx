import { Flex } from "@radix-ui/themes";
import {
  ExperimentReportVariationWithIndex,
  MetricSnapshotSettings,
} from "shared/types/report";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { PValueCorrection, StatsEngine } from "shared/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { RowResults } from "@/services/experiments";
import Frame from "@/ui/Frame";
import AnalysisResultSummary from "@/ui/AnalysisResultSummary";

const variationA = {
  id: "v0",
  name: "Control",
  weight: 0.5,
  index: 0,
} as ExperimentReportVariationWithIndex;
const variationB = {
  id: "v1",
  name: "Variation",
  weight: 0.5,
  index: 1,
} as ExperimentReportVariationWithIndex;

const baselineMetric: SnapshotMetric = {
  value: 1000,
  cr: 1.0,
  users: 1000,
  ci: [-0.01, 0.01],
};

const statsWin: SnapshotMetric = {
  value: 1100,
  cr: 1.1,
  users: 1000,
  expected: 0.1,
  ci: [0.02, 0.18],
  ciAdjusted: [0.015, 0.175],
  pValue: 0.02,
  pValueAdjusted: 0.025,
  chanceToWin: 0.92,
};

const statsLose: SnapshotMetric = {
  value: 900,
  cr: 0.9,
  users: 1000,
  expected: -0.08,
  ci: [-0.15, -0.01],
  pValue: 0.03,
  chanceToWin: 0.08,
};

const statsNotEnough: SnapshotMetric = {
  value: 10,
  cr: 0.01,
  users: 20,
  expected: 0,
};

const baseRowResults: RowResults = {
  hasData: true,
  enoughData: true,
  enoughDataMeta: {
    reason: "notEnoughData",
    reasonText: "Collect more data to reach minimum sample size",
    percentComplete: 1,
    percentCompleteNumerator: 1,
    percentCompleteDenominator: 1,
    timeRemainingMs: 0,
    showTimeRemaining: false,
  },
  hasScaledImpact: true,
  significant: true,
  significantUnadjusted: true,
  significantReason: "p < 0.05",
  suspiciousChange: false,
  suspiciousThreshold: 0.25,
  suspiciousChangeReason: "",
  belowMinChange: false,
  minPercentChange: 0.05,
  currentMetricTotal: 1000,
  directionalStatus: "winning",
  resultsStatus: "won",
  resultsReason: "",
};

const rowResultsWin: RowResults = {
  ...baseRowResults,
  directionalStatus: "winning",
  resultsStatus: "won",
  resultsReason: "Significant improvement",
};

const rowResultsLose: RowResults = {
  ...baseRowResults,
  directionalStatus: "losing",
  resultsStatus: "lost",
  resultsReason: "Significant regression",
};

const rowResultsInsig: RowResults = {
  ...baseRowResults,
  significant: false,
  significantUnadjusted: false,
  directionalStatus: "winning",
  resultsStatus: "draw",
  resultsReason: "Not significant",
};

const rowResultsNotEnough: RowResults = {
  ...baseRowResults,
  hasData: true,
  enoughData: false,
  significant: false,
  enoughDataMeta: {
    reason: "notEnoughData",
    reasonText: "Need 1,000 users per variation",
    percentComplete: 0.12,
    percentCompleteNumerator: 120,
    percentCompleteDenominator: 1000,
    timeRemainingMs: null,
    showTimeRemaining: false,
  },
};

const rowResultsBaselineZero: RowResults = {
  ...rowResultsNotEnough,
  enoughDataMeta: {
    reason: "baselineZero",
    reasonText: "Baseline has zero value",
  },
};

const rowResultsSuspicious: RowResults = {
  ...rowResultsWin,
  suspiciousChange: true,
  suspiciousThreshold: 0.3,
  suspiciousChangeReason:
    "Observed change exceeds historical variability threshold",
};

const metricBinomial = {
  id: "m_bin",
  name: "Signup Rate",
  type: "binomial",
  inverse: false,
} as unknown as ExperimentMetricInterface;

const metricInverse = {
  id: "m_inv",
  name: "Bounce Rate",
  type: "binomial",
  inverse: true,
} as unknown as ExperimentMetricInterface;

const metricWithDenominator = {
  id: "m_ratio_like",
  name: "Purchases per User",
  type: "count",
  denominator: "m_users",
  inverse: false,
} as unknown as ExperimentMetricInterface;

const factRatioMetric = {
  id: "fact_ratio",
  name: "ARPU (Fact Ratio)",
  metricType: "ratio",
  numerator: { factTableId: "ft1", column: "revenue", filters: [] },
  denominator: { factTableId: "ft1", column: "sessions", filters: [] },
  inverse: false,
} as unknown as ExperimentMetricInterface;

const factQuantileUnit = {
  id: "fact_quantile_unit",
  name: "p90 Session Duration (Unit)",
  metricType: "quantile",
  numerator: { factTableId: "ft1", column: "session_duration", filters: [] },
  quantileSettings: { type: "unit", quantile: 0.9, ignoreZeros: true },
  inverse: false,
} as unknown as ExperimentMetricInterface;

const factQuantileEvent = {
  id: "fact_quantile_event",
  name: "p90 Event Value (Event)",
  metricType: "quantile",
  numerator: { factTableId: "ft1", column: "event_value", filters: [] },
  quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
  inverse: false,
} as unknown as ExperimentMetricInterface;

type ARPData = {
  metricRow: number;
  metric: ExperimentMetricInterface;
  metricSnapshotSettings?: MetricSnapshotSettings;
  sliceLevels?: Array<{
    dimension: string;
    levels: string[];
  }>;
  variation: ExperimentReportVariationWithIndex;
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  baselineVariation: ExperimentReportVariationWithIndex;
  rowResults: RowResults;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  isGuardrail: boolean;
};

function makeData({
  metric,
  stats,
  baseline,
  rowResults,
  statsEngine = "frequentist",
  pValueCorrection = null,
  isGuardrail = false,
  sliceLevels,
  metricSnapshotSettings,
}: {
  metric: ExperimentMetricInterface;
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  statsEngine?: StatsEngine;
  pValueCorrection?: PValueCorrection | null;
  isGuardrail?: boolean;
  sliceLevels?: Array<{
    dimension: string;
    levels: string[];
  }>;
  metricSnapshotSettings?: MetricSnapshotSettings;
}): ARPData {
  return {
    metricRow: 0,
    metric,
    metricSnapshotSettings,
    sliceLevels,
    variation: variationB,
    stats,
    baseline,
    baselineVariation: variationA,
    rowResults,
    statsEngine,
    pValueCorrection,
    isGuardrail,
  };
}

export default function AnalysisResultSummaryStories() {
  return (
    <div>
      <Flex direction="column" gap="4">
        <div>
          <b>Frequentist, Relative, Significant Win (p-value adjusted)</b>
          <Flex gap="3" mt="2">
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="relative"
                data={makeData({
                  metric: metricBinomial,
                  stats: statsWin,
                  baseline: baselineMetric,
                  rowResults: rowResultsWin,
                  statsEngine: "frequentist",
                  pValueCorrection: "benjamini-hochberg",
                })}
              />
            </Frame>
          </Flex>
        </div>

        <div>
          <b>Frequentist, Relative, Not Enough Data</b>
          <Flex gap="3" mt="2">
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="relative"
                data={makeData({
                  metric: metricBinomial,
                  stats: statsNotEnough,
                  baseline: baselineMetric,
                  rowResults: rowResultsNotEnough,
                  statsEngine: "frequentist",
                })}
              />
            </Frame>
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="relative"
                data={makeData({
                  metric: metricBinomial,
                  stats: statsNotEnough,
                  baseline: baselineMetric,
                  rowResults: rowResultsBaselineZero,
                  statsEngine: "frequentist",
                })}
              />
            </Frame>
          </Flex>
        </div>

        <div>
          <b>Frequentist, Relative, Suspicious Change</b>
          <Flex gap="3" mt="2">
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="relative"
                data={makeData({
                  metric: metricBinomial,
                  stats: statsWin,
                  baseline: baselineMetric,
                  rowResults: rowResultsSuspicious,
                  statsEngine: "frequentist",
                })}
              />
            </Frame>
          </Flex>
        </div>

        <div>
          <b>Frequentist, Absolute, Insignificant</b>
          <Flex gap="3" mt="2">
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="absolute"
                data={makeData({
                  metric: metricWithDenominator,
                  stats: { ...statsWin, expected: 0.02, denominator: 2000 },
                  baseline: { ...baselineMetric, denominator: 2000 },
                  rowResults: rowResultsInsig,
                  statsEngine: "frequentist",
                })}
              />
            </Frame>
          </Flex>
        </div>

        <div>
          <b>Frequentist, Scaled Impact</b>
          <Flex gap="3" mt="2">
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="scaled"
                data={makeData({
                  metric: metricBinomial,
                  stats: statsWin,
                  baseline: baselineMetric,
                  rowResults: rowResultsWin,
                  statsEngine: "frequentist",
                })}
              />
            </Frame>
          </Flex>
        </div>

        <div>
          <b>Bayesian, Relative, CUPED + Prior (lift warning)</b>
          <Flex gap="3" mt="2">
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="relative"
                data={makeData({
                  metric: metricBinomial,
                  stats: statsWin,
                  baseline: baselineMetric,
                  rowResults: rowResultsWin,
                  statsEngine: "bayesian",
                  metricSnapshotSettings: {
                    metric: "m_bin",
                    properPrior: true,
                    properPriorMean: 0,
                    properPriorStdDev: 0.1,
                    regressionAdjustmentEnabled: true,
                    regressionAdjustmentReason: "enabled",
                    regressionAdjustmentAvailable: true,
                    regressionAdjustmentDays: 14,
                  },
                })}
              />
            </Frame>
          </Flex>
        </div>

        <div>
          <b>Inverse Metric (losing)</b>
          <Flex gap="3" mt="2">
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="relative"
                data={makeData({
                  metric: metricInverse,
                  stats: statsLose,
                  baseline: baselineMetric,
                  rowResults: rowResultsLose,
                  statsEngine: "frequentist",
                })}
              />
            </Frame>
          </Flex>
        </div>

        <div>
          <b>Quantile Metrics</b>
          <Flex gap="3" mt="2">
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="relative"
                data={makeData({
                  metric: factQuantileUnit,
                  stats: {
                    ...statsWin,
                    stats: { users: 1000, count: 800, stddev: 1, mean: 1 },
                  },
                  baseline: {
                    ...baselineMetric,
                    stats: { users: 1000, count: 750, stddev: 1, mean: 1 },
                  },
                  rowResults: rowResultsWin,
                  statsEngine: "frequentist",
                })}
              />
            </Frame>
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="relative"
                data={makeData({
                  metric: factQuantileEvent,
                  stats: {
                    ...statsWin,
                    stats: { users: 1000, count: 2200, stddev: 1, mean: 1 },
                  },
                  baseline: {
                    ...baselineMetric,
                    stats: { users: 1000, count: 2000, stddev: 1, mean: 1 },
                  },
                  rowResults: rowResultsWin,
                  statsEngine: "frequentist",
                })}
              />
            </Frame>
          </Flex>
        </div>

        <div>
          <b>Ratio (Fact) and Bandit (shows adjusted label)</b>
          <Flex gap="3" mt="2">
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="relative"
                isBandit
                data={makeData({
                  metric: factRatioMetric,
                  stats: { ...statsWin, denominator: 5000 },
                  baseline: { ...baselineMetric, denominator: 4800 },
                  rowResults: rowResultsWin,
                  statsEngine: "frequentist",
                })}
              />
            </Frame>
          </Flex>
        </div>

        <div>
          <b>With Dimension</b>
          <Flex gap="3" mt="2">
            <Frame py="2" px="2">
              <AnalysisResultSummary
                differenceType="relative"
                data={makeData({
                  metric: metricBinomial,
                  stats: statsWin,
                  baseline: baselineMetric,
                  rowResults: rowResultsWin,
                  statsEngine: "frequentist",
                  sliceLevels: [
                    {
                      dimension: "country",
                      levels: ["United States"],
                    },
                  ],
                })}
              />
            </Frame>
          </Flex>
        </div>
      </Flex>
    </div>
  );
}
