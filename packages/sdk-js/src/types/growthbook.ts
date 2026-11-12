/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  GrowthBook,
  GrowthBookClient,
  StickyBucketService,
  UserScopedGrowthBook,
} from "..";
import {
  AttributePath,
  ConditionInterface,
  ParentConditionInterface,
} from "./mongrule";

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

export type FeatureRule<T = any, A extends Attributes = any> = {
  id?: string;
  condition?: ConditionInterface<A>;
  parentConditions?: ParentConditionInterface[];
  force?: T;
  variations?: T[];
  weights?: number[];
  key?: string;
  hashAttribute?: AttributeKey<A>;
  fallbackAttribute?: AttributeKey<A>;
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
  filters?: Filter<A>[];
  seed?: string;
  name?: string;
  phase?: string;
  tracks?: Array<{
    experiment: Experiment<T, A>;
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

export type InterleavingDefinition<A extends Attributes = any> = {
  trackingKey: string;
  // Carried here, not read off the pseudo flag's rule: remote evaluation
  // replaces rules with a forced defaultValue, so the rule is gone client-side.
  hashAttribute: AttributeKey<A>;
  seed: string;
  variations: { key: string; config: Record<string, unknown> }[];
};

export type InterleavingDefinitions<A extends Attributes = any> = Record<
  string,
  InterleavingDefinition<A>
>;

export interface FeatureDefinition<T = any, A extends Attributes = any> {
  defaultValue?: T;
  rules?: FeatureRule<T, A>[];
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

export type Experiment<T, A extends Attributes = any> = {
  key: string;
  variations: [T, T, ...T[]];
  ranges?: VariationRange[];
  meta?: VariationMeta[];
  filters?: Filter<A>[];
  seed?: string;
  name?: string;
  phase?: string;
  urlPatterns?: UrlTarget[];
  weights?: number[];
  condition?: ConditionInterface<A>;
  parentConditions?: ParentConditionInterface[];
  coverage?: number;
  include?: () => boolean;
  /** @deprecated */
  namespace?: [string, number, number];
  force?: number;
  hashAttribute?: AttributeKey<A>;
  fallbackAttribute?: AttributeKey<A>;
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

export type AutoExperiment<
  T = AutoExperimentVariation,
  A extends Attributes = any,
> = Experiment<T, A> & {
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
// The types below that take attributes default to `any`, not `Attributes`, so
// that one checked against an app's attributes is still assignable to the
// unchecked type that `init`, `setPayload` and the rest accept.

// The attributes a user can be hashed on: ones that can hold a string or a
// number. Unlike conditions, hashing doesn't look inside object attributes.
export type AttributeKey<A> = string extends keyof A
  ? string
  : {
      [K in keyof A & string]: unknown extends A[K]
        ? K
        : [Extract<A[K], string | number>] extends [never]
          ? never
          : K;
    }[keyof A & string];

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
 * Also register a fallback payload written in code that has every feature
 * (`fallbackPayload: typeof fallbackPayload`, see `FallbackPayload`), and
 * `getFeatureValue` needs no fallback, other than for a boolean (use `isOn`,
 * or pass the fallback) or a feature that can be null. With no fallback, a
 * feature with no value (missing, blocked by a prerequisite...) uses its
 * `defaultValue`: the one in the SDK's payload, else the one in the
 * `fallbackPayload` given to `init`. Pass a fallback to use a different value.
 *
 * Register `events` (event name -> properties) to check `logEvent` calls:
 *
 *   events: {
 *     start_checkout: { plan: "pro" | "enterprise" };
 *     button_click: { button: string };
 *   };
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register {}
export type RegisteredFeatures = Register extends { features: infer F }
  ? F
  : Record<string, any>;
// Features `getFeatureValue` can return with no fallback: the registered
// fallback payload has every feature's default, so only one that can be null
// still needs one. Boolean features are left out too: `isOn` is false when
// there is no value, and a `true` default here would disagree with it.
export type BundledFeatureKey = Register extends {
  features: infer F;
  fallbackPayload: FallbackPayload;
}
  ? {
      [K in keyof F]: F[K] extends string | number | object ? K : never;
    }[keyof F] &
      string
  : never;
export type RegisteredAttributes = Register extends { attributes: infer A }
  ? A
  : Attributes;
export type RegisteredEvents = Register extends { events: infer E }
  ? E
  : Record<string, EventProperties>;
// The arguments after the event name: properties can be left out for an event
// that has no required ones
export type EventArgs<P> =
  Record<never, never> extends P ? [properties?: P] : [properties: P];
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
  AppAttributes extends Attributes = any,
> = string extends keyof AppFeatures
  ? Record<string, FeatureDefinition<any, AppAttributes>>
  : {
      [K in keyof AppFeatures]?: FeatureDefinition<
        AppFeatures[K],
        AppAttributes
      >;
    };

export type FeatureApiResponse<
  AppFeatures extends Record<string, any> = Record<string, any>,
  AppAttributes extends Attributes = any,
> = {
  features?: FeatureDefinitions<AppFeatures, AppAttributes>;
  dateUpdated?: string;
  encryptedFeatures?: string;
  experiments?: AutoExperiment<AutoExperimentVariation, AppAttributes>[];
  encryptedExperiments?: string;
  savedGroups?: SavedGroupsPayload<AppAttributes>;
  encryptedSavedGroups?: string;
  contextualBandits?: ContextualBanditDefinitions;
  encryptedContextualBandits?: string;
  interleavings?: InterleavingDefinitions<AppAttributes>;
  encryptedInterleavings?: string;
};

// Alias
export type GrowthBookPayload = FeatureApiResponse;

/**
 * A fallback payload written in code, checked against your attributes and
 * features. Targeting conditions, hash attributes and saved groups must use
 * real attributes, with operators and values that fit each attribute's type.
 * Every feature must be included, with a `defaultValue`.
 *
 *   const fallbackPayload: FallbackPayload<AppAttributes, AppFeatures> = {...};
 *
 * Uses the registered attributes and features when none are given.
 */
export type FallbackPayload<
  AppAttributes extends Attributes = RegisteredAttributes,
  AppFeatures extends Record<string, any> = RegisteredFeatures,
> = FeatureApiResponse<AppFeatures, AppAttributes> & {
  features: { [K in keyof AppFeatures]: { defaultValue: AppFeatures[K] } };
};

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

export interface Filter<A extends Attributes = any> {
  // Override the hashAttribute used for this filter
  attribute?: AttributeKey<A>;
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
export type SavedGroupPayloadEntry<A extends Attributes = any> =
  | {
      type: "list";
      attributeKey: AttributePath<A>;
      values: (string | number)[];
    }
  | { type: "condition"; condition: ConditionInterface<A> }
  // IDs live outside the payload; see `SavedGroupResolver`
  | {
      type: "remote";
      attributeKey: AttributePath<A>;
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
export type SavedGroupsPayload<A extends Attributes = any> = Record<
  string,
  (string | number)[] | SavedGroupPayloadEntry<A>
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
