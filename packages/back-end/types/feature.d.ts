import { Screenshot } from "./experiment";

export interface FeatureInterface {
  id: string;
  description?: string;
  organization: string;
  project?: string;
  dateCreated: Date;
  dateUpdated: Date;
  values: FeatureValue[];
  defaultValue: number;
  rules?: FeatureRule[];
}

export interface BaseRule {
  description: string;
  condition?: string;
  enabled?: boolean;
}

export interface ForceRule extends BaseRule {
  type: "force";
  value: number;
}

export interface RolloutRule extends BaseRule {
  type: "rollout";
  trackingKey: string;
  userIdType?: "user" | "anonymous";
  weights: number[];
}

export interface ExperimentRule extends BaseRule {
  type: "experiment";
  experiment: string; // ID of experiment
  variations: number[];
}

export type FeatureRule = ForceRule | RolloutRule | ExperimentRule;

export interface FeatureValue {
  name: string;
  value: string; // JSON-encoded string
  key?: string;
  description?: string;
  screenshots?: Screenshot[];
}
