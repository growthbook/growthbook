/* eslint-disable @typescript-eslint/no-explicit-any */

import type { GrowthBook } from "..";
import { ConditionInterface } from "./mongrule";

declare global {
  interface Window {
    _growthbook?: GrowthBook;
  }
}

export type FeatureRule<T = any> = {
  condition?: ConditionInterface;
  force?: T;
  variations?: T[];
  weights?: number[];
  key?: string;
  hashAttribute?: string;
  coverage?: number;
  namespace?: [string, number, number];
};

export interface FeatureDefinition<T = any> {
  defaultValue?: T;
  rules?: FeatureRule<T>[];
}

export type FeatureResultSource =
  | "unknownFeature"
  | "defaultValue"
  | "force"
  | "override"
  | "experiment";

export interface FeatureResult<T = any> {
  value: T | null;
  source: FeatureResultSource;
  on: boolean;
  off: boolean;
  experiment?: Experiment<T>;
}

export type ExperimentStatus = "draft" | "running" | "stopped";

export type Experiment<T> = {
  key: string;
  variations: [T, T, ...T[]];
  weights?: number[];
  condition?: ConditionInterface;
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

export type ExperimentOverride = {
  condition?: ConditionInterface;
  weights?: number[];
  active?: boolean;
  status?: ExperimentStatus;
  force?: number;
  coverage?: number;
  groups?: string[];
  namespace?: [string, number, number];
  url?: RegExp | string;
};

export interface Result<T> {
  value: T;
  variationId: number;
  inExperiment: boolean;
  hashAttribute: string;
  hashValue: string;
}

export type Attributes = Record<string, any>;

export interface Context {
  enabled?: boolean;
  user?: {
    id?: string;
    anonId?: string;
    [key: string]: string | undefined;
  };
  attributes?: Attributes;
  groups?: Record<string, boolean>;
  url?: string;
  overrides?: Record<string, ExperimentOverride>;
  features?: Record<string, FeatureDefinition>;
  forcedVariations?: Record<string, number>;
  log?: (msg: string, ctx: any) => void;
  qaMode?: boolean;
  noWindowRef?: boolean;
  trackingCallback?: (experiment: Experiment<any>, result: Result<any>) => void;
}

export type SubscriptionFunction = (
  experiment: Experiment<any>,
  result: Result<any>
) => void;

export type VariationRange = [number, number];
