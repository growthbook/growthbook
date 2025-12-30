import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { TagInterface } from "shared/types/tag";
import { Environment } from "shared/types/organization";
import { SavedGroupInterface } from "shared/types/groups";
import {
  CreateFactMetricProps,
  CreateFactTableProps,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";

// beginregion Import Types

export type ImportStatus =
  | "invalid"
  | "skipped"
  | "pending"
  | "completed"
  | "failed";

export type BaseImportStatus = {
  key: string;
  status: ImportStatus;
  exists?: boolean;
  error?: string;
  hasChanges?: boolean;
  transformedData?: string; // Diff-friendly string of new entity (right column on diff display)
  existingData?: string; // Diff-friendly string of existing entity (left column on diff display)
};

export type EnvironmentImport = BaseImportStatus & {
  environment?: StatsigEnvironment;
  existingEnvironment?: Environment;
};

export type FeatureGateImport = BaseImportStatus & {
  featureGate?: StatsigFeatureGate;
  feature?: Omit<
    FeatureInterface,
    "organization" | "dateCreated" | "dateUpdated" | "version"
  >;
  existing?: FeatureInterface;
};

export type DynamicConfigImport = BaseImportStatus & {
  dynamicConfig?: StatsigDynamicConfig;
  feature?: Omit<
    FeatureInterface,
    "organization" | "dateCreated" | "dateUpdated" | "version"
  >;
  existing?: FeatureInterface;
};

export type ExperimentImport = BaseImportStatus & {
  experiment?: StatsigExperiment;
  gbExperiment?: Omit<
    ExperimentInterfaceStringDates,
    "organization" | "dateCreated" | "dateUpdated"
  >;
  gbFeature?: Omit<
    FeatureInterface,
    "organization" | "dateCreated" | "dateUpdated" | "version"
  >;
  existingExperiment?: ExperimentInterfaceStringDates;
  existingFeature?: FeatureInterface;
  transformedExperiment?: Partial<ExperimentInterfaceStringDates>;
  transformedFeature?: Omit<
    FeatureInterface,
    "organization" | "dateCreated" | "dateUpdated" | "version"
  >;
};

export type SegmentImport = BaseImportStatus & {
  segment?: StatsigSavedGroup;
  existingSavedGroup?: SavedGroupInterface;
  transformedSavedGroup?: Omit<
    SavedGroupInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >;
};

export type MetricImport = BaseImportStatus & {
  metric?: StatsigMetric;
  existingMetric?: FactMetricInterface;
  transformedMetric?: CreateFactMetricProps;
};

export type MetricSourceImport = BaseImportStatus & {
  metricSource?: StatsigMetricSource;
  existingMetricSource?: FactTableInterface;
  transformedMetricSource?: CreateFactTableProps;
};

export type TagImport = BaseImportStatus & {
  tag?: StatsigTag;
  gbTag?: TagInterface;
  existingTag?: TagInterface;
  transformedTag?: TagInterface;
};

export type StatsigTag = {
  id: string;
  name: string;
  description?: string;
  isCore?: boolean;
};

export interface ImportData {
  status: "init" | "fetching" | "error" | "ready" | "importing" | "completed";
  environments?: EnvironmentImport[];
  featureGates?: FeatureGateImport[];
  dynamicConfigs?: DynamicConfigImport[];
  experiments?: ExperimentImport[];
  segments?: SegmentImport[];
  tags?: TagImport[];
  metricSources?: MetricSourceImport[];
  metrics?: MetricImport[];
  error?: string;
}

// endregion Import Types

export type StatsigFeatureGate = {
  id: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  status: string;
  rules: StatsigRule[];
  tags?: string[];
  owner?: {
    ownerID: string;
    ownerType: string;
    ownerName: string;
    ownerEmail: string;
  };
  lastModifiedTime: number;
  createdTime: number;
};

export type StatsigDynamicConfig = {
  id: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  rules: StatsigRule[];
  defaultValue: unknown;
  tags?: string[];
  owner?: {
    ownerID: string;
    ownerType: string;
    ownerName: string;
    ownerEmail: string;
  };
  lastModifiedTime: number;
  createdTime: number;
};

export type StatsigExperiment = {
  id: string;
  name: string;
  description?: string;
  idType?: string;
  status: "setup" | "running" | "stopped";
  hypothesis?: string;
  primaryMetrics: Array<{
    name: string;
    type: string;
    timestamp: number;
  }>;
  secondaryMetrics: Array<{
    name: string;
    type: string;
    timestamp: number;
  }>;
  groups: Array<{
    name: string;
    id: string;
    size: number;
    parameterValues: Record<string, unknown>;
    description?: string;
    disabled: boolean;
  }>;
  controlGroupID: string;
  allocation: number;
  duration: number;
  startTime?: number | null;
  endTime?: number | null;
  decisionTime?: number | null;
  winner?: number; // variation index (0-based)
  results?: "won" | "lost" | "inconclusive" | "dnf";
  inlineTargetingRulesJSON: string;
  analyticsType: "frequentist" | "bayesian";
  sequentialTesting: boolean;
  bonferroniCorrection: boolean;
  bonferroniCorrectionPerMetric: boolean;
  benjaminiHochbergPerVariant: boolean;
  benjaminiHochbergPerMetric: boolean;
  benjaminiPrimaryMetricsOnly: boolean;
  defaultConfidenceInterval: string;
  owner?: {
    ownerID: string;
    ownerType: string;
    ownerName: string;
    ownerEmail: string;
  };
  lastModifiedTime: number;
  createdTime: number;
  tags?: string[];
};

// export type StatsigVariant = {
//   name: string;
//   description?: string;
//   value: unknown;
//   weight: number;
// };

// export type StatsigTargeting = {
//   conditions?: StatsigCondition[];
//   user_segments?: string[];
// };

export type StatsigCondition = {
  type: string;
  operator: string;
  targetValue: unknown[] | unknown;
  field?: string;
  customID?: string;
};

export type StatsigRule = {
  id: string;
  baseID: string;
  name: string;
  passPercentage: number;
  conditions: StatsigCondition[];
  environments?: string[] | null; // null means all environments, array means specific environments
  returnValue?: unknown; // For dynamic configs - the JSON value to return
  variants?: Array<{
    id: string;
    name: string;
    passPercentage: number;
    returnValue: unknown;
    returnValueJson5?: string;
  }>; // For dynamic configs - multiple variants for A/B/n splits
};

// export type StatsigHoldout = {
//   enabled: boolean;
//   percentage: number;
// };

export type StatsigSavedGroup = {
  id: string;
  name?: string;
  isEnabled: boolean;
  description: string;
  lastModifierName: string;
  lastModifierID: string;
  type: "rule_based" | "id_list";
  count: number;
  idType?: string; // The attribute key for id_list segments
  rules?: {
    id: string;
    baseID: string;
    name: string;
    passPercentage: number;
    conditions: StatsigCondition[];
    environments?: string[] | null;
  }[];
  tags: string[];
  ids?: string[]; // For id_list type segments (fetched separately)
};

export type StatsigEnvironment = {
  id: string;
  name: string;
  isProduction: boolean;
  requiresReview: boolean;
  requiresReleasePipeline: boolean;
};

export type StatsigMetricSource = {
  name: string;
  description: string;
  sql: string;
  timestampColumn: string;
  idTypeMapping: {
    statsigUnitID: string;
    column: string;
  }[];
  tags?: string[];
  timestampAsDay?: boolean;
  sourceType?: "table" | "query";
  tableName?: string;
  datePartitionColumn?: string;
  customFieldMapping?: {
    key: string;
    formula: string;
  }[];
  isReadOnly?: boolean;
  isVerified?: boolean;
  owner?: {
    ownerID?: string;
    ownerType?: string;
    ownerName?: string;
    ownerEmail?: string;
  } | null;
  team?: string | null;
  teamID?: string | null;
};

export type StatsigMetricCriteria = {
  type: "value" | "metadata" | "user" | "user_custom";
  condition:
    | "in"
    | "not_in"
    | "="
    | ">"
    | "<"
    | ">="
    | "<="
    | "is_null"
    | "non_null"
    | "contains"
    | "not_contains"
    | "sql_filter"
    | "starts_with"
    | "ends_with"
    | "after_exposure"
    | "before_exposure"
    | "is_true"
    | "is_false";
  column?: string;
  values?: string[];
  nullVacuousOverride?: boolean;
};

export type StatsigMetric = {
  name: string;
  type:
    | "ratio"
    | "sum"
    | "composite"
    | "mean"
    | "event_count_custom"
    | "event_user"
    | "funnel"
    | "undefined"
    | "setup_incomplete"
    | "composite_sum"
    | "import_window"
    | "user_warehouse"
    | "count_distinct";
  directionality: "increase" | "decrease";
  id: string;
  lineage: {
    events: string[];
    metrics: string[];
  };
  isVerified?: boolean;
  isReadOnly?: boolean;
  unitTypes?: string[];
  metricEvents?: {
    name: string;
    type?: "count" | "count_distinct" | "value" | "metadata";
    metadataKey?: string;
    criteria?: StatsigMetricCriteria[];
  }[];
  metricComponentMetrics?: {
    name: string;
    type: string;
  }[];
  description?: string;
  tags?: string[];
  isPermanent?: boolean;
  rollupTimeWindow?: string;
  customRollUpStart?: number;
  customRollUpEnd?: number;
  funnelEventList?: {
    name: string;
    type: "event_dau" | "event_user" | "event_count" | "event_count_custom";
  }[];
  funnelCountDistinct?: "events" | "users";
  warehouseNative?: {
    aggregation?: StatsigMetricAggregation;
    metricSourceName?: string;
    criteria?: StatsigMetricCriteria[];
    waitForCohortWindow?: boolean;
    denominatorCriteria?: StatsigMetricCriteria[];
    denominatorAggregation?: StatsigMetricAggregation;
    denominatorCustomRollupEnd?: number;
    denominatorCustomRollupStart?: number;
    denominatorMetricSourceName?: string;
    denominatorRollupTimeWindow?: string;
    denominatorValueColumn?: string;
    funnelCalculationWindow?: number;
    funnelCountDistinct?: "sessions" | "users";
    funnelEvents?: {
      criteria?: StatsigMetricCriteria[];
      metricSourceName?: string;
      name?: string;
      sessionIdentifierField?: string | null;
    }[];
    funnelStartCriteria?: "start_event" | "exposure";
    metricDimensionColumns?: string[];
    metricBakeDays?: number;
    numeratorAggregation?: StatsigMetricAggregation;
    valueColumn?: string;
    valueThreshold?: number;
    allowNullRatioDenominator?: boolean;
    funnelStrictOrdering?: boolean;
    funnelUseExposureAsFirstEvent?: boolean;
    funnelTimestampAllowanceMs?: number;
    funnelTimeToConvert?: boolean;
    winsorizationHigh?: number;
    winsorizationLow?: number;
    winsorizationHighDenominator?: number;
    winsorizationLowDenominator?: number;
    cupedAttributionWindow?: number;
    rollupTimeWindow?: string;
    customRollUpStart?: number;
    customRollUpEnd?: number;
    onlyIncludeUsersWithConversionEvent?: boolean;
    denominatorCustomRollupMeasureInMinutes?: boolean;
    customRollupMeasureInMinutes?: boolean;
    percentile?: number;
    useLogTransform?: boolean;
    useSecondaryRetentionEvent?: boolean;
    retentionEnd?: number;
    retentionLength?: number;
    logTransformBase?: number | null;
    cap?: number;
    surrogateMetricMSE?: number | null;
  };
  team?: string | null;
  teamID?: string | null;
  dryRun?: boolean;
  isHidden?: boolean;
  creatorName?: string | null;
  creatorEmail?: string | null;
  createdTime?: number;
  lastModifierID?: string | null;
  lastModifiedTime?: number | null;
  lastModifierEmail?: string | null;
  lastModifierName?: string | null;
  owner?: {
    name: string;
    ownerID?: string;
    ownerType?: string;
    ownerName?: string;
    ownerEmail?: string;
  };
};

export type StatsigMetricAggregation =
  | "count"
  | "sum"
  | "mean"
  | "daily_participation"
  | "ratio"
  | "funnel"
  | "count_distinct"
  | "percentile"
  | "first_value"
  | "latest_value"
  | "retention"
  | "max"
  | "min";

// API Response types
export type StatsigFeatureGatesResponse = {
  gates: StatsigFeatureGate[];
};

export type StatsigDynamicConfigsResponse = {
  configs: StatsigDynamicConfig[];
};

export type StatsigExperimentsResponse = {
  experiments: StatsigExperiment[];
};

export type StatsigSavedGroupsResponse = {
  groups: StatsigSavedGroup[];
};
