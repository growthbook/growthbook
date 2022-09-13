/* eslint-disable @typescript-eslint/no-empty-interface */
import * as z from "zod";
import {
  vFeatureValueType,
  vBaseRule,
  vForceRule,
  vRolloutRule,
  vExperimentRule,
  vExperimentValue,
  vNamespaceValue,
  vFeatureDraftChanges,
  vFeatureRevisionInterface,
  vFeatureEnvironment,
  vFeatureInterface,
  vUpdateFeatureInterface,
  vCreateFeatureInterface,
} from "./featureValidators";

export type LegacyFeatureInterface = FeatureInterface & {
  /** @deprecated */
  environments?: string[];
  /** @deprecated */
  rules?: FeatureRule[];
};

export type FeatureValueType = z.infer<typeof vFeatureValueType>;

export type ExperimentValue = z.infer<typeof vExperimentValue>;
export type NamespaceValue = z.infer<typeof vNamespaceValue>;

export interface BaseRule extends z.infer<typeof vBaseRule> {}

//BaseRule is already applied to ForceRule, RolloutRule, and ExperimentRule
export interface ForceRule extends z.infer<typeof vForceRule> {}
export interface RolloutRule extends z.infer<typeof vRolloutRule> {}
export interface ExperimentRule extends z.infer<typeof vExperimentRule> {}
export type FeatureRule = ForceRule | RolloutRule | ExperimentRule;

export interface FeatureDraftChanges
  extends z.infer<typeof vFeatureDraftChanges> {}
export interface FeatureRevisionInterface
  extends z.infer<typeof vFeatureRevisionInterface> {}
export interface FeatureEnvironment
  extends z.infer<typeof vFeatureEnvironment> {}

export interface FeatureInterface extends z.infer<typeof vFeatureInterface> {}
export interface CreateFeatureInterface
  extends z.infer<typeof vCreateFeatureInterface> {}
export interface UpdateFeatureInterface
  extends z.infer<typeof vUpdateFeatureInterface> {}
