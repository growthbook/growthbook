import {
  AutoExperiment,
  FeatureRule as FeatureDefinitionRule,
  FeatureMetadata,
} from "@growthbook/growthbook";

export interface FeatureDefinition {
  // eslint-disable-next-line
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
  metadata?: FeatureMetadata;
}

export type FeatureDefinitionWithProject = FeatureDefinition & {
  project?: string;
};

export type FeatureDefinitionWithProjects = FeatureDefinition & {
  projects?: string[];
};

export type AutoExperimentWithProject = AutoExperiment & {
  project?: string;
};
