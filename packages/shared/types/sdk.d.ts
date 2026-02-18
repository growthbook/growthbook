import {
  AutoExperiment,
  FeatureRule as FeatureDefinitionRule,
} from "@growthbook/growthbook";

export interface FeatureDefinition {
  // eslint-disable-next-line
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
}

/** @deprecated Legacy type. Use standard FeatureDefinition instead. */
export type FeatureDefinitionWithProject = FeatureDefinition & {
  project?: string;
};

/** @deprecated Legacy type. Use standard FeatureDefinition instead. */
export type FeatureDefinitionWithProjects = FeatureDefinition & {
  projects?: string[];
};

/** @deprecated Legacy type. Use standard AutoExperiment instead. */
export type AutoExperimentWithProject = AutoExperiment & {
  project?: string;
};
