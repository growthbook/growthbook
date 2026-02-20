import { FactMetricType } from "shared/types/fact-table";
import { EntityEvents } from "shared/types/audit";

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

// Post-Stratification:
export const DEFAULT_POST_STRATIFICATION_ENABLED = true;

// Lookback Override:
export const DEFAULT_LOOKBACK_OVERRIDE_VALUE_UNIT = "days";
export const DEFAULT_LOOKBACK_OVERRIDE_VALUE_DAYS = 14;

// Query settings
export const DEFAULT_TEST_QUERY_DAYS = 30;
export const DEFAULT_USE_STICKY_BUCKETING = false;

// Dimension name constants:
export const EXPOSURE_DATE_DIMENSION_NAME = "dim_exposure_date";
export const BANDIT_SRM_DIMENSION_NAME = "gb_internal_bandit_srm";
export const AUTOMATIC_DIMENSION_OTHER_NAME = "__Other__";
export const NULL_DIMENSION_VALUE = "__NULL_DIMENSION";
export const NULL_DIMENSION_DISPLAY = "NULL (unset)";
export const PRECOMPUTED_DIMENSION_PREFIX = "precomputed:";
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

export const UNSUPPORTED_METRIC_EXPLORER_TYPES: readonly FactMetricType[] = [
  "quantile",
] as const;

export const sdkLanguages = [
  "nocode-webflow",
  "nocode-wordpress",
  "nocode-shopify",
  "nocode-other",
  "javascript",
  "nodejs",
  "nextjs",
  "react",
  "php",
  "ruby",
  "python",
  "go",
  "java",
  "csharp",
  "android",
  "ios",
  "flutter",
  "elixir",
  "edge-cloudflare",
  "edge-fastly",
  "edge-lambda",
  "edge-other",
  "rust",
  "roku",
  "other",
] as const;

export const statsEngines = ["bayesian", "frequentist"] as const;

export const attributeDataTypes = [
  "boolean",
  "string",
  "number",
  "secureString",
  "enum",
  "string[]",
  "number[]",
  "secureString[]",
] as const;

// for audits
export const entityEvents = {
  agreement: ["create", "update", "delete"],
  aiPrompt: ["create", "update", "delete"],
  attribute: ["create", "update", "delete"],
  experiment: [
    "create",
    "update",
    "start",
    "phase",
    "phase",
    "stop",
    "status",
    "archive",
    "unarchive",
    "delete",
    "results",
    "analysis",
    "screenshot",
    "screenshot",
    "refresh",
    "launchChecklist.updated",
    "phase.delete",
    "screenshot.delete",
    "screenshot.create",
  ],
  project: ["create", "update", "delete"],
  environment: ["create", "update", "delete"],
  feature: [
    "create",
    "publish",
    "revert",
    "update",
    "toggle",
    "archive",
    "delete",
  ],
  featureRevisionLog: ["create", "update", "delete"],
  urlRedirect: ["create", "update", "delete"],
  metric: ["autocreate", "create", "update", "delete", "analysis"],
  metricAnalysis: ["create", "update", "delete"],
  metricGroup: ["create", "delete", "update"],
  populationData: ["create", "delete", "update"],
  datasource: ["create", "update", "delete", "import"],
  comment: ["create", "update", "delete"],
  "sdk-connection": ["create", "update", "delete"],
  user: ["create", "update", "delete", "invite"],
  organization: ["create", "update", "delete", "disable", "enable"],
  installation: ["update"],
  savedGroup: ["created", "deleted", "updated"],
  segment: ["create", "delete", "update"],
  archetype: ["created", "deleted", "updated"],
  team: ["create", "delete", "update"],
  vercelNativeIntegration: ["create", "update", "delete"],
  factTable: ["autocreate", "create", "update", "delete"],
  customField: ["create", "update", "delete"],
  experimentTemplate: ["create", "update", "delete"],
  safeRollout: ["create", "update", "delete"],
  decisionCriteria: ["create", "update", "delete"],
  execReport: ["create", "update", "delete"],
  holdout: ["create", "update", "delete"],
  savedQuery: ["create", "update", "delete"],
  dashboard: ["create", "update", "delete"],
  dashboardTemplate: ["create", "update", "delete"],
  incrementalRefresh: ["create", "update", "delete"],
  vector: ["create", "update", "delete"],
  customHook: ["create", "update", "delete"],
  ssoConnection: ["create", "update", "delete"],
  sqlResultChunk: ["create", "update", "delete"],
} as const;

export const entityTypes = Object.keys(entityEvents) as [keyof EntityEvents];
