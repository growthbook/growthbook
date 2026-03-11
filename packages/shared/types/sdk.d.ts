import {
  AutoExperiment,
  FeatureRule as FeatureDefinitionRule,
} from "@growthbook/growthbook";

export interface FeatureDefinition {
  // eslint-disable-next-line
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
}

// TODO: remove this intermediary type used for payload scrubbing
export type FeatureDefinitionWithProject = FeatureDefinition & {
  project?: string;
};

// TODO: remove this intermediary type used for payload scrubbing
export type FeatureDefinitionWithProjects = FeatureDefinition & {
  projects?: string[];
};

// TODO: remove this intermediary type used for payload scrubbing
export type AutoExperimentWithProject = AutoExperiment & {
  project?: string;
};
