/* eslint-disable @typescript-eslint/no-explicit-any */

import type { GrowthBook } from "..";

declare global {
  interface Window {
    _growthbook?: GrowthBook;
  }
}

type FeatureRule<T = any> = {
  condition?: RuleSet;
  force?: T;
  variations?: T[];
  weights?: number[];
  key?: string;
  hashAttribute?: string;
  coverage?: number;
  namespace?: [string, number, number];
};

interface FeatureDefinition<T = any> {
  defaultValue?: T;
  rules?: FeatureRule<T>[];
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

type Experiment<T> = {
  key: string;
  variations: [T, T, ...T[]];
  weights?: number[];
  condition?: Condition;
  coverage?: number;
  include?: () => boolean;
  namespace?: [string, number, number];
  force?: number;
  hashAttribute?: string;
  active?: boolean;
  /* @deprecated */
  status?: ExperimentStatus;
  /* @deprecated */
  url?: RegExp;
  /* @deprecated */
  groups?: string[];
};

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
