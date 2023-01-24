/* eslint-disable @typescript-eslint/no-explicit-any */

import type { GrowthBook } from "..";
import { ConditionInterface } from "./mongrule";

declare global {
  interface Window {
    _growthbook?: GrowthBook;
  }
}

export type FeatureRule<T = any> = {
  id?: string;
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
  ruleId: string;
  experiment?: Experiment<T>;
  experimentResult?: Result<T>;
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
  hashUsed?: boolean;
  hashAttribute: string;
  hashValue: string;
  featureId: string | null;
}

export type Attributes = Record<string, any>;

export type RealtimeUsageData = {
  key: string;
  on: boolean;
};

export interface Context {
  enabled?: boolean;
  attributes?: Attributes;
  url?: string;
  features?: Record<string, FeatureDefinition>;
  forcedVariations?: Record<string, number>;
  log?: (msg: string, ctx: any) => void;
  qaMode?: boolean;
  enableDevMode?: boolean;
  /* @deprecated */
  disableDevTools?: boolean;
  trackingCallback?: (experiment: Experiment<any>, result: Result<any>) => void;
  onFeatureUsage?: (key: string, result: FeatureResult<any>) => void;
  realtimeKey?: string;
  realtimeInterval?: number;
  /* @deprecated */
  user?: {
    id?: string;
    anonId?: string;
    [key: string]: string | undefined;
  };
  /* @deprecated */
  overrides?: Record<string, ExperimentOverride>;
  /* @deprecated */
  groups?: Record<string, boolean>;
  apiHost?: string;
  clientKey?: string;
  decryptionKey?: string;
}

export type SubscriptionFunction = (
  experiment: Experiment<any>,
  result: Result<any>
) => void;

export type VariationRange = [number, number];

export type JSONValue =
  | null
  | number
  | string
  | boolean
  | Array<JSONValue>
  | { [key: string]: JSONValue };

export type WidenPrimitives<T> = T extends string
  ? string
  : T extends number
  ? number
  : T extends boolean
  ? boolean
  : T;

export type FeatureDefinitions = Record<string, FeatureDefinition>;

export type FeatureApiResponse = {
  features?: FeatureDefinitions;
  dateUpdated?: string;
  encryptedFeatures?: string;
};

// Polyfills required for non-standard browser environments (ReactNative, Node, etc.)
// These are typed as `any` since polyfills like `node-fetch` are not 100% compatible with native types
export type Polyfills = {
  // eslint-disable-next-line
  fetch: any;
  // eslint-disable-next-line
  SubtleCrypto: any;
  // eslint-disable-next-line
  EventSource: any;
  localStorage: LocalStorageCompat;
};

export interface LocalStorageCompat {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

export type CacheSettings = {
  backgroundSync: boolean;
  cacheKey: string;
  staleTTL: number;
};

export type ApiHost = string;
export type ClientKey = string;
export type RepositoryKey = `${ApiHost}||${ClientKey}`;

export type LoadFeaturesOptions = {
  autoRefresh?: boolean;
  timeout?: number;
  skipCache?: boolean;
};

export type RefreshFeaturesOptions = {
  timeout?: number;
  skipCache?: boolean;
};
