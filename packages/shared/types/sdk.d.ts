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
  // Pointer into the payload's top-level `contextualBandits` map. Contexts are
  // stored once per CB there (savedGroups-style) instead of inline per rule, so
  // a CB linked to F features costs one copy instead of F.
  contextualBanditRef?: string;
};

// One entry in the payload's top-level `contextualBandits` map, keyed by CB id.
export type ContextualBanditDefinition = {
  banditVersion?: number;
  attributesRequired?: string[];
  contexts: {
    leafId: number;
    condition: Record<string, unknown>;
    weights: number[];
  }[];
};

export type ContextualBanditsMap = Record<string, ContextualBanditDefinition>;

export type AutoExperimentWithMetadata = AutoExperiment & {
  metadata?: ExperimentMetadata;
};

export interface FeatureDefinition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
  metadata?: FeatureMetadata;
}
