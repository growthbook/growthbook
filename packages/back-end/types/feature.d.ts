/* eslint-disable @typescript-eslint/no-explicit-any */

export type FeatureValueType = "boolean" | "string" | "number" | "json";

export interface FeatureInterface {
  id: string;
  description?: string;
  organization: string;
  project?: string;
  dateCreated: Date;
  dateUpdated: Date;
  valueType: FeatureValueType;
  defaultValue: string;
  rules?: FeatureRule[];
}

export interface BaseRule {
  description: string;
  condition?: string;
  enabled?: boolean;
}

export interface ForceRule extends BaseRule {
  type: "force";
  value: string;
}

type RolloutValue = {
  value: string;
  weight: number;
};

export interface RolloutRule extends BaseRule {
  type: "rollout";
  trackingKey: string;
  userIdType?: "user" | "anonymous";
  rollout: RolloutValue[];
}

export interface ExperimentRule extends BaseRule {
  type: "experiment";
  experiment: string; // ID of experiment
  variations: string[];
}

export type FeatureRule = ForceRule | RolloutRule | ExperimentRule;
