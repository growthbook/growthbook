import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

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
  environment?: StatSigEnvironment;
};

export type FeatureGateImport = BaseImportStatus & {
  featureGate?: StatSigFeatureGate;
  feature?: Omit<
    FeatureInterface,
    "organization" | "dateCreated" | "dateUpdated" | "version"
  >;
  existing?: FeatureInterface;
};

export type DynamicConfigImport = BaseImportStatus & {
  dynamicConfig?: StatSigDynamicConfig;
  feature?: Omit<
    FeatureInterface,
    "organization" | "dateCreated" | "dateUpdated" | "version"
  >;
  existing?: FeatureInterface;
};

export type ExperimentImport = BaseImportStatus & {
  experiment?: StatSigExperiment;
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
  segment?: StatSigSavedGroup;
};

export type LayerImport = BaseImportStatus & {
  layer?: unknown;
};

export type MetricImport = BaseImportStatus & {
  metric?: unknown;
};

export interface ImportData {
  status: "init" | "fetching" | "error" | "ready" | "importing" | "completed";
  environments?: EnvironmentImport[];
  featureGates?: FeatureGateImport[];
  dynamicConfigs?: DynamicConfigImport[];
  experiments?: ExperimentImport[];
  segments?: SegmentImport[];
  layers?: LayerImport[];
  metrics?: MetricImport[];
  error?: string;
}

// endregion Import Types

export type StatSigFeatureGate = {
  id: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  status: string;
  rules: StatSigRule[];
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

export type StatSigDynamicConfig = {
  id: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  rules: StatSigRule[];
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

export type StatSigExperiment = {
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

export type StatSigVariant = {
  name: string;
  description?: string;
  value: unknown;
  weight: number;
};

export type StatSigTargeting = {
  conditions?: StatSigCondition[];
  user_segments?: string[];
};

export type StatSigCondition = {
  type: string;
  operator: string;
  targetValue: unknown[] | unknown;
  field?: string;
  customID?: string;
};

export type StatSigRule = {
  id: string;
  baseID: string;
  name: string;
  passPercentage: number;
  conditions: StatSigCondition[];
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

export type StatSigHoldout = {
  enabled: boolean;
  percentage: number;
};

export type StatSigSavedGroup = {
  id: string;
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
    conditions: StatSigCondition[];
    environments?: string[] | null;
  }[];
  tags: string[];
  ids?: string[]; // For id_list type segments (fetched separately)
};

export type StatSigAttribute = {
  name: string;
  type: "string" | "number" | "boolean" | "array";
  description?: string;
};

export type StatSigEnvironment = {
  id: string;
  name: string;
  isProduction: boolean;
  requiresReview: boolean;
  requiresReleasePipeline: boolean;
};

// API Response types
export type StatSigFeatureGatesResponse = {
  gates: StatSigFeatureGate[];
};

export type StatSigDynamicConfigsResponse = {
  configs: StatSigDynamicConfig[];
};

export type StatSigExperimentsResponse = {
  experiments: StatSigExperiment[];
};

export type StatSigSavedGroupsResponse = {
  groups: StatSigSavedGroup[];
};
