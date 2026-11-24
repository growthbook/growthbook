import type {
  ApiHost,
  Attributes,
  AutoExperiment,
  AutoExperimentRunner,
  AutoExperimentVariation,
  ClientKey,
  Options,
  Experiment,
  FeatureApiResponse,
  FeatureDefinition,
  FeatureResult,
  FeatureUsageCallback,
  LoadFeaturesOptions,
  RefreshFeaturesOptions,
  RenderFunction,
  Result,
  SubscriptionFunction,
  FeatureUsageSubCallback,
  CustomEventSubCallback,
  ExperimentViewedSubCallback,
  TrackingCallback,
  TrackingData,
  FeatureValueOrFallback,
  EvalContext,
  InitOptions,
  InitResponse,
  InitSyncOptions,
  PrefetchOptions,
  GlobalContext,
  UserContext,
  StickyAssignmentsDocument,
  EventLogger,
  LogUnion,
  DestroyOptions,
  RegisteredAttributes,
  RegisteredEvents,
  RegisteredFeatures,
  EventArgs,
  EventProperties,
  NoInferType,
} from "./types/growthbook";
import { decrypt, loadSDKVersion } from "./util";
import {
  clearAutoRefresh,
  configureCache,
  refreshFeatures,
  startBackgroundSync,
  unsubscribe,
} from "./feature-repository";
import {
  runExperiment,
  evalFeature as _evalFeature,
  buildContextualBanditExperiment,
  getExperimentResult,
  getAllStickyBucketAssignmentDocs,
  decryptPayload,
  getApiHosts,
  getExperimentDedupeKey,
  getStickyBucketAttributes,
  getTrackingUserContext,
} from "./core";
import { StickyBucketServiceSync } from "./sticky-bucket-service";
import {
  isMissingRemoteGroupIds,
  REMOTE_GROUP_IDS_ATTRIBUTE,
} from "./remoteSavedGroups";

const isBrowser =
  typeof window !== "undefined" && typeof document !== "undefined";

const SDK_VERSION = loadSDKVersion();

export class GrowthBook<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AppFeatures extends Record<string, any> = RegisteredFeatures,
  AppAttributes extends Attributes = RegisteredAttributes,
