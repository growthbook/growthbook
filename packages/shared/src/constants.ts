export const DEFAULT_STATS_ENGINE = "bayesian" as const;
export const DEFAULT_METRIC_HISTOGRAM_BINS = 25;
export const DEFAULT_P_VALUE_THRESHOLD = 0.05;
export const DEFAULT_P_VALUE_CORRECTION = null;
export const DEFAULT_GUARDRAIL_ALPHA = 0.05; //used for early stopping for safe
// Metric defaults
export const DEFAULT_METRIC_WINDOW = "conversion";
export const DEFAULT_FACT_METRIC_WINDOW = "";
export const DEFAULT_METRIC_WINDOW_DELAY_HOURS = 0;
export const DEFAULT_METRIC_WINDOW_HOURS = 72;
export const DEFAULT_METRIC_CAPPING = "";
export const DEFAULT_METRIC_CAPPING_VALUE = 0;
export const DEFAULT_WIN_RISK_THRESHOLD = 0.0025;
export const DEFAULT_LOSE_RISK_THRESHOLD = 0.0125;
export const DEFAULT_MAX_METRIC_SLICE_LEVELS = 20;

// Bayesian prior
export const DEFAULT_PROPER_PRIOR_STDDEV = 0.3;

export const DEFAULT_MAX_PERCENT_CHANGE = 0.5;
export const DEFAULT_MIN_PERCENT_CHANGE = 0.005;
export const DEFAULT_MIN_SAMPLE_SIZE = 150;
export const DEFAULT_TARGET_MDE = 0.1;

// Regression Adjustment (CUPED):
export const DEFAULT_REGRESSION_ADJUSTMENT_ENABLED = false;
export const DEFAULT_REGRESSION_ADJUSTMENT_DAYS = 14;

// Sequential Testing:
export const DEFAULT_SEQUENTIAL_TESTING_ENABLED = false;
export const DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER = 5000;

// Query settings
export const DEFAULT_TEST_QUERY_DAYS = 30;
export const DEFAULT_USE_STICKY_BUCKETING = false;

// Dimension name constants:
export const EXPOSURE_DATE_DIMENSION_NAME = "dim_exposure_date";
export const BANDIT_SRM_DIMENSION_NAME = "gb_internal_bandit_srm";
export const AUTOMATIC_DIMENSION_OTHER_NAME = "__Other__";
// Colors:
// export const variant_null = "#999";
// export const variant_0 = "#4f69ff";
// export const variant_1 = "#03d1ca";
// export const variant_2 = "#fd7e14";
// export const variant_3 = "#e83e8c";

export const GROWTHBOOK_SECURE_ATTRIBUTE_SALT = "eg8amUur5GunJXCfgjwB";

export const OWNER_JOB_TITLES = {
  engineer: "Engineer",
  dataScientist: "Data & Analytics",
  projectManager: "PM",
  marketer: "Marketer",
  designer: "Designer",
  other: "Other",
} as const;

export const USAGE_INTENTS = {
  featureFlags: "Feature Flags",
  experiments: "Experiments",
} as const;

// Health
export const DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD = 10;
export const DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD = 0.01;

export const DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION = 8;
export const DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION = 5;
export const DEFAULT_SRM_THRESHOLD = 0.001;

export const DEFAULT_DECISION_FRAMEWORK_ENABLED = false;

// Power
export const DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS = 3;
export const DEFAULT_EXPERIMENT_MAX_LENGTH_DAYS = undefined; // undefined means no limit
export const FALLBACK_EXPERIMENT_MAX_LENGTH_DAYS = 180;

// Safe Rollout
export const SAFE_ROLLOUT_TRACKING_KEY_PREFIX = "srk_";

export const DEFAULT_REQUIRE_PROJECT_FOR_FEATURES = false;

// Default configuration for Safe Rollout
export const SAFE_ROLLOUT_VARIATIONS = [
  {
    id: "0",
    name: "Control",
    weight: 0.5,
  },
  {
    id: "1",
    name: "Rollout Value",
    weight: 0.5,
  },
];
