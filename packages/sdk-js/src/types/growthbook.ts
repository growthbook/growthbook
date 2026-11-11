/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  GrowthBook,
  GrowthBookClient,
  StickyBucketService,
  UserScopedGrowthBook,
} from "..";
import { ConditionInterface, ParentConditionInterface } from "./mongrule";

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
  contextualBanditRef?: string;
  contextualVariations?: T[];
  metadata?: PayloadMetadata;
};

export type ContextualBanditDefinition = {
  banditVersion?: number;
  contexts: {
    leafId: number;
    condition: Record<string, unknown>;
    weights: number[];
  }[];
};

export type ContextualBanditDefinitions = Record<
  string,
  ContextualBanditDefinition
>;

export type InterleavingDefinition = {
  trackingKey: string;
  // Carried here, not read off the pseudo flag's rule: remote evaluation
  // replaces rules with a forced defaultValue, so the rule is gone client-side.
  hashAttribute: string;
  seed: string;
  variations: { key: string; config: Record<string, unknown> }[];
};

export type InterleavingDefinitions = Record<string, InterleavingDefinition>;

export interface FeatureDefinition<T = any> {
  defaultValue?: T;
  rules?: FeatureRule<T>[];
  metadata?: PayloadMetadata;
}

/**
 * Sent when the SDK Connection opts in. A feature in every project has
 * `allProjects` instead of `projects`, and one in no project has neither.
 */
export type PayloadMetadata = {
  projects?: string[];
  allProjects?: boolean;
  tags?: string[];
  customFields?: Record<string, unknown>;
};

export type FeatureResultSource =
  | "unknownFeature"
  | "defaultValue"
  | "force"
  | "override"
  | "experiment"
  | "prerequisite"
  | "cyclicPrerequisite";

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
  contextualBandit?: CBContext;
  /** @deprecated */
  status?: ExperimentStatus;
  /** @deprecated */
  url?: RegExp;
  /** @deprecated */
  groups?: string[];
};

export type AutoExperimentChangeType = "redirect" | "visual" | "unknown";

export type AutoExperiment<T = AutoExperimentVariation> = Experiment<T> & {
  changeId?: string;
  // If true, require the experiment to be manually triggered
  manual?: boolean;
  metadata?: PayloadMetadata;
  contextualBanditRef?: string;
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
  stickyBucketUsed?: boolean;
  leafId?: number;
  variationWeights?: number[];
  banditVersion?: number;
}

export type CBContext = {
  leafId: number;
  variationWeights: number[];
  banditVersion?: number;
};

export type Attributes = Record<string, any>;

