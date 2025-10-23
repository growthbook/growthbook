import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { TagInterface } from "back-end/types/tag";

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
  error?: string;
};

export type EnvironmentImport = BaseImportStatus & {
  environment?: StatsigEnvironment;
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
};

export type SegmentImport = BaseImportStatus & {
  segment?: StatsigSavedGroup;
};

export type MetricImport = BaseImportStatus & {
  metric?: unknown;
};

export type TagImport = BaseImportStatus & {
  tag?: StatsigTag;
  gbTag?: TagInterface;
  existingTag?: TagInterface;
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
