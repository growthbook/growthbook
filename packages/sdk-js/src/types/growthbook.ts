/* eslint-disable @typescript-eslint/no-explicit-any */

import "./globals";
import type { StickyBucketService } from "..";
import { ConditionInterface, ParentConditionInterface } from "./mongrule";

export type VariationMeta = {
  passthrough?: boolean;
  key?: string;
  name?: string;
};

/** Rules that define a feature, included on {@link FeatureDefinition} */
export type FeatureRule<T = any> = {
  id?: string;
  condition?: ConditionInterface;
  parentConditions?: ParentConditionInterface[];
  force?: T;
  variations?: T[];
  weights?: number[];
  key?: string;
  hashAttribute?: string;
  fallbackAttribute?: string;
  hashVersion?: number;
  disableStickyBucketing?: boolean;
  bucketVersion?: number;
  minBucketVersion?: number;
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

/** Feature default value and rules */
export interface FeatureDefinition<T = any> {
  defaultValue?: T;
  rules?: FeatureRule<T>[];
}

/** The reason for a feature's evaluation */
export type FeatureResultSource =
  | "unknownFeature"
  | "defaultValue"
  | "force"
  | "override"
  | "experiment"
  | "prerequisite"
  | "cyclicPrerequisite";

/** A feature's evaluation result */
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

/**
 * Represents the type of URL targeting used in the GrowthBook SDK.
 *
 * - "regex": Uses regular expressions for URL matching.
 * - "simple": Uses simple string matching for URLs.
 */
export type UrlTargetType = "regex" | "simple";

/**
 * Represents a URL target configuration.
 *
 * @property {boolean} include - Indicates whether the URL pattern should be included.
 * @property {UrlTargetType} type - The type of URL target.
 * @property {string} pattern - The URL pattern to match.
 */
export type UrlTarget = {
  include: boolean;
  type: UrlTargetType;
  pattern: string;
};

/** Represents an experiment */
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
  parentConditions?: ParentConditionInterface[];
  coverage?: number;
  include?: () => boolean;
  /** @deprecated */
  namespace?: [string, number, number];
  force?: number;
  hashAttribute?: string;
  fallbackAttribute?: string;
  hashVersion?: number;
  disableStickyBucketing?: boolean;
  bucketVersion?: number;
  minBucketVersion?: number;
  active?: boolean;
  persistQueryString?: boolean;
  /** @deprecated */
  status?: ExperimentStatus;
  /** @deprecated */
  url?: RegExp;
  /** @deprecated */
  groups?: string[];
};

/**
 * Represents the type of change in an auto experiment.
 *
 * - "redirect": Indicates a change that involves redirecting the user via URL.
 * - "visual": Indicates a change made with the Visual Editor.
 * - "unknown": Indicates an unknown type of change.
 */
export type AutoExperimentChangeType = "redirect" | "visual" | "unknown";

/**
 * Represents an automatic experiment with optional manual triggering.
 */
export type AutoExperiment<T = AutoExperimentVariation> = Experiment<T> & {
  changeId?: string;
  // If true, require the experiment to be manually triggered
  manual?: boolean;
};

/**
 * Represents an override for an experiment configuration.
 */
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

/** Experiment result data */
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
  stickyBucketUsed?: boolean;
}

/** Defines user attributes for feature targeting and assinging persistent variations in A/B tests */
export type Attributes = Record<string, any>;

export type RealtimeUsageData = {
  key: string;
  on: boolean;
};

/** Data required to track experiment results */
export interface TrackingData {
  experiment: Experiment<any>;
  result: Result<any>;
}

/** Function fired when an experiment is evaluated */
export type TrackingCallback = (
  experiment: Experiment<any>,
  result: Result<any>
) => Promise<void> | void;

/**
 * A callback for handling navigation events.
 */
export type NavigateCallback = (url: string) => void | Promise<void>;

/**
 * A callback that applies DOM changes based on the provided experiment variation.
 */