/**
 * Register your app's feature and attribute types once and every GrowthBook
 * instance and React hook is typed with no generics:
 *
 *   declare module "@growthbook/growthbook" {
 *     interface Register {
 *       features: AppFeatures;
 *       attributes: AppAttributes;
 *     }
 *   }
 *
 * Or register a payload written in code (`payload: typeof payload`) in place
 * of `features`: feature types come from each `defaultValue`, and
 * `getFeatureValue` needs no fallback for a feature that has one, other than
 * a boolean (use `isOn`, or pass the fallback). With no fallback, a feature
 * with no value (missing, blocked by a prerequisite...) uses its
 * `defaultValue`: the one in the SDK's payload, else the one in the
 * `fallbackPayload` given to `init`. Pass a fallback to use a different value.
 * Registering a payload is a promise that one of the two has each feature.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register {}
// Feature types taken from each defaultValue in a payload written in code
export type PayloadFeatures<P> = P extends { features: infer F }
  ? { [K in keyof F]: F[K] extends { defaultValue: infer V } ? V : unknown }
  : Record<string, any>;
export type RegisteredFeatures = Register extends { features: infer F }
  ? F
  : Register extends { payload: infer P }
    ? PayloadFeatures<P>
    : Record<string, any>;
// Features in the registered payload whose defaultValue can't be null, so
// `getFeatureValue` can return it instead of requiring a fallback. Boolean
// features are left out: `isOn` is false when there is no value, and a
// `true` default here would disagree with it.
export type BundledFeatureKey = Register extends {
  payload: { features: infer F };
}
  ? {
      [K in keyof F]: F[K] extends {
        defaultValue: string | number | object;
      }
        ? K
        : never;
    }[keyof F] &
      string
  : never;
export type RegisteredAttributes = Register extends { attributes: infer A }
  ? A
  : Attributes;
// Stops an argument from being used to infer T, which would override the
// registered default (the built-in NoInfer needs TypeScript 5.4+)
export type NoInferType<T> = [T][T extends unknown ? 0 : never];

// Loosely typed attributes: callbacks are not tied to one instance's types, so
// the registered types would be wrong for an instance with its own generics
export type TrackingUserContext = Pick<
  UserContext<Attributes>,
  "attributes" | "url"
>;

export interface TrackingData {
  experiment: Experiment<any>;
  result: Result<any>;
  user?: TrackingUserContext;
}

export interface TrackingDataWithUser {
  experiment: Experiment<any>;
  result: Result<any>;
  user: TrackingUserContext;
}

export type TrackingCallback = (
  experiment: Experiment<any>,
  result: Result<any>,
  user?: TrackingUserContext,
) => Promise<void> | void;

export type TrackingCallbackWithUser = (
  experiment: Experiment<any>,
  result: Result<any>,
  user: TrackingUserContext,
) => Promise<void> | void;

export type FeatureUsageCallback = (
  key: string,
  result: FeatureResult<any>,
) => void;

export type FeatureUsageCallbackWithUser = (
  key: string,
  result: FeatureResult<any>,
  user: TrackingUserContext,
) => void;

// Callback types for internal plugin subscriptions (e.g. session replay).
// Must be synchronous — async callbacks are not awaited and rejected promises won't be caught.
export type FeatureUsageSubCallback = (
  key: string,
  result: Readonly<FeatureResult<any>>,
) => void;

export type CustomEventSubCallback = (
  eventName: string,
  properties: Readonly<Record<string, unknown>>,
) => void;

export type ExperimentViewedSubCallback = (
  experiment: Readonly<Experiment<unknown>>,
  result: Readonly<Result<unknown>>,
  user: TrackingUserContext,
) => void;

export type Plugin = (
  gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient,
) => void;

export type EventProperties = Record<string, unknown>;
export type EventLogger = (
  eventName: string,
  properties: EventProperties,
  userContext: TrackingUserContext,
) => void | Promise<void>;

export type NavigateCallback = (url: string) => void | Promise<void>;

export type ApplyDomChangesCallback = (
  changes: AutoExperimentVariation,
) => () => void;

export type RenderFunction = () => void;

// Constructor Options
export type Options<AppAttributes extends Attributes = RegisteredAttributes> = {
  enabled?: boolean;
  attributes?: AppAttributes;
  /** The user's remote saved groups; wins over a `__gb_remoteGroupIds` attribute. */
  remoteGroupIds?: string[];
  url?: string;
  features?: Record<string, FeatureDefinition>;
  experiments?: AutoExperiment[];
  forcedVariations?: Record<string, number>;
  forcedFeatureValues?: Map<string, any>;
  attributeOverrides?: Partial<AppAttributes>;
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
  onFeatureUsage?: FeatureUsageCallback;
  eventLogger?: EventLogger;
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
  savedGroups?: SavedGroupsPayload;
  contextualBandits?: ContextualBanditDefinitions;
  plugins?: Plugin[];
};

export type ClientOptions<
  AppAttributes extends Attributes = RegisteredAttributes,
> = {
  enabled?: boolean;
  debug?: boolean;
  globalAttributes?: Partial<AppAttributes>;
  forcedVariations?: Record<string, number>;
  forcedFeatureValues?: Map<string, any>;
  log?: (msg: string, ctx: any) => void;
  qaMode?: boolean;
  disableCache?: boolean;
  trackingCallback?: TrackingCallbackWithUser;
  onFeatureUsage?: (
    key: string,
    result: FeatureResult<any>,
    user: TrackingUserContext,
  ) => void;
  eventLogger?: EventLogger;
  apiHost?: string;
  streamingHost?: string;
  apiHostRequestHeaders?: Record<string, string>;
  streamingHostRequestHeaders?: Record<string, string>;
  clientKey?: string;
  decryptionKey?: string;
  savedGroups?: SavedGroupsPayload;
  contextualBandits?: ContextualBanditDefinitions;
  plugins?: Plugin[];
};

