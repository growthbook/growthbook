import {
  AutoExperiment,
  FeatureRule as FeatureDefinitionRule,
} from "@growthbook/growthbook";

export interface FeatureDefinition {
  // eslint-disable-next-line
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
}

/**
 * @deprecated Used by legacy SDK payload cache (org + environment level)
 * The new sdkConnectionCache stores fully-processed payloads per connection
 */
export type FeatureDefinitionWithProject = FeatureDefinition & {
  project?: string;
};

/**
 * @deprecated Used by legacy SDK payload cache (org + environment level)
 * The new sdkConnectionCache stores fully-processed payloads per connection
 */
export type FeatureDefinitionWithProjects = FeatureDefinition & {
  projects?: string[];
};

/**
 * @deprecated Used by legacy SDK payload cache (org + environment level)
 * The new sdkConnectionCache stores fully-processed payloads per connection
 */
export type AutoExperimentWithProject = AutoExperiment & {
  project?: string;
};