> {
  // context is technically private, but some tools depend on it so we can't mangle the name
  private context: Options;
  public debug: boolean;
  public ready: boolean;
  public version: string;
  public logs: Array<LogUnion>;

  // Properties and methods that start with "_" are mangled by Terser (saves ~150 bytes)
  private _options: Options;
  private _renderer: null | RenderFunction;
  private _trackedExperiments: Set<string>;
  private _completedChangeIds: Set<string>;
  private _trackedFeatures: Record<string, string>;
  private _subscriptions: Set<SubscriptionFunction>;
  private _featureUsageSubs: Set<FeatureUsageSubCallback>;
  private _customEventSubs: Set<CustomEventSubCallback>;
  private _experimentViewedSubs: Set<ExperimentViewedSubCallback>;
  private _assigned: Map<
    string,
    {
      // eslint-disable-next-line
      experiment: Experiment<any>;
      // eslint-disable-next-line
      result: Result<any>;
    }
  >;
  private _initialized: boolean;
  private _deferredTrackingCalls: Map<string, TrackingData>;
  private _saveStickyBucketAssignmentDoc:
    | undefined
    | ((doc: StickyAssignmentsDocument) => Promise<unknown>);

  private _payload: FeatureApiResponse | undefined;
  private _decryptedPayload: FeatureApiResponse | undefined;
  private _destroyCallbacks: (() => void)[];

  private _autoExperimentsAllowed: boolean;
  private _destroyed?: boolean;

  // Internal — first-party plugin use only.
  // Set by visualEditorPlugin and urlRedirectsPlugin. Without one of them, the
  // experiments in the payload never run.
  public _autoExperimentRunner?: AutoExperimentRunner;

  constructor(options?: Options<NoInferType<AppAttributes>>) {
    options = options || {};
    // These properties are all initialized in the constructor instead of above
    // This saves ~80 bytes in the final output
    this.version = SDK_VERSION;
    this._options = this.context = options;
    this._renderer = options.renderer || null;
    this._trackedExperiments = new Set();
    this._completedChangeIds = new Set();
    this._trackedFeatures = {};
    this.debug = !!options.debug;
    this._subscriptions = new Set();
    this._featureUsageSubs = new Set();
    this._customEventSubs = new Set();
    this._experimentViewedSubs = new Set();
    this.ready = false;
    this._assigned = new Map();
    this._initialized = false;
    this._deferredTrackingCalls = new Map();
    this._autoExperimentsAllowed = !options.disableExperimentsOnLoad;
    this._destroyCallbacks = [];
    this.logs = [];

    this.log = this.log.bind(this);
    this._saveDeferredTrack = this._saveDeferredTrack.bind(this);
    this._onExperimentEval = this._onExperimentEval.bind(this);
    this._fireSubscriptions = this._fireSubscriptions.bind(this);
    this._recordChangedId = this._recordChangedId.bind(this);

    if (options.remoteEval) {
      if (options.decryptionKey) {
        throw new Error("Encryption is not available for remoteEval");
      }
      if (!options.clientKey) {
        throw new Error("Missing clientKey");
      }
      let isGbHost = false;
      try {
        isGbHost = !!new URL(options.apiHost || "").hostname.match(
          /growthbook\.io$/i,
        );
      } catch (e) {
        // ignore invalid URLs
      }
      if (isGbHost) {
        throw new Error("Cannot use remoteEval on GrowthBook Cloud");
      }
    } else {
      if (options.cacheKeyAttributes) {
        throw new Error("cacheKeyAttributes are only used for remoteEval");
      }
    }

    if (options.stickyBucketService) {
      const s = options.stickyBucketService;
      this._saveStickyBucketAssignmentDoc = (doc) => {
        return s.saveAssignments(doc);
      };
    }

    if (options.plugins) {
      for (const plugin of options.plugins) {
        plugin(this);
      }
    }

    if (options.features) {
      this.ready = true;
    }

    if (isBrowser && options.enableDevMode) {
      window._growthbook = this;
      document.dispatchEvent(new Event("gbloaded"));
    }

    if (options.experiments) {
      this.ready = true;
      this._updateAllAutoExperiments();
    }

    // Hydrate sticky bucket service
    if (
      this._options.stickyBucketService &&
      this._options.stickyBucketAssignmentDocs
    ) {
      for (const key in this._options.stickyBucketAssignmentDocs) {
        const doc = this._options.stickyBucketAssignmentDocs[key];
        if (doc) {
          this._options.stickyBucketService.saveAssignments(doc).catch(() => {
            // Ignore hydration errors
          });
        }
      }
    }

    // Legacy - passing in features/experiments into the constructor instead of using init
    if (this.ready) {
      this.refreshStickyBuckets(this.getPayload());
    }
  }

  public async setPayload(
    payload: FeatureApiResponse<AppFeatures>,
  ): Promise<void> {
    // AppFeatures only checks payloads written in code; internally they are untyped
    const untyped = payload as FeatureApiResponse;
    this._payload = untyped;
    const data = await decryptPayload(untyped, this._options.decryptionKey);
    this._decryptedPayload = data;
    await this.refreshStickyBuckets(data);
    if (data.features) {
      this._options.features = data.features;
    }
    if (data.savedGroups) {
      this._options.savedGroups = data.savedGroups;
    }
    if (data.contextualBandits) {
      this._options.contextualBandits = data.contextualBandits;
    }
    if (data.experiments) {
      this._options.experiments = data.experiments;
    }
    if (data.experiments || data.contextualBandits) {
      this._updateAllAutoExperiments();
    }
    this.ready = true;
    this._render();
  }

  public initSync(options: InitSyncOptions<AppFeatures>): this {
    this._initialized = true;

    const payload = options.payload as FeatureApiResponse;

    if (payload.encryptedExperiments || payload.encryptedFeatures) {
      throw new Error("initSync does not support encrypted payloads");
    }

    if (
      this._options.stickyBucketService &&
      !this._options.stickyBucketAssignmentDocs
    ) {
      this._options.stickyBucketAssignmentDocs =
        this.generateStickyBucketAssignmentDocsSync(
          this._options.stickyBucketService as StickyBucketServiceSync,
          payload,
        );
    }

    this._payload = payload;
    this._decryptedPayload = payload;
    if (payload.features) {
      this._options.features = payload.features;
    }
    if (payload.savedGroups) {
      this._options.savedGroups = payload.savedGroups;
    }
    if (payload.contextualBandits) {
      this._options.contextualBandits = payload.contextualBandits;
    }
    if (payload.experiments) {
      this._options.experiments = payload.experiments;
    }
    if (payload.experiments || payload.contextualBandits) {
      this._updateAllAutoExperiments();
    }

    this.ready = true;

    startBackgroundSync(this, options);

    return this;
  }

  public async init(options?: InitOptions<AppFeatures>): Promise<InitResponse> {
    this._initialized = true;
    options = options || {};

    if (options.cacheSettings) {
      configureCache(options.cacheSettings);
    }

    if (options.payload) {
      await this.setPayload(options.payload);
      startBackgroundSync(this, options);
      return {
        success: true,
        source: "init",
      };
    } else {
      const { data, ...res } = await this._refresh({
        ...options,
        allowStale: true,
      });
      startBackgroundSync(this, options);
      await this.setPayload(data || options.fallbackPayload || {});
      return res;
    }
  }

  /** @deprecated Use {@link init} */
  public async loadFeatures(options?: LoadFeaturesOptions): Promise<void> {
    options = options || {};
    await this.init({
      skipCache: options.skipCache,
      timeout: options.timeout,
      streaming:
        (this._options.backgroundSync ?? true) &&
        (options.autoRefresh || this._options.subscribeToChanges),
    });
  }

  public async refreshFeatures(
    options?: RefreshFeaturesOptions,
  ): Promise<void> {
    const res = await this._refresh({
      ...(options || {}),
      allowStale: false,
    });
    if (res.data) {
      await this.setPayload(res.data);
    }
  }

  public getApiInfo(): [ApiHost, ClientKey] {
    return [this.getApiHosts().apiHost, this.getClientKey()];
  }
  public getApiHosts() {
    return getApiHosts(this._options);
  }
  public getClientKey(): string {
    return this._options.clientKey || "";
  }
  public getPayload(): FeatureApiResponse {
    return (
      this._payload || {
        features: this.getFeatures(),
        experiments: this.getExperiments(),
      }
    );
  }
  public getDecryptedPayload(): FeatureApiResponse {
    return this._decryptedPayload || this.getPayload();
  }

  public isRemoteEval(): boolean {
    return this._options.remoteEval || false;
  }

  public getCacheKeyAttributes(): (keyof Attributes)[] | undefined {
    return this._options.cacheKeyAttributes;
  }

  private async _refresh({
    timeout,
    skipCache,
    allowStale,
    streaming,
  }: RefreshFeaturesOptions & {
    allowStale?: boolean;
    streaming?: boolean;
  }) {
    if (!this._options.clientKey) {
      throw new Error("Missing clientKey");
    }
    // Trigger refresh in feature repository
    return refreshFeatures({
      instance: this,
      timeout,
      skipCache: skipCache || this._options.disableCache,
      allowStale,
      backgroundSync: streaming ?? this._options.backgroundSync ?? true,
    });
  }

  private _render() {
    if (this._renderer) {
      try {
        this._renderer();
      } catch (e) {
        console.error("Failed to render", e);
      }
    }
  }

  /** @deprecated Use {@link setPayload} */
  public setFeatures(features: Record<string, FeatureDefinition>) {
    this._options.features = features;
    this.ready = true;
    this._render();
  }

  /** @deprecated Use {@link setPayload} */
  public async setEncryptedFeatures(
    encryptedString: string,
    decryptionKey?: string,
    subtle?: SubtleCrypto,
  ): Promise<void> {
    const featuresJSON = await decrypt(
      encryptedString,
      decryptionKey || this._options.decryptionKey,
      subtle,
    );
    this.setFeatures(
      JSON.parse(featuresJSON) as Record<string, FeatureDefinition>,
    );
  }

  /** @deprecated Use {@link setPayload} */
  public setExperiments(experiments: AutoExperiment[]): void {
    this._options.experiments = experiments;
    this.ready = true;
    this._updateAllAutoExperiments();
  }

  /** @deprecated Use {@link setPayload} */
  public async setEncryptedExperiments(
    encryptedString: string,
    decryptionKey?: string,
    subtle?: SubtleCrypto,
  ): Promise<void> {
    const experimentsJSON = await decrypt(
      encryptedString,
      decryptionKey || this._options.decryptionKey,
      subtle,
    );
    this.setExperiments(JSON.parse(experimentsJSON) as AutoExperiment[]);
  }

  public async setAttributes(attributes: AppAttributes) {
    this._options.attributes = attributes;
    if (this._options.stickyBucketService) {
      await this.refreshStickyBuckets();
    }
    if (this._options.remoteEval) {
      await this._refreshForRemoteEval();
      return;
    }
    this._render();
    this._updateAllAutoExperiments();
  }

  public async updateAttributes(attributes: Partial<AppAttributes>) {
    return this.setAttributes({
      ...this._options.attributes,
      ...attributes,
    } as AppAttributes);
  }

  public async setAttributeOverrides(overrides: Partial<AppAttributes>) {
    this._options.attributeOverrides = overrides;
    if (this._options.stickyBucketService) {
      await this.refreshStickyBuckets();
    }
    if (this._options.remoteEval) {
      await this._refreshForRemoteEval();
      return;
    }
    this._render();
    this._updateAllAutoExperiments();
  }

  /** The user's remote saved groups, for example from your back end's resolver. */
  public async setRemoteGroupIds(remoteGroupIds: string[]) {
    this._options.remoteGroupIds = remoteGroupIds;
    if (this._options.remoteEval) {
      await this._refreshForRemoteEval();
      return;
    }
    this._render();
    this._updateAllAutoExperiments();
  }

  public async setForcedVariations(vars: Record<string, number>) {
    this._options.forcedVariations = vars || {};
    if (this._options.remoteEval) {
      await this._refreshForRemoteEval();
      return;
    }
    this._render();
    this._updateAllAutoExperiments();
  }

  // eslint-disable-next-line
  public setForcedFeatures(map: Map<string, any>) {
    this._options.forcedFeatureValues = map;
    this._render();
  }

  public async setURL(url: string) {
    if (url === this._options.url) return;
    this._options.url = url;
    if (this._autoExperimentRunner) this._autoExperimentRunner.redirectUrl = "";
    if (this._options.remoteEval) {
      await this._refreshForRemoteEval();
      this._updateAllAutoExperiments(true);
      return;
    }
    this._updateAllAutoExperiments(true);
  }

  // Partial because attributes may not have been set yet
  public getAttributes(): Partial<AppAttributes> {
    // Remote evaluation sends these, so it includes remote group IDs.
    return {
      ...this._options.attributes,
      ...this._options.attributeOverrides,
      ...(this._options.remoteGroupIds && {
        [REMOTE_GROUP_IDS_ATTRIBUTE]: this._options.remoteGroupIds,
      }),
    } as Partial<AppAttributes>;
  }

  public getForcedVariations() {
    return this._options.forcedVariations || {};
  }

  public getForcedFeatures() {
    // eslint-disable-next-line
    return this._options.forcedFeatureValues || new Map<string, any>();
  }

  public getStickyBucketAssignmentDocs() {
    return this._options.stickyBucketAssignmentDocs || {};
  }

  public getUrl() {
    return this._options.url || "";
  }

  public getFeatures() {
    return this._options.features || {};
  }

  public getExperiments() {
    return this._options.experiments || [];
  }

  public getCompletedChangeIds(): string[] {
    return Array.from(this._completedChangeIds);
  }

  public subscribe(cb: SubscriptionFunction): () => void {
    this._subscriptions.add(cb);
    return () => {
      this._subscriptions.delete(cb);
    };
  }

  // Internal — first-party plugin use only.
  // Currently singleton-only. UserScopedGrowthBook could use the same signatures;
  // GrowthBookClient would need UserContext in callbacks to identify the user.
  // Fires on deduped feature value changes (not every evalFeature call). Overrides excluded.
  // One of three plugin streams: feature usage, experiment assignments (_subscribeExperimentViewed), custom events.
  public _subscribeFeatureUsage(cb: FeatureUsageSubCallback): () => void {
    this._featureUsageSubs.add(cb);
    return () => this._featureUsageSubs.delete(cb);
  }

  // Internal — first-party plugin use only.
  // Fires once per deduped experiment assignment, alongside (not instead of) trackingCallback.
  public _subscribeExperimentViewed(
    cb: ExperimentViewedSubCallback,
  ): () => void {
    this._experimentViewedSubs.add(cb);
    return () => this._experimentViewedSubs.delete(cb);
  }

  // Internal — first-party plugin use only.
  // Fires for explicit logEvent() calls only, not SDK-internal events.
  public _subscribeCustomEvents(cb: CustomEventSubCallback): () => void {
    this._customEventSubs.add(cb);
    return () => this._customEventSubs.delete(cb);
  }

  // Internal — first-party plugin use only.
  // The two gates runExperiment applies (core.ts): `enabled: false` turns
  // experiments off, qaMode keeps QA users out of them and out of tracking.
  // A forced feature rule never reaches runExperiment, so a plugin that assigns
  // and tracks on its own has to apply them itself.
  public _experimentsDisabled(): boolean {
    return this._options.enabled === false || !!this._options.qaMode;
  }

  // Internal — first-party plugin use only.
  // Whether logEvent would reach anything. Without it logEvent logs an error of
  // its own, which a plugin logging per impression would repeat endlessly.
  public _hasEventConsumer(): boolean {
    return (
      !!this._options.eventLogger ||
      this._customEventSubs.size > 0 ||
      !!this._options.enableDevMode
    );
  }

  private async _refreshForRemoteEval() {
    if (!this._options.remoteEval) return;
    if (!this._initialized) return;
    const res = await this._refresh({
      allowStale: false,
    });
    if (res.data) {
      await this.setPayload(res.data);
    }
  }

  public getAllResults() {
    return new Map(this._assigned);
  }

  public onDestroy(cb: () => void) {
    this._destroyCallbacks.push(cb);
  }

  public isDestroyed() {
    return !!this._destroyed;
  }

  public destroy(options?: DestroyOptions) {
    options = options || {};
    this._destroyed = true;

    // Custom callbacks
    // Do this first in case it needs access to the below data that is cleared
    this._destroyCallbacks.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.error(e);
      }
    });

    // Release references to save memory
    this._subscriptions.clear();
    this._featureUsageSubs.clear();
    this._customEventSubs.clear();
    this._experimentViewedSubs.clear();
    this._assigned.clear();
    this._trackedExperiments.clear();
    this._completedChangeIds.clear();
    this._deferredTrackingCalls.clear();
    this._trackedFeatures = {};
    this._destroyCallbacks = [];
    this._payload = undefined;
    this._saveStickyBucketAssignmentDoc = undefined;
    unsubscribe(this);
    if (options.destroyAllStreams) {
      clearAutoRefresh();
    }
    this.logs = [];

    if (isBrowser && window._growthbook === this) {
      delete window._growthbook;
    }
  }

  public setRenderer(renderer: null | RenderFunction) {
    this._renderer = renderer;
  }

  public forceVariation(key: string, variation: number) {
    this._options.forcedVariations = this._options.forcedVariations || {};
    this._options.forcedVariations[key] = variation;
    if (this._options.remoteEval) {
      this._refreshForRemoteEval();
      return;
    }
    this._updateAllAutoExperiments();
    this._render();
  }

  public run<T>(experiment: Experiment<T>): Result<T> {
    const { result } = runExperiment(experiment, null, this._getEvalContext());
    this._onExperimentEval(experiment, result);
    return result;
  }

  public triggerExperiment(key: string) {
    return this._autoExperimentRunner
      ? this._autoExperimentRunner.trigger(key)
      : null;
  }

  public triggerAutoExperiments() {
    this._autoExperimentsAllowed = true;
    this._updateAllAutoExperiments(true);
  }

  private _warnedMissingRemoteGroupIds = false;

  private _getEvalContext(): EvalContext {
    const user = this._getUserContext();
    if (
      !this._warnedMissingRemoteGroupIds &&
      isMissingRemoteGroupIds(user, this._options.savedGroups)
    ) {
      this._warnedMissingRemoteGroupIds = true;
      this.log(
        "The payload has remote saved groups, but the user has no remote group IDs. Rules using them won't match. See setRemoteGroupIds.",
        {},
      );
    }
    return {
      user,
      global: this._getGlobalContext(),
      stack: {
        evaluatedFeatures: new Set(),
      },
    };
  }

  private _getUserContext(): UserContext {
    return {
      attributes: this._options.user
        ? {
            ...this._options.user,
            ...this._options.attributes,
          }
        : this._options.attributes,
      remoteGroupIds: this._options.remoteGroupIds,
      enableDevMode: this._options.enableDevMode,
      blockedChangeIds: this._options.blockedChangeIds,
      stickyBucketAssignmentDocs: this._options.stickyBucketAssignmentDocs,
      url: this._getContextUrl(),
      forcedVariations: this._options.forcedVariations,
      forcedFeatureValues: this._options.forcedFeatureValues,
      attributeOverrides: this._options.attributeOverrides,
      saveStickyBucketAssignmentDoc: this._saveStickyBucketAssignmentDoc,
      trackingCallback: this._options.trackingCallback,
      onFeatureUsage: this._options.onFeatureUsage,
      devLogs: this.logs,
      featureUsageSubs: this._featureUsageSubs,
      experimentViewedSubs: this._experimentViewedSubs,
      trackedExperiments: this._trackedExperiments,
      trackedFeatureUsage: this._trackedFeatures,
    };
  }
  private _getGlobalContext(): GlobalContext {
    return {
      features: this._options.features,
      experiments: this._options.experiments,
      log: this.log,
      debug: this.debug,
      enabled: this._options.enabled,
      qaMode: this._options.qaMode,
      defaultHashVersion: this._options.defaultHashVersion,
      savedGroups: this._options.savedGroups,
      contextualBandits: this._options.contextualBandits,
      groups: this._options.groups,
      overrides: this._options.overrides,
      onExperimentEval: this._onExperimentEval,
      recordChangeId: this._recordChangedId,
      saveDeferredTrack: this._saveDeferredTrack,
      eventLogger: this._options.eventLogger,
    };
  }

  // Internal — first-party plugin use only.
  // Assigns the user a variation of an experiment from the payload. A blocked
  // experiment excludes the user without tracking. Also returns the tracking
  // call, so a redirect can wait for it.
  public _evalAutoExperiment(
    experiment: AutoExperiment,
    blocked?: boolean,
  ): {
    result: Result<AutoExperimentVariation>;
    trackingCall?: Promise<void>;
  } {
    const ctx = this._getEvalContext();
    if (
      blocked ||
      (experiment.changeId &&
        (this._options.blockedChangeIds || []).includes(experiment.changeId))
    ) {
      process.env.NODE_ENV !== "production" &&
        this.log("Auto experiment blocked", { id: experiment.key });
      return { result: getExperimentResult(ctx, experiment, -1, false, "") };
    }
    let expToRun = experiment;
    if (experiment.contextualBanditRef) {
      expToRun = { ...experiment };
      buildContextualBanditExperiment(
        expToRun,
        experiment.contextualBanditRef,
        experiment.key,
        ctx,
      );
    }
    const res = runExperiment(expToRun, null, ctx);
    this._onExperimentEval(experiment, res.result);
    return res;
  }

  private _updateAllAutoExperiments(forceRerun?: boolean) {
    if (!this._autoExperimentsAllowed || !this._autoExperimentRunner) return;
    this._autoExperimentRunner.update(forceRerun);
  }

  private _onExperimentEval<T>(experiment: Experiment<T>, result: Result<T>) {
    const prev = this._assigned.get(experiment.key);
    this._assigned.set(experiment.key, { experiment, result });
    if (this._subscriptions.size > 0) {
      this._fireSubscriptions<T>(experiment, result, prev);
    }
  }

  private _fireSubscriptions<T>(
    experiment: Experiment<T>,
    result: Result<T>,
    // eslint-disable-next-line
    prev?: { experiment: Experiment<any>; result: Result<any> },
  ) {
    // If assigned variation has changed, fire subscriptions
    // TODO: what if the experiment definition has changed?
    if (
      !prev ||
      prev.result.inExperiment !== result.inExperiment ||
      prev.result.variationId !== result.variationId
    ) {
      this._subscriptions.forEach((cb) => {
        try {
          cb(experiment, result);
        } catch (e) {
          console.error(e);
        }
      });
    }
  }

  private _recordChangedId(id: string) {
    this._completedChangeIds.add(id);
  }

  public isOn<K extends string & keyof AppFeatures = string>(key: K): boolean {
    return this.evalFeature(key).on;
  }

  public isOff<K extends string & keyof AppFeatures = string>(key: K): boolean {
    return this.evalFeature(key).off;
  }

  public getFeatureValue<
    V extends AppFeatures[K] | null,
    K extends string & keyof AppFeatures = string,
  >(key: K, defaultValue: V): FeatureValueOrFallback<V, AppFeatures[K]> {
    const value = this.evalFeature(key).value;
    return (value === null ? defaultValue : value) as FeatureValueOrFallback<
      V,
      AppFeatures[K]
    >;
  }

  /**
   * @deprecated Use {@link evalFeature}
   * @param id
   */

  public feature<
    V extends AppFeatures[K],
    K extends string & keyof AppFeatures = string,
  >(id: K): FeatureResult<V | null> {
    return this.evalFeature(id);
  }

  public evalFeature<
    V extends AppFeatures[K],
    K extends string & keyof AppFeatures = string,
  >(id: K): FeatureResult<V | null> {
    return _evalFeature(id, this._getEvalContext());
  }

  log(msg: string, ctx: Record<string, unknown>) {
    if (!this.debug) return;
    if (this._options.log) this._options.log(msg, ctx);
    else console.log(msg, ctx);
  }

  public getDeferredTrackingCalls(): TrackingData[] {
    return Array.from(this._deferredTrackingCalls.values());
  }

  public setDeferredTrackingCalls(calls: TrackingData[]) {
    this._deferredTrackingCalls = new Map(
      calls
        .filter((c) => c && c.experiment && c.result)
        .map((c) => {
          return [getExperimentDedupeKey(c.experiment, c.result), c];
        }),
    );
  }

  public async fireDeferredTrackingCalls() {
    if (!this._options.trackingCallback) return;

    const promises: ReturnType<TrackingCallback>[] = [];
    this._deferredTrackingCalls.forEach((call: TrackingData) => {
      if (!call || !call.experiment || !call.result) {
        console.error("Invalid deferred tracking call", { call: call });
      } else {
        promises.push(
          (this._options.trackingCallback as TrackingCallback)(
            call.experiment,
            call.result,
            call.user,
          ),
        );
      }
    });
    this._deferredTrackingCalls.clear();
    await Promise.all(promises);
  }

  public setTrackingCallback(callback: TrackingCallback) {
    this._options.trackingCallback = callback;
    this.fireDeferredTrackingCalls();
  }

  public setFeatureUsageCallback(callback: FeatureUsageCallback) {
    this._options.onFeatureUsage = callback;
  }

  public setEventLogger(logger: EventLogger) {
    this._options.eventLogger = logger;
  }

  // Event names and properties are checked against the registered events
  public logEvent<K extends string & keyof RegisteredEvents>(
    eventName: K,
    ...args: EventArgs<RegisteredEvents[K]>
  ): Promise<void>;
  public async logEvent(eventName: string, properties?: EventProperties) {
    if (this._destroyed) {
      console.error("Cannot log event to destroyed GrowthBook instance");
      return;
    }
    if (this._options.enableDevMode) {
      this.logs.push({
        eventName,
        properties,
        timestamp: Date.now().toString(),
        logType: "event",
      });
    }
    if (this._customEventSubs.size) {
      this._customEventSubs.forEach((cb) => {
        try {
          cb(eventName, properties || {});
        } catch (e) {
          console.error(e);
        }
      });
    }
    if (this._options.eventLogger) {
      try {
        await this._options.eventLogger(
          eventName,
          properties || {},
          getTrackingUserContext(this._getUserContext()),
        );
      } catch (e) {
        console.error(e);
      }
    } else if (!this._options.enableDevMode && !this._customEventSubs.size) {
      console.error("No event logger configured");
    }
  }

  private _saveDeferredTrack(data: TrackingData) {
    this._deferredTrackingCalls.set(
      getExperimentDedupeKey(data.experiment, data.result),
      data,
    );
  }

  private _getContextUrl() {
    return this._options.url || (isBrowser ? window.location.href : "");
  }

  public getRedirectUrl(): string {
    return this._autoExperimentRunner
      ? this._autoExperimentRunner.redirectUrl
      : "";
  }

  public async refreshStickyBuckets(data?: FeatureApiResponse) {
    if (this._options.stickyBucketService) {
      const ctx = this._getEvalContext();
      const docs = await getAllStickyBucketAssignmentDocs(
        ctx,
        this._options.stickyBucketService,
        data,
      );
      this._options.stickyBucketAssignmentDocs = docs;
    }
  }

  public generateStickyBucketAssignmentDocsSync(
    stickyBucketService: StickyBucketServiceSync,
    payload: FeatureApiResponse,
  ) {
    if (!("getAllAssignmentsSync" in stickyBucketService)) {
      console.error(
        "generating StickyBucketAssignmentDocs docs requires StickyBucketServiceSync",
      );
      return;
    }
    const ctx = this._getEvalContext();
    const attributes = getStickyBucketAttributes(ctx, payload);
    return stickyBucketService.getAllAssignmentsSync(attributes);
  }

  public inDevMode(): boolean {
    return !!this._options.enableDevMode;
  }
}

export async function prefetchPayload(options: PrefetchOptions) {
  // Create a temporary instance, just to fetch the payload
  const instance = new GrowthBook(options);

  await refreshFeatures({
    instance,
    skipCache: options.skipCache,
    allowStale: false,
    backgroundSync: options.streaming,
  });

  instance.destroy();
}
