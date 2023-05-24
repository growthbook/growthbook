/* eslint-disable @typescript-eslint/no-explicit-any */

import type { GrowthBook } from "..";
import { ConditionInterface } from "./mongrule";

declare global {
  interface Window {
    _growthbook?: GrowthBook;
  }
}

export type VariationMeta = {
  passthrough?: boolean;
  key?: string;
  name?: string;
};

export type FeatureRule<T = any> = {
  id?: string;
  condition?: ConditionInterface;
  force?: T;
  variations?: T[];
  weights?: number[];
  key?: string;
  hashAttribute?: string;
  hashVersion?: number;
  range?: VariationRange;
  coverage?: number;
  /** @deprecated */
  namespace?: [string, number, number];
  ranges?: VariationRange[];
  meta?: VariationMeta[];
  filters?: Filter[];
  seed?: string;
  name?: string;
  phase?: string;
  tracks?: Array<{
    experiment: Experiment<T>;
    result: Result<T>;
  }>;
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

/** @deprecated */
export type ExperimentStatus = "draft" | "running" | "stopped";

export type UrlTargetType = "regex" | "simple";

export type UrlTarget = {
  include: boolean;
  type: UrlTargetType;
  pattern: string;
};

export type Experiment<T> = {
  key: string;
  variations: [T, T, ...T[]];
  ranges?: VariationRange[];
  meta?: VariationMeta[];
  filters?: Filter[];
  seed?: string;
  name?: string;
  phase?: string;
  urlPatterns?: UrlTarget[];
  weights?: number[];
  condition?: ConditionInterface;
  coverage?: number;
  include?: () => boolean;
  /** @deprecated */
  namespace?: [string, number, number];
  force?: number;
  hashAttribute?: string;
  hashVersion?: number;
  active?: boolean;
  /** @deprecated */
  status?: ExperimentStatus;
  /** @deprecated */
  url?: RegExp;
  /** @deprecated */
  groups?: string[];
};

export type AutoExperiment = Experiment<AutoExperimentVariation> & {
  // If true, require the experiment to be manually triggered
  manual?: boolean;
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
  key: string;
  name?: string;
  bucket?: number;
  passthrough?: boolean;

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
  experiments?: AutoExperiment[];
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

export type DOMMutation = {
  selector: string;
  action: string;
  attribute: string;
  value?: string;
  parentSelector?: string;
  insertBeforeSelector?: string;
};

export type AutoExperimentVariation = {
  domMutations?: DOMMutation[];
  css?: string;
  js?: string;
};

export type FeatureDefinitions = Record<string, FeatureDefinition>;

export type FeatureApiResponse = {
  features?: FeatureDefinitions;
  dateUpdated?: string;
  encryptedFeatures?: string;
  experiments?: AutoExperiment[];
  encryptedExperiments?: string;
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
  localStorage?: LocalStorageCompat;
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

export interface Filter {
  // Override the hashAttribute used for this filter
  attribute?: string;
  // The hash seed
  seed: string;
  // The hashing version to use
  hashVersion: number;
  // Only include these resulting ranges
  ranges: VariationRange[];
}
