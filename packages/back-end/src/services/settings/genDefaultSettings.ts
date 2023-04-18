import { DEFAULT_METRIC_ANALYSIS_DAYS } from "../experiments";
import { Settings } from "./types";

export default function genDefaultSettings(): Settings {
  return {
    confidenceLevel: 0.95,
    attributionModel: "firstExposure",
    defaultRole: {
      environments: [],
      limitAccessByEnvironment: false,
      role: "collaborator",
    },
    metricAnalysisDays: DEFAULT_METRIC_ANALYSIS_DAYS,
    metricDefaults: {
      maxPercentageChange: 0.5,
      minPercentageChange: 0.005,
      minimumSampleSize: 150,
    },
    multipleExposureMinPercent: 0.01,
    northStar: null,
    pastExperimentsMinLength: 6,
    pValueThreshold: 0.05,
    regressionAdjustmentDays: 14,
    regressionAdjustmentEnabled: false,
    sdkInstructionsViewed: false,
    statsEngine: "bayesian",
    updateSchedule: null,
    videoInstructionsViewed: false,
    conversionDelayHours: null,
    conversionWindowHours: null,
    loseRisk: null,
    winRisk: null,
  };
}
