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
// and (additive, backwards-compatible) contextual-bandit payload fields.
export type FeatureDefinitionRule = FeatureRule & {
  metadata?: ExperimentMetadata;
  type?: "standard" | "multi-armed-bandit" | "contextual-bandit";
  attributesRequired?: string[];
  contexts?: {
    leafId: number;
    condition: Record<string, unknown>;
    weights: number[];
  }[];
  banditVersion?: number;
};

export type AutoExperimentWithMetadata = AutoExperiment & {
  metadata?: ExperimentMetadata;
};

export interface FeatureDefinition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
  metadata?: FeatureMetadata;
}
