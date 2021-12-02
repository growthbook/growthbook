import type { GrowthBook } from ".";

declare global {
  interface Window {
    _growthbook?: GrowthBook;
  }
}

interface ForceFeatureRule {
  type: "force";
  value: number;
}

interface ExperimentFeatureRule {
  type: "experiment";
  variations?: number[];
  weights?: number[];
  trackingKey?: string;
  hashAttribute?: string;
  coverage?: number;
  namespace?: [string, number, number];
}

type OrRule = {
  $or: RuleSet[];
};
type NorRule = {
  $nor: RuleSet[];
};
type AndRule = {
  $and: RuleSet[];
};
type NotRule = {
  $not: RuleSet;
};
type Operator =
  | "$in"
  | "$nin"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte"
  | "$regex"
  | "$ne"
  | "$eq"
  | "$size"
  | "$elemMatch"
  | "$all"
  | "$not"
  | "$type"
  | "$exists";
type VarType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "null"
  | "undefined";
type OperatorRule = {
  $in?: (string | number)[];
  $nin?: (string | number)[];
  $gt?: number | string;
  $gte?: number | string;
  $lt?: number | string;
  $lte?: number | string;
  $regex?: string;
  $ne?: number | string;
  $eq?: number | string;
  $exists?: boolean;
  $all?: RuleValue[];
  $size?: number | RuleValue;
  $type?: VarType;
  $elemMatch?: RuleSet | OperatorRule;
  $not?: RuleValue;
};

type RuleValue =
  | OperatorRule
  | string
  | number
  | boolean
  // eslint-disable-next-line
  | Array<any>
  // eslint-disable-next-line
  | Record<string, any>;

type OperatorRuleSet = {
  [key: string]: RuleValue;
};

type RuleSet = OrRule | NorRule | AndRule | NotRule | OperatorRuleSet;

// eslint-disable-next-line
type TestedObj = Record<string, any>;

type FeatureRule = { condition?: RuleSet } & (
  | ForceFeatureRule
  | ExperimentFeatureRule
);

// eslint-disable-next-line
interface FeatureDefinition<T = any> {
  values?: T[];
  defaultValue?: number;
  rules?: FeatureRule[];
}

type FeatureResultSource =
  | "unknownFeature"
  | "defaultValue"
  | "force"
  | "experiment";

// eslint-disable-next-line
interface FeatureResult<T = any> {
  value: T | null;
  source: FeatureResultSource;
  on: boolean;
  off: boolean;
  experiment?: Experiment<T>;
}

type ExperimentStatus = "draft" | "running" | "stopped";

interface LegacyExperiment<T> {
  key: string;
  variations: [T, T, ...T[]];
  weights?: number[];
  coverage?: number;
  include?: () => boolean;
  namespace?: [string, number, number];
  force?: number;
  hashAttribute?: string;
  status?: ExperimentStatus;
  url?: RegExp;
  groups?: string[];
}

interface NewExperiment<T> {
  trackingKey: string;
  variations: [T, T, ...T[]];
  condition?: Condition;
  weights?: number[];
  active?: boolean;
  coverage?: number;
  include?: () => boolean;
  namespace?: [string, number, number];
  force?: number;
  hashAttribute?: string;
}

type Experiment<T> = LegacyExperiment<T> | NewExperiment<T>;

type ExperimentOverride = {
  condition?: Condition;
  weights?: number[];
  active?: boolean;
  status?: ExperimentStatus;
  force?: number;
  coverage?: number;
  groups?: string[];
  namespace?: [string, number, number];
  url?: RegExp | string;
};

interface Result<T> {
  value: T;
  variationId: number;
  inExperiment: boolean;
  hashAttribute: string;
  hashValue: string;
}

interface Context {
  enabled?: boolean;
  user?: {
    id?: string;
    anonId?: string;
    [key: string]: string | undefined;
  };
  // eslint-disable-next-line
  attributes?: Record<string, any>;
  groups?: Record<string, boolean>;
  url?: string;
  overrides?: Record<string, ExperimentOverride>;
  features?: Record<string, FeatureDefinition>;
  forcedVariations?: Record<string, number>;
  qaMode?: boolean;
  // eslint-disable-next-line
  trackingCallback?: (experiment: Experiment<any>, result: Result<any>) => void;
}

type SubscriptionFunction = (
  // eslint-disable-next-line
  experiment: Experiment<any>,
  // eslint-disable-next-line
  result: Result<any>
) => void;

type VariationRange = [number, number];
