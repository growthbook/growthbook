import { MemberRoleInfo, MetricDefaults } from "back-end/types/organization";
import {
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_STATS_ENGINE,
} from "../../constants";
import { Settings } from "../types";

export const DEFAULT_CONFIDENCE_LEVEL = 0.95;
export const DEFAULT_ATTRIBUTION_MODEL = "firstExposure";
export const DEFAULT_ROLE: MemberRoleInfo = {
  environments: [],
  limitAccessByEnvironment: false,
  role: "collaborator",
};
export const DEFAULT_METRIC_DEFAULTS: MetricDefaults = {
  maxPercentageChange: 0.5,
  minPercentageChange: 0.005,
  minimumSampleSize: 150,
};
export const DEFAULT_METRIC_ANALYSIS_DAYS = 90;
export const DEFAULT_MULTIPLE_EXPOSURE_MIN_PERCENT = 0.01;
export const DEFAULT_NORTH_STAR = null;
export const DEFAULT_PAST_EXPERIMENT_MIN_LENGTH = 6;
export const DEFAULT_P_VALUE_THRESHOLD = 0.05;
export const DEFAULT_SDK_INSTRUCTIONS_VIEWED = false;
export const DEFAULT_UPDATE_SCHEDULE = null;
export const DEFAULT_VIDEO_INSTRUCTIONS_VIEIWED = false;
export const DEFAULT_CONVERSION_DELAY_HOURS = null;
export const DEFAULT_CONVERSION_WINDOW_HOURS = null;
export const DEFAULT_LOSE_RISK = null;
export const DEFAULT_WIN_RISK = null;
export const DEFAULT_SECURE_ATTRIBUTE_SALT = "";
export const DEFAULT_KILLSWITCH_CONFIRMATION = false;

export default function genDefaultSettings(): Settings {
  return {
    confidenceLevel: DEFAULT_CONFIDENCE_LEVEL,
    attributionModel: DEFAULT_ATTRIBUTION_MODEL,
    defaultRole: DEFAULT_ROLE,
    metricAnalysisDays: DEFAULT_METRIC_ANALYSIS_DAYS,
    metricDefaults: DEFAULT_METRIC_DEFAULTS,
    multipleExposureMinPercent: DEFAULT_MULTIPLE_EXPOSURE_MIN_PERCENT,
    northStar: DEFAULT_NORTH_STAR,
    pastExperimentsMinLength: DEFAULT_PAST_EXPERIMENT_MIN_LENGTH,
    pValueThreshold: DEFAULT_P_VALUE_THRESHOLD,
    regressionAdjustmentDays: DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
    regressionAdjustmentEnabled: DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
    sdkInstructionsViewed: DEFAULT_SDK_INSTRUCTIONS_VIEWED,
    statsEngine: DEFAULT_STATS_ENGINE,
    updateSchedule: DEFAULT_UPDATE_SCHEDULE,
    videoInstructionsViewed: DEFAULT_VIDEO_INSTRUCTIONS_VIEIWED,
    conversionDelayHours: DEFAULT_CONVERSION_DELAY_HOURS,
    conversionWindowHours: DEFAULT_CONVERSION_WINDOW_HOURS,
    loseRisk: DEFAULT_LOSE_RISK,
    winRisk: DEFAULT_WIN_RISK,
    secureAttributeSalt: DEFAULT_SECURE_ATTRIBUTE_SALT,
    killswitchConfirmation: DEFAULT_KILLSWITCH_CONFIRMATION,
  };
}