export type ApplyDomChangesCallback = (
  changes: AutoExperimentVariation
) => () => void;

/**
 * A custom rendering function to run when features change
 */
export type RenderFunction = () => void;

/** GrowthBook data */
export interface Context {
  enabled?: boolean;
  attributes?: Attributes;
  url?: string;
  features?: Record<string, FeatureDefinition>;
  experiments?: AutoExperiment[];
  forcedVariations?: Record<string, number>;
  blockedChangeIds?: string[];
  disableVisualExperiments?: boolean;
  disableJsInjection?: boolean;
  jsInjectionNonce?: string;
  disableUrlRedirectExperiments?: boolean;
  disableCrossOriginUrlRedirectExperiments?: boolean;
  disableExperimentsOnLoad?: boolean;
  stickyBucketAssignmentDocs?: Record<
    StickyAttributeKey,
    StickyAssignmentsDocument
  >;
  stickyBucketIdentifierAttributes?: string[];
  stickyBucketService?: StickyBucketService;
  debug?: boolean;
  log?: (msg: string, ctx: any) => void;
  qaMode?: boolean;
  /** @deprecated */
  backgroundSync?: boolean;
  /** @deprecated */
  subscribeToChanges?: boolean;
  enableDevMode?: boolean;
  disableCache?: boolean;
  /** @deprecated */
  disableDevTools?: boolean;
  trackingCallback?: TrackingCallback;
  onFeatureUsage?: (key: string, result: FeatureResult<any>) => void;
  /** @deprecated */
  realtimeKey?: string;
  /** @deprecated */
  realtimeInterval?: number;
  cacheKeyAttributes?: (keyof Attributes)[];
  /** @deprecated */
  user?: {
    id?: string;
    anonId?: string;
    [key: string]: string | undefined;
  };
  /** @deprecated */
  overrides?: Record<string, ExperimentOverride>;
  /** @deprecated */
  groups?: Record<string, boolean>;
  apiHost?: string;
  streamingHost?: string;
  apiHostRequestHeaders?: Record<string, string>;
  streamingHostRequestHeaders?: Record<string, string>;
  clientKey?: string;
  renderer?: null | RenderFunction;
  decryptionKey?: string;
  remoteEval?: boolean;
  navigate?: NavigateCallback;
  navigateDelay?: number;
  maxNavigateDelay?: number;
  /** @deprecated */
  antiFlicker?: boolean;
  /** @deprecated */
  antiFlickerTimeout?: number;
  applyDomChangesCallback?: ApplyDomChangesCallback;
  savedGroups?: SavedGroupsValues;
}

/**
 * Options for prefetching data
 */
export type PrefetchOptions = Pick<
  Context,
  | "decryptionKey"
  | "apiHost"
  | "apiHostRequestHeaders"
  | "streamingHost"
  | "streamingHostRequestHeaders"
> & {
  clientKey: string;
  streaming?: boolean;
  skipCache?: boolean;
};

export type SubscriptionFunction = (
  experiment: Experiment<any>,
  result: Result<any>
) => void;

/*
 * A tuple representing ranges for variations
 */
export type VariationRange = [number, number];

/** Info about whether a payload was set and where it came from */
export interface InitResponse {
  // If a payload was set
  success: boolean;
  // Where the payload came from, if set
  source: "init" | "cache" | "network" | "error" | "timeout";
  // If the payload could not be set (success = false), this will hold the fetch error
  error?: Error;
}

/**
 * Represents the response from a fetch operation.
 */
export interface FetchResponse {
  data: FeatureApiResponse | null;
  success: boolean;
  source: "cache" | "network" | "error" | "timeout";
  error?: Error;
}

export type JSONValue =
  | null
  | number
  | string
  | boolean
  | Array<JSONValue>
  | Record<string, unknown>
  | { [key: string]: JSONValue };

/**
 * A utility type that widens primitive types to their respective general types.
 */
