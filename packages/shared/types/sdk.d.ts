import { AutoExperiment, FeatureRule } from "@growthbook/growthbook";

export type FeatureMetadata = {
  projects?: string[];
  customFields?: Record<string, unknown>;
  tags?: string[];
};

export type ExperimentMetadata = {
  projects?: string[];
  customFields?: Record<string, unknown>;
  tags?: string[];
};

// FeatureRule extended with metadata for experiment-ref rules
export type FeatureDefinitionRule = FeatureRule & {
  metadata?: ExperimentMetadata;
};

export type AutoExperimentWithMetadata = AutoExperiment & {
  metadata?: ExperimentMetadata;
};

export interface FeatureDefinition {
  // eslint-disable-next-line
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
  metadata?: FeatureMetadata;
}
