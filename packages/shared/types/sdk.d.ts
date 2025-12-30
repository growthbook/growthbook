import {
  AutoExperiment,
  FeatureRule as FeatureDefinitionRule,
} from "@growthbook/growthbook";

export interface FeatureDefinition {
  // eslint-disable-next-line
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
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
