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

// FeatureRule extended with optional metadata for experiment-ref rules
export type FeatureDefinitionRule = FeatureRule & {
  metadata?: ExperimentMetadata;
  contextualBanditRef?: string;
  contextualVariations?: unknown[];
};

export type ContextualBanditDefinition = {
  banditVersion?: number;
  contexts: {
    leafId: number;
    condition: Record<string, unknown>;
    weights: number[];
  }[];
};

export type ContextualBanditDefinitions = Record<
  string,
  ContextualBanditDefinition
>;

export type AutoExperimentWithMetadata = AutoExperiment & {
  metadata?: ExperimentMetadata;
};

export interface FeatureDefinition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
  metadata?: FeatureMetadata;
}
