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
  /** @deprecated */
  environments: string[];
  defaultValue: string;
  /** @deprecated */
  rules?: FeatureRule[];
  environmentSettings?: Record<
    string,
    {
      enabled: boolean;
      defaultValue?: string;
      rules: FeatureRule[];
    }
  >;
}

export interface BaseRule {
  description: string;
  condition?: string;
  id: string;
  enabled?: boolean;
}

export interface ForceRule extends BaseRule {
  type: "force";
  value: string;
}

export interface RolloutRule extends BaseRule {
  type: "rollout";
  value: string;
  coverage: number;
  hashAttribute: string;
}

type ExperimentValue = {
  value: string;
  weight: number;
};

export interface ExperimentRule extends BaseRule {
  type: "experiment";
  trackingKey: string;
  hashAttribute: string;
  values: ExperimentValue[];
}

export type FeatureRule = ForceRule | RolloutRule | ExperimentRule;