// Contexts
export type GlobalContext = {
  log: (msg: string, ctx: any) => void;
  debug?: boolean;
  features?: FeatureDefinitions;
  experiments?: AutoExperiment[];
  enabled?: boolean;
  qaMode?: boolean;
  savedGroups?: SavedGroupsPayload;
  contextualBandits?: ContextualBanditDefinitions;
  forcedVariations?: Record<string, number>;
  forcedFeatureValues?: Map<string, any>;
  trackingCallback?: TrackingCallbackWithUser;
  onFeatureUsage?: FeatureUsageCallbackWithUser;
  onExperimentEval?: (experiment: Experiment<any>, result: Result<any>) => void;
  saveDeferredTrack?: (data: TrackingData) => void;
  recordChangeId?: (changeId: string) => void;
  eventLogger?: EventLogger;

  /** @deprecated */
  overrides?: Record<string, ExperimentOverride>;
  /** @deprecated */
  groups?: Record<string, boolean>;
  /** @deprecated */
  user?: {
    id?: string;
    anonId?: string;
    [key: string]: string | undefined;
  };
};

// Some global fields can be overridden by the user, others are always user-level
export type UserContext<
  AppAttributes extends Attributes = RegisteredAttributes,
> = {
  enabled?: boolean;
  qaMode?: boolean;
  enableDevMode?: boolean;
  attributes?: AppAttributes;
  /** The user's remote saved groups; wins over a `__gb_remoteGroupIds` attribute. */
  remoteGroupIds?: string[];
  url?: string;
  blockedChangeIds?: string[];
  stickyBucketAssignmentDocs?: Record<
    StickyAttributeKey,
    StickyAssignmentsDocument
  >;
  saveStickyBucketAssignmentDoc?: (
    doc: StickyAssignmentsDocument,
  ) => Promise<unknown>;
  forcedVariations?: Record<string, number>;
  forcedFeatureValues?: Map<string, any>;
  attributeOverrides?: Partial<AppAttributes>;
  trackingCallback?: TrackingCallback;
  onFeatureUsage?: FeatureUsageCallback;
  trackedExperiments?: Set<string>;
  trackedFeatureUsage?: Record<string, string>;
  devLogs?: LogUnion[];
  featureUsageSubs?: Set<FeatureUsageSubCallback>;
  experimentViewedSubs?: Set<ExperimentViewedSubCallback>;
};

export type StackContext = {
  id?: string;
  evaluatedFeatures: Set<string>;
};

export type EvalContext = {
  global: GlobalContext;
  user: UserContext;
  stack: StackContext;
};

export type PrefetchOptions = Pick<
  Options,
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
  result: Result<any>,
) => void;

export type VariationRange = [number, number];

export interface InitResponse {
  // If a payload was set
  success: boolean;
  // Where the payload came from, if set
  source: "init" | "cache" | "network" | "error" | "timeout";
  // If the payload could not be set (success = false), this will hold the fetch error
  error?: Error;
}

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
  urlRedirect?: string;
};

// With AppFeatures, a payload written in code is checked against it: unknown
// keys and values of the wrong type are errors. Features may be left out,
// since a payload omits the ones that are toggled off. Without AppFeatures
// (the default) any payload is accepted, as is one typed `FeatureApiResponse`.
export type FeatureDefinitions<
  AppFeatures extends Record<string, any> = Record<string, any>,
> = string extends keyof AppFeatures
  ? Record<string, FeatureDefinition>
  : { [K in keyof AppFeatures]?: FeatureDefinition<AppFeatures[K]> };

export type FeatureApiResponse<
  AppFeatures extends Record<string, any> = Record<string, any>,
> = {
  features?: FeatureDefinitions<AppFeatures>;
  dateUpdated?: string;
  encryptedFeatures?: string;
  experiments?: AutoExperiment[];
  encryptedExperiments?: string;
  savedGroups?: SavedGroupsPayload;
  encryptedSavedGroups?: string;
  contextualBandits?: ContextualBanditDefinitions;
  encryptedContextualBandits?: string;
  interleavings?: InterleavingDefinitions;
  encryptedInterleavings?: string;
};

// Alias
export type GrowthBookPayload = FeatureApiResponse;

/** Each filter is an array, and any one of its values is enough */
export type PayloadFilters = {
  projects?: string[];
  tags?: string[];
  customFields?: Record<string, unknown[]>;
};