export type WidenPrimitives<T> = T extends string
  ? string
  : T extends number
  ? number
  : T extends boolean
  ? boolean
  : T;

export type FeatureEvalContext = {
  id?: string;
  evaluatedFeatures: Set<string>;
};

/**
 * Represents a mutation to be applied to the DOM.
 */
export type DOMMutation = {
  selector: string;
  action: string;
  attribute: string;
  value?: string;
  parentSelector?: string;
  insertBeforeSelector?: string;
};

/**
 * Represents a variation for an auto experiment.
 */
export type AutoExperimentVariation = {
  domMutations?: DOMMutation[];
  css?: string;
  js?: string;
  urlRedirect?: string;
};

/**
 * A type representing a collection of feature definitions.
 *
 * Each key in the record is a string representing the feature name,
 * and the corresponding value is a `FeatureDefinition` object that
 * describes the feature's properties and behavior.
 */
export type FeatureDefinitions = Record<string, FeatureDefinition>;

/**
 * Represents the response from the Feature API.
 */
export type FeatureApiResponse = {
  features?: FeatureDefinitions;
  dateUpdated?: string;
  encryptedFeatures?: string;
  experiments?: AutoExperiment[];
  encryptedExperiments?: string;
  savedGroups?: SavedGroupsValues;
  encryptedSavedGroups?: string;
};

/**  Alias for {@link FeatureApiResponse} */
export type GrowthBookPayload = FeatureApiResponse;

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

export type Helpers = {
  fetchFeaturesCall: ({
    host,
    clientKey,
    headers,
  }: {
    host: string;
    clientKey: string;
    headers?: Record<string, string>;
  }) => Promise<Response>;
  fetchRemoteEvalCall: ({
    host,
    clientKey,
    payload,
    headers,
  }: {
    host: string;
    clientKey: string;
    // eslint-disable-next-line
    payload: any;
    headers?: Record<string, string>;
  }) => Promise<Response>;
  eventSourceCall: ({
    host,
    clientKey,
    headers,
  }: {
    host: string;
    clientKey: string;
    headers?: Record<string, string>;
  }) => EventSource;
  startIdleListener: () => (() => void) | void;
  stopIdleListener: () => void;
};

/**
 * Interface representing a compatibility layer for local storage operations.
 */
export interface LocalStorageCompat {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

/**
 * Configuration settings for caching mechanisms.
 */
export type CacheSettings = {
  backgroundSync: boolean;
  cacheKey: string;
  staleTTL: number;
  maxAge: number;
  maxEntries: number;
  disableIdleStreams: boolean;
  idleStreamInterval: number;
  disableCache: boolean;
};

/** API Host URL */
export type ApiHost = string;
/** SDK Client Key */
export type ClientKey = string;

/** Options to set when initializing GrowthBook */
export type InitOptions = {
  timeout?: number;
  skipCache?: boolean;
  payload?: FeatureApiResponse;
  streaming?: boolean;
  cacheSettings?: CacheSettings;
};

/** Options to set when initializing GrowthBook synchronously */
export type InitSyncOptions = {
  payload: FeatureApiResponse;
  streaming?: boolean;
};

export type LoadFeaturesOptions = {
  /** @deprecated */
  autoRefresh?: boolean;
  timeout?: number;
  skipCache?: boolean;
};

/** Options to set when refreshing features */
export type RefreshFeaturesOptions = {
  timeout?: number;
  skipCache?: boolean;
};

/** Attributes to run mutually exclusive experiments */
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

export type StickyAttributeKey = string; // `${attributeName}||${attributeValue}`
export type StickyExperimentKey = string; // `${experimentId}__{version}`
export type StickyAssignments = Record<StickyExperimentKey, string>;
export interface StickyAssignmentsDocument {
  attributeName: string;
  attributeValue: string;
  assignments: StickyAssignments;
}

export type SavedGroupsValues = Record<string, (string | number)[]>;
