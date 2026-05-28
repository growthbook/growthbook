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
// Newer SDKs evaluate per-context arm weights via `contexts`; older SDKs
// ignore the CB fields entirely and fall back to the standard `weights`
// array. The matching SDK-side type lives in
// `sdk-js/src/types/growthbook.ts`. Aliased here (rather than on the
// published `FeatureRule` directly) because `FeatureRule` is a `type`
// alias and not amenable to module augmentation from the consumer side.
export type FeatureDefinitionRule = FeatureRule & {
  metadata?: ExperimentMetadata;
  isContextualBandit?: boolean;
  attributesRequired?: string[];
  contexts?: {
    contextId: string;
    condition: Record<string, unknown>;
    weights: number[];
  }[];
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