export type ReducePayloadOptions = {
  userContext?: UserContext;
  /** Keep only the features and auto experiments that match every filter */
  include?: PayloadFilters;
  /** Remove the features and auto experiments that match any filter */
  exclude?: PayloadFilters;
  /**
   * "keep" (default) sends the prerequisites of what is kept even when the
   * filters remove them, so the client evaluates the same as the full payload.
   * "filter" applies the filters to them too.
   */
  prerequisites?: "keep" | "filter";
};

// Polyfills required for non-standard browser environments (ReactNative, Node, etc.)
// These are typed as `any` since polyfills like `node-fetch` are not 100% compatible with native types
export type Polyfills = {
  fetch: any;
  SubtleCrypto: any;
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

export interface LocalStorageCompat {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

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

export type ApiHost = string;
export type ClientKey = string;

export type InitOptions<
  AppFeatures extends Record<string, any> = Record<string, any>,
> = {
  timeout?: number;
  skipCache?: boolean;
  payload?: FeatureApiResponse<AppFeatures>;
  /** Used when the fetch fails or times out and there is no cached payload, e.g. a copy bundled at build time. */
  fallbackPayload?: FeatureApiResponse<AppFeatures>;
  streaming?: boolean;
  /** Refresh the payload on this interval (ms). Ignored when streaming is active. */
  pollingInterval?: number;
  cacheSettings?: CacheSettings;
};

export type InitSyncOptions<
  AppFeatures extends Record<string, any> = Record<string, any>,
> = {
  payload: FeatureApiResponse<AppFeatures>;
  streaming?: boolean;
  /** Refresh the payload on this interval (ms). Ignored when streaming is active. */
  pollingInterval?: number;
};

export type LoadFeaturesOptions = {
  /** @deprecated */
  autoRefresh?: boolean;
  timeout?: number;
  skipCache?: boolean;
};

export type RefreshFeaturesOptions = {
  timeout?: number;
  skipCache?: boolean;
};

export type DestroyOptions = {
  destroyAllStreams?: boolean;
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

export type StickyAttributeKey = string; // `${attributeName}||${attributeValue}`
export type StickyExperimentKey = string; // `${experimentId}__{version}`
export type StickyAssignments = Record<StickyExperimentKey, string>;
export interface StickyAssignmentsDocument {
  attributeName: string;
  attributeValue: string;
  assignments: StickyAssignments;
}

/** The v1 shape: an ID list's values. New code should use SavedGroupsPayload. */
export type SavedGroupsValues = Record<string, (string | number)[]>;

/** The savedGroupReferencesV2 shape of one saved group, of any type. */
export type SavedGroupPayloadEntry =
  | { type: "list"; attributeKey: string; values: (string | number)[] }
  | { type: "condition"; condition: ConditionInterface }
  // IDs live outside the payload; see `SavedGroupResolver`
  | {
      type: "remote";
      attributeKey: string;
      /**
       * Set on a derived group (ID `<group id>:<attribute>`): the remote group
       * whose IDs `attributeKey`'s value is looked up in.
       */
      valuesFrom?: string;
    };

/** A remote saved group from the payload, as a resolver sees it. */
export type RemoteSavedGroup = {
  id: string;
  attributeKey: string;
  /** For a derived group, the remote group whose IDs it checks. */
  valuesFrom?: string;
};

/**
 * Looks up which of `groups` a user is in, from their `attributes` (only the
 * ones remote groups use). Returns the group IDs.
 */
export type SavedGroupResolver = (args: {
  attributes: Attributes;
  groups: RemoteSavedGroup[];
}) => Promise<string[]>;

/** The `savedGroups` payload field. Entries may use either shape above. */
export type SavedGroupsPayload = Record<
  string,
  (string | number)[] | SavedGroupPayloadEntry
>;

export type BaseLog = {
  timestamp: string;
};

export type EventLog = BaseLog & {
  logType: "event";
  eventName: string;
  properties?: Record<string, unknown>;
};
export type ExperimentLog<T> = BaseLog & {
  logType: "experiment";
  experiment: Experiment<T>;
  result: Result<T>;
};
export type FeatureLog = BaseLog & {
  logType: "feature";
  featureKey: string;
  result: FeatureResult;
};

export type LogUnion = EventLog | ExperimentLog<any> | FeatureLog;
