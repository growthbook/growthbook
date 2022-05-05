/* eslint-disable @typescript-eslint/no-explicit-any */

export type FeatureValueType = "boolean" | "string" | "number" | "json";

export interface FeatureEnvironment {
  enabled: boolean;
  rules: FeatureRule[];
}

export type LegacyFeatureInterface = FeatureInterface & {
  /** @deprecated */
  environments?: string[];
  /** @deprecated */
  rules?: FeatureRule[];
};

export interface FeatureDraftChanges {
  active: boolean;
  dateCreated?: Date;
  dateUpdated?: Date;
  defaultValue?: string;
  rules?: Record<string, FeatureRule[]>;
}

export interface FeatureInterface {
  id: string;
  description?: string;
  organization: string;
  project?: string;
  dateCreated: Date;
  dateUpdated: Date;
  valueType: FeatureValueType;
  defaultValue: string;
  tags?: string[];
  environmentSettings?: Record<string, FeatureEnvironment>;
  draft?: FeatureDraftChanges;
  revision?: number;
  revisionComment?: string;
  revisionDate?: Date;
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

type NamespaceValue = {
  enabled: boolean;
  name: string;
  range: [number, number];
};

export interface ExperimentRule extends BaseRule {
  type: "experiment";
  trackingKey: string;
  hashAttribute: string;
  namespace?: NamespaceValue;
  values: ExperimentValue[];
}

export type FeatureRule = ForceRule | RolloutRule | ExperimentRule;
