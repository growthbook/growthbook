import mutate, { DeclarativeMutation } from "dom-mutator";
import type {
  ApiHost,
  Attributes,
  AutoExperiment,
  AutoExperimentVariation,
  ClientKey,
  Context,
  Experiment,
  FeatureApiResponse,
  FeatureDefinition,
  FeatureResult,
  LoadFeaturesOptions,
  RealtimeUsageData,
  RefreshFeaturesOptions,
  RenderFunction,
  Result,
  SubscriptionFunction,
  TrackingCallback,
  TrackingData,
  WidenPrimitives,
  FeatureEvalContext,
  InitOptions,
  InitResponse,
  InitSyncOptions,
  PrefetchOptions,
} from "./types/growthbook";
import {
  decrypt,
  getAutoExperimentChangeType,
  isURLTargeted,
  loadSDKVersion,
  mergeQueryStrings,
  promiseTimeout,
  toString,
} from "./util";
import {
  configureCache,
  refreshFeatures,
  startAutoRefresh,
  subscribe,
  unsubscribe,
} from "./feature-repository";
import {
  runExperiment,
  evalFeature as _evalFeature,
  getExperimentResult,
  getHashAttribute,
} from "./core";

const isBrowser =
  typeof window !== "undefined" && typeof document !== "undefined";

const SDK_VERSION = loadSDKVersion();

export class GrowthBook<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AppFeatures extends Record<string, any> = Record<string, any>
> {
  // context is technically private, but some tools depend on it so we can't mangle the name
  // _ctx below is a clone of this property that we use internally
  private context: Context;
  public debug: boolean;
  public ready: boolean;
  public version: string;

  // Properties and methods that start with "_" are mangled by Terser (saves ~150 bytes)
  private _ctx: Context;
  private _renderer: null | RenderFunction;
  private _redirectedUrl: string;
  private _trackedExperiments: Set<string>;
  private _completedChangeIds: Set<string>;
  private _trackedFeatures: Record<string, string>;
  private _subscriptions: Set<SubscriptionFunction>;
  private _rtQueue: RealtimeUsageData[];
  private _rtTimer: number;
  private _assigned: Map<
    string,
    {
      // eslint-disable-next-line
      experiment: Experiment<any>;
      // eslint-disable-next-line
      result: Result<any>;
    }
  >;
  // eslint-disable-next-line
  private _forcedFeatureValues: Map<string, any>;
  private _attributeOverrides: Attributes;
  private _activeAutoExperiments: Map<
    AutoExperiment,
    { valueHash: string; undo: () => void }
  >;
  private _triggeredExpKeys: Set<string>;
  private _initialized: boolean;
  private _deferredTrackingCalls: Map<string, TrackingData>;

  private _payload: FeatureApiResponse | undefined;
  private _decryptedPayload: FeatureApiResponse | undefined;

  private _autoExperimentsAllowed: boolean;

  constructor(context?: Context) {
    context = context || {};
    // These properties are all initialized in the constructor instead of above
    // This saves ~80 bytes in the final output
    this.version = SDK_VERSION;
    this._ctx = this.context = context;
    this._renderer = context.renderer || null;
    this._trackedExperiments = new Set();
    this._completedChangeIds = new Set();
    this._trackedFeatures = {};
    this.debug = !!context.debug;
    this._subscriptions = new Set();
    this._rtQueue = [];
    this._rtTimer = 0;
    this.ready = false;
    this._assigned = new Map();
    this._forcedFeatureValues = new Map();
    this._attributeOverrides = {};
    this._activeAutoExperiments = new Map();
    this._triggeredExpKeys = new Set();
    this._initialized = false;
    this._redirectedUrl = "";
    this._deferredTrackingCalls = new Map();
    this._autoExperimentsAllowed = !context.disableExperimentsOnLoad;

    if (context.remoteEval) {
      if (context.decryptionKey) {
        throw new Error("Encryption is not available for remoteEval");
      }
      if (!context.clientKey) {
        throw new Error("Missing clientKey");
      }
      let isGbHost = false;
      try {
        isGbHost = !!new URL(context.apiHost || "").hostname.match(
          /growthbook\.io$/i
        );
      } catch (e) {
        // ignore invalid URLs
      }
      if (isGbHost) {
        throw new Error("Cannot use remoteEval on GrowthBook Cloud");
      }
    } else {
      if (context.cacheKeyAttributes) {
        throw new Error("cacheKeyAttributes are only used for remoteEval");
      }
    }

    if (context.features) {
      this.ready = true;
    }

    if (isBrowser && context.enableDevMode) {
      window._growthbook = this;
      document.dispatchEvent(new Event("gbloaded"));
    }

    if (context.experiments) {
      this.ready = true;
      this._updateAllAutoExperiments();
    }

    // Hydrate sticky bucket service
    if (this._ctx.stickyBucketService && this._ctx.stickyBucketAssignmentDocs) {
      for (const key in this._ctx.stickyBucketAssignmentDocs) {
        const doc = this._ctx.stickyBucketAssignmentDocs[key];
        if (doc) {
          this._ctx.stickyBucketService.saveAssignments(doc).catch(() => {
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

  public async setPayload(payload: FeatureApiResponse): Promise<void> {
    this._payload = payload;
    const data = await this.decryptPayload(payload);
    this._decryptedPayload = data;
    await this.refreshStickyBuckets(data);
    if (data.features) {
      this._ctx.features = data.features;
    }
    if (data.savedGroups) {
      this._ctx.savedGroups = data.savedGroups;
    }
    if (data.experiments) {
      this._ctx.experiments = data.experiments;
      this._updateAllAutoExperiments();
    }
    this.ready = true;
    this._render();
  }

  public initSync(options: InitSyncOptions): GrowthBook {
    this._initialized = true;

    const payload = options.payload;

    if (payload.encryptedExperiments || payload.encryptedFeatures) {
      throw new Error("initSync does not support encrypted payloads");
    }

    if (
      this._ctx.stickyBucketService &&
      !this._ctx.stickyBucketAssignmentDocs
    ) {
      throw new Error(
        "initSync requires you to pass stickyBucketAssignmentDocs into the GrowthBook constructor"
      );
    }

    this._payload = payload;
    this._decryptedPayload = payload;
    if (payload.features) {
      this._ctx.features = payload.features;
    }
    if (payload.experiments) {
      this._ctx.experiments = payload.experiments;
      this._updateAllAutoExperiments();
    }

    this.ready = true;

    if (options.streaming) {
      if (!this._ctx.clientKey) {
        throw new Error("Must specify clientKey to enable streaming");
      }
      startAutoRefresh(this, true);
      subscribe(this);
    }

    return this;
  }

  public async init(options?: InitOptions): Promise<InitResponse> {
    this._initialized = true;
    options = options || {};

    if (options.cacheSettings) {
      configureCache(options.cacheSettings);
    }

    if (options.payload) {
      await this.setPayload(options.payload);
      if (options.streaming) {
        if (!this._ctx.clientKey) {
          throw new Error("Must specify clientKey to enable streaming");
        }
        startAutoRefresh(this, true);
        subscribe(this);
      }

      return {
        success: true,
        source: "init",
      };
    } else {
      const { data, ...res } = await this._refresh({
        ...options,
        allowStale: true,
      });
      if (options.streaming) {
        subscribe(this);
      }

      await this.setPayload(data || {});
      return res;
    }
  }

  /** @deprecated Use {@link init} */
  public async loadFeatures(options?: LoadFeaturesOptions): Promise<void> {
    this._initialized = true;

    options = options || {};
    if (options.autoRefresh) {
      // interpret deprecated autoRefresh option as subscribeToChanges
      this._ctx.subscribeToChanges = true;
    }
    const { data } = await this._refresh({
      ...options,
      allowStale: true,
    });
    await this.setPayload(data || {});

    if (this._canSubscribe()) {
      subscribe(this);
    }
  }

  public async refreshFeatures(
    options?: RefreshFeaturesOptions
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
  public getApiHosts(): {
    apiHost: string;
    streamingHost: string;
    apiRequestHeaders?: Record<string, string>;
    streamingHostRequestHeaders?: Record<string, string>;
  } {
    const defaultHost = this._ctx.apiHost || "https://cdn.growthbook.io";
    return {
      apiHost: defaultHost.replace(/\/*$/, ""),
      streamingHost: (this._ctx.streamingHost || defaultHost).replace(
        /\/*$/,
        ""
      ),
      apiRequestHeaders: this._ctx.apiHostRequestHeaders,
      streamingHostRequestHeaders: this._ctx.streamingHostRequestHeaders,
    };
  }
  public getClientKey(): string {
    return this._ctx.clientKey || "";
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
    return this._ctx.remoteEval || false;
  }

  public getCacheKeyAttributes(): (keyof Attributes)[] | undefined {
    return this._ctx.cacheKeyAttributes;
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
    if (!this._ctx.clientKey) {
      throw new Error("Missing clientKey");
    }
    // Trigger refresh in feature repository
    return refreshFeatures({
      instance: this,
      timeout,
      skipCache: skipCache || this._ctx.disableCache,
      allowStale,
      backgroundSync: streaming ?? this._ctx.backgroundSync ?? true,
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
    this._ctx.features = features;
    this.ready = true;
    this._render();
  }

  /** @deprecated Use {@link setPayload} */
  public async setEncryptedFeatures(
    encryptedString: string,
    decryptionKey?: string,
    subtle?: SubtleCrypto
  ): Promise<void> {
    const featuresJSON = await decrypt(
      encryptedString,
      decryptionKey || this._ctx.decryptionKey,
      subtle
    );
    this.setFeatures(
      JSON.parse(featuresJSON) as Record<string, FeatureDefinition>
    );
  }

  /** @deprecated Use {@link setPayload} */
  public setExperiments(experiments: AutoExperiment[]): void {
    this._ctx.experiments = experiments;
    this.ready = true;
    this._updateAllAutoExperiments();
  }

  /** @deprecated Use {@link setPayload} */
  public async setEncryptedExperiments(
    encryptedString: string,
    decryptionKey?: string,
    subtle?: SubtleCrypto
  ): Promise<void> {
    const experimentsJSON = await decrypt(
      encryptedString,
      decryptionKey || this._ctx.decryptionKey,
      subtle
    );
    this.setExperiments(JSON.parse(experimentsJSON) as AutoExperiment[]);
  }

  public async decryptPayload(
    data: FeatureApiResponse,
    decryptionKey?: string,
    subtle?: SubtleCrypto
  ): Promise<FeatureApiResponse> {
    data = { ...data };
    if (data.encryptedFeatures) {
      try {
        data.features = JSON.parse(
          await decrypt(
            data.encryptedFeatures,
            decryptionKey || this._ctx.decryptionKey,
            subtle
          )
        );
      } catch (e) {
        console.error(e);
      }
      delete data.encryptedFeatures;
    }
    if (data.encryptedExperiments) {
      try {
        data.experiments = JSON.parse(
          await decrypt(
            data.encryptedExperiments,
            decryptionKey || this._ctx.decryptionKey,
            subtle
          )
        );
      } catch (e) {
        console.error(e);
      }
      delete data.encryptedExperiments;
    }
    if (data.encryptedSavedGroups) {
      try {
        data.savedGroups = JSON.parse(
          await decrypt(
            data.encryptedSavedGroups,
            decryptionKey || this._ctx.decryptionKey,
            subtle
          )
        );
      } catch (e) {
        console.error(e);
      }
      delete data.encryptedSavedGroups;
    }
    return data;
  }

  public async setAttributes(attributes: Attributes) {
    this._ctx.attributes = attributes;
    if (this._ctx.stickyBucketService) {
      await this.refreshStickyBuckets();
    }
    if (this._ctx.remoteEval) {
      await this._refreshForRemoteEval();
      return;
    }
    this._render();
    this._updateAllAutoExperiments();
  }

  public async updateAttributes(attributes: Attributes) {
    return this.setAttributes({ ...this._ctx.attributes, ...attributes });
  }

  public async setAttributeOverrides(overrides: Attributes) {
    this._attributeOverrides = overrides;
    if (this._ctx.stickyBucketService) {
      await this.refreshStickyBuckets();
    }
    if (this._ctx.remoteEval) {
      await this._refreshForRemoteEval();
      return;
    }
    this._render();
    this._updateAllAutoExperiments();
  }

  public async setForcedVariations(vars: Record<string, number>) {
    this._ctx.forcedVariations = vars || {};
    if (this._ctx.remoteEval) {
      await this._refreshForRemoteEval();
      return;
    }
    this._render();
    this._updateAllAutoExperiments();
  }

  // eslint-disable-next-line
  public setForcedFeatures(map: Map<string, any>) {
    this._forcedFeatureValues = map;
    this._render();
  }

  public async setURL(url: string) {
    if (url === this._ctx.url) return;
    this._ctx.url = url;
    this._redirectedUrl = "";
    if (this._ctx.remoteEval) {
      await this._refreshForRemoteEval();
      this._updateAllAutoExperiments(true);
      return;
    }
    this._updateAllAutoExperiments(true);
  }

  public getAttributes() {
    return { ...this._ctx.attributes, ...this._attributeOverrides };
  }

  public getForcedVariations() {
    return this._ctx.forcedVariations || {};
  }

  public getForcedFeatures() {
    // eslint-disable-next-line
    return this._forcedFeatureValues || new Map<string, any>();
  }

  public getStickyBucketAssignmentDocs() {
    return this._ctx.stickyBucketAssignmentDocs || {};
  }

  public getUrl() {
    return this._ctx.url || "";
  }

  public getFeatures() {
    return this._ctx.features || {};
  }

  public getExperiments() {
    return this._ctx.experiments || [];
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

  private _canSubscribe() {
    return (this._ctx.backgroundSync ?? true) && this._ctx.subscribeToChanges;
  }

  private async _refreshForRemoteEval() {
    if (!this._ctx.remoteEval) return;
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

  public destroy() {
    // Release references to save memory
    this._subscriptions.clear();
    this._assigned.clear();
    this._trackedExperiments.clear();
    this._completedChangeIds.clear();
    this._deferredTrackingCalls.clear();
    this._trackedFeatures = {};
    this._rtQueue = [];
    this._payload = undefined;
    if (this._rtTimer) {
      clearTimeout(this._rtTimer);
    }
    unsubscribe(this);

    if (isBrowser && window._growthbook === this) {
      delete window._growthbook;
    }

    // Undo any active auto experiments
    this._activeAutoExperiments.forEach((exp) => {
      exp.undo();
    });
    this._activeAutoExperiments.clear();
    this._triggeredExpKeys.clear();
  }

  public setRenderer(renderer: null | RenderFunction) {
    this._renderer = renderer;
  }

  public forceVariation(key: string, variation: number) {
    this._ctx.forcedVariations = this._ctx.forcedVariations || {};
    this._ctx.forcedVariations[key] = variation;
    if (this._ctx.remoteEval) {
      this._refreshForRemoteEval();
      return;
    }
    this._updateAllAutoExperiments();
    this._render();
  }

  public run<T>(experiment: Experiment<T>): Result<T> {
    const { result } = runExperiment(experiment, null, this._getEvalContext());
    this._fireSubscriptions(experiment, result);
    return result;
  }

  public triggerExperiment(key: string) {
    this._triggeredExpKeys.add(key);
    if (!this._ctx.experiments) return null;
    const experiments = this._ctx.experiments.filter((exp) => exp.key === key);
    return experiments
      .map((exp) => {
        return this._runAutoExperiment(exp);
      })
      .filter((res) => res !== null);
  }

  public triggerAutoExperiments() {
    this._autoExperimentsAllowed = true;
    this._updateAllAutoExperiments(true);
  }

  private _getEvalContext(): FeatureEvalContext {
    return {
      attributes: this.getAttributes(),
      forcedVariations: this.getForcedVariations(),
      forcedFeatureValues: this.getForcedFeatures(),
      url: this._getContextUrl(),
      features: this.getFeatures(),
      evaluatedFeatures: new Set(),
      log: this.log.bind(this),
      enabled: this._ctx.enabled,
      qaMode: this._ctx.qaMode,
      savedGroups: this._ctx.savedGroups,
      stickyBucketAssignmentDocs: this._ctx.stickyBucketAssignmentDocs,
      stickyBucketIdentifierAttributes: this._ctx
        .stickyBucketIdentifierAttributes,
      stickyBucketService: this._ctx.stickyBucketService,
      groups: this._ctx.groups,
      overrides: this._ctx.overrides,
      onExperimentEval: (exp, res) => {
        this._fireSubscriptions(exp, res);
      },
      onExperimentView: (experiment, result) => {
        return this._track(experiment, result);
      },
      onFeatureUsage: (key, res) => {
        this._trackFeatureUsage(key, res);
      },
      recordChangeId: (id) => {
        this._completedChangeIds.add(id);
      },
    };
  }

  private _runAutoExperiment(experiment: AutoExperiment, forceRerun?: boolean) {
    const existing = this._activeAutoExperiments.get(experiment);

    // If this is a manual experiment and it's not already running, skip
    if (
      experiment.manual &&
      !this._triggeredExpKeys.has(experiment.key) &&
      !existing
    )
      return null;

    // Check if this particular experiment is blocked by context settings
    // For example, if all visualEditor experiments are disabled
    const isBlocked = this._isAutoExperimentBlockedByContext(experiment);
    if (isBlocked) {
      process.env.NODE_ENV !== "production" &&
        this.log("Auto experiment blocked", { id: experiment.key });
    }

    let result: Result<AutoExperimentVariation> | undefined;
    let trackingCall: Promise<void> | undefined;
    // Run the experiment (if blocked exclude)
    if (isBlocked) {
      result = getExperimentResult(
        this._getEvalContext(),
        experiment,
        -1,
        false,
        ""
      );
    } else {
      ({ result, trackingCall } = runExperiment(
        experiment,
        null,
        this._getEvalContext()
      ));
      this._fireSubscriptions(experiment, result);
    }

    // A hash to quickly tell if the assigned value changed
    const valueHash = JSON.stringify(result.value);

    // If the changes are already active, no need to re-apply them
    if (
      !forceRerun &&
      result.inExperiment &&
      existing &&
      existing.valueHash === valueHash
    ) {
      return result;
    }

    // Undo any existing changes
    if (existing) this._undoActiveAutoExperiment(experiment);

    // Apply new changes
    if (result.inExperiment) {
      const changeType = getAutoExperimentChangeType(experiment);

      if (
        changeType === "redirect" &&
        result.value.urlRedirect &&
        experiment.urlPatterns
      ) {
        const url = experiment.persistQueryString
          ? mergeQueryStrings(this._getContextUrl(), result.value.urlRedirect)
          : result.value.urlRedirect;

        if (isURLTargeted(url, experiment.urlPatterns)) {
          this.log(
            "Skipping redirect because original URL matches redirect URL",
            {
              id: experiment.key,
            }
          );
          return result;
        }
        this._redirectedUrl = url;
        const { navigate, delay } = this._getNavigateFunction();
        if (navigate) {
          if (isBrowser) {
            // Wait for the possibly-async tracking callback, bound by min and max delays
            Promise.all([
              ...(trackingCall
                ? [
                    promiseTimeout(
                      trackingCall,
                      this._ctx.maxNavigateDelay ?? 1000
                    ),
                  ]
                : []),
              new Promise((resolve) =>
                window.setTimeout(resolve, this._ctx.navigateDelay ?? delay)
              ),
            ]).then(() => {
              try {
                navigate(url);
              } catch (e) {
                console.error(e);
              }
            });
          } else {
            try {
              navigate(url);
            } catch (e) {
              console.error(e);
            }
          }
        }
      } else if (changeType === "visual") {
        const undo = this._ctx.applyDomChangesCallback
          ? this._ctx.applyDomChangesCallback(result.value)
          : this._applyDOMChanges(result.value);
        if (undo) {
          this._activeAutoExperiments.set(experiment, {
            undo,
            valueHash,
          });
        }
      }
    }

    return result;
  }

  private _undoActiveAutoExperiment(exp: AutoExperiment) {
    const data = this._activeAutoExperiments.get(exp);
    if (data) {
      data.undo();
      this._activeAutoExperiments.delete(exp);
    }
  }

  private _updateAllAutoExperiments(forceRerun?: boolean) {
    if (!this._autoExperimentsAllowed) return;

    const experiments = this._ctx.experiments || [];

    // Stop any experiments that are no longer defined
    const keys = new Set(experiments);
    this._activeAutoExperiments.forEach((v, k) => {
      if (!keys.has(k)) {
        v.undo();
        this._activeAutoExperiments.delete(k);
      }
    });

    // Re-run all new/updated experiments
    for (const exp of experiments) {
      const result = this._runAutoExperiment(exp, forceRerun);

      // Once you're in a redirect experiment, break out of the loop and don't run any further experiments
      if (
        result?.inExperiment &&
        getAutoExperimentChangeType(exp) === "redirect"
      ) {
        break;
      }
    }
  }

  private _fireSubscriptions<T>(experiment: Experiment<T>, result: Result<T>) {
    const key = experiment.key;

    // If assigned variation has changed, fire subscriptions
    const prev = this._assigned.get(key);
    // TODO: what if the experiment definition has changed?
    if (
      !prev ||
      prev.result.inExperiment !== result.inExperiment ||
      prev.result.variationId !== result.variationId
    ) {
      this._assigned.set(key, { experiment, result });
      this._subscriptions.forEach((cb) => {
        try {
          cb(experiment, result);
        } catch (e) {
          console.error(e);
        }
      });
    }
  }

  private _trackFeatureUsage(key: string, res: FeatureResult): void {
    // Don't track feature usage that was forced via an override
    if (res.source === "override") return;

    // Only track a feature once, unless the assigned value changed
    const stringifiedValue = JSON.stringify(res.value);
    if (this._trackedFeatures[key] === stringifiedValue) return;
    this._trackedFeatures[key] = stringifiedValue;

    // Fire user-supplied callback
    if (this._ctx.onFeatureUsage) {
      try {
        this._ctx.onFeatureUsage(key, res);
      } catch (e) {
        // Ignore feature usage callback errors
      }
    }

    // In browser environments, queue up feature usage to be tracked in batches
    if (!isBrowser || !window.fetch) return;
    this._rtQueue.push({
      key,
      on: res.on,
    });
    if (!this._rtTimer) {
      this._rtTimer = window.setTimeout(() => {
        // Reset the queue
        this._rtTimer = 0;
        const q = [...this._rtQueue];
        this._rtQueue = [];

        // Skip logging if a real-time usage key is not configured
        if (!this._ctx.realtimeKey) return;

        window
          .fetch(
            `https://rt.growthbook.io/?key=${
              this._ctx.realtimeKey
            }&events=${encodeURIComponent(JSON.stringify(q))}`,

            {
              cache: "no-cache",
              mode: "no-cors",
            }
          )
          .catch(() => {
            // TODO: retry in case of network errors?
          });
      }, this._ctx.realtimeInterval || 2000);
    }
  }

  public isOn<K extends string & keyof AppFeatures = string>(key: K): boolean {
    return this.evalFeature(key).on;
  }

  public isOff<K extends string & keyof AppFeatures = string>(key: K): boolean {
    return this.evalFeature(key).off;
  }

  public getFeatureValue<
    V extends AppFeatures[K],
    K extends string & keyof AppFeatures = string
  >(key: K, defaultValue: V): WidenPrimitives<V> {
    const value = this.evalFeature<WidenPrimitives<V>, K>(key).value;
    return value === null ? (defaultValue as WidenPrimitives<V>) : value;
  }

  /**
   * @deprecated Use {@link evalFeature}
   * @param id
   */
  // eslint-disable-next-line
  public feature<
    V extends AppFeatures[K],
    K extends string & keyof AppFeatures = string
  >(id: K): FeatureResult<V | null> {
    return this.evalFeature(id);
  }

  public evalFeature<
    V extends AppFeatures[K],
    K extends string & keyof AppFeatures = string
  >(id: K): FeatureResult<V | null> {
    return _evalFeature(id, this._getEvalContext());
  }

  log(msg: string, ctx: Record<string, unknown>) {
    if (!this.debug) return;
    if (this._ctx.log) this._ctx.log(msg, ctx);
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
          return [this._getTrackKey(c.experiment, c.result), c];
        })
    );
  }

  public async fireDeferredTrackingCalls() {
    if (!this._ctx.trackingCallback) return;

    const promises: ReturnType<TrackingCallback>[] = [];
    this._deferredTrackingCalls.forEach((call: TrackingData) => {
      if (!call || !call.experiment || !call.result) {
        console.error("Invalid deferred tracking call", { call: call });
      } else {
        promises.push(this._track(call.experiment, call.result));
      }
    });
    this._deferredTrackingCalls.clear();
    await Promise.all(promises);
  }

  public setTrackingCallback(callback: TrackingCallback) {
    this._ctx.trackingCallback = callback;
    this.fireDeferredTrackingCalls();
  }

  private _getTrackKey(
    experiment: Experiment<unknown>,
    result: Result<unknown>
  ) {
    return (
      result.hashAttribute +
      result.hashValue +
      experiment.key +
      result.variationId
    );
  }

  private async _track<T>(experiment: Experiment<T>, result: Result<T>) {
    const k = this._getTrackKey(experiment, result);

    if (!this._ctx.trackingCallback) {
      // Add to deferred tracking if it hasn't already been added
      if (!this._deferredTrackingCalls.has(k)) {
        this._deferredTrackingCalls.set(k, { experiment, result });
      }
      return;
    }

    // Make sure a tracking callback is only fired once per unique experiment
    if (this._trackedExperiments.has(k)) return;
    this._trackedExperiments.add(k);

    try {
      await this._ctx.trackingCallback(experiment, result);
    } catch (e) {
      console.error(e);
    }
  }

  private _getContextUrl() {
    return this._ctx.url || (isBrowser ? window.location.href : "");
  }

  private _isAutoExperimentBlockedByContext(
    experiment: AutoExperiment
  ): boolean {
    const changeType = getAutoExperimentChangeType(experiment);
    if (changeType === "visual") {
      if (this._ctx.disableVisualExperiments) return true;

      if (this._ctx.disableJsInjection) {
        if (experiment.variations.some((v) => v.js)) {
          return true;
        }
      }
    } else if (changeType === "redirect") {
      if (this._ctx.disableUrlRedirectExperiments) return true;

      // Validate URLs
      try {
        const current = new URL(this._getContextUrl());
        for (const v of experiment.variations) {
          if (!v || !v.urlRedirect) continue;
          const url = new URL(v.urlRedirect);

          // If we're blocking cross origin redirects, block if the protocol or host is different
          if (this._ctx.disableCrossOriginUrlRedirectExperiments) {
            if (url.protocol !== current.protocol) return true;
            if (url.host !== current.host) return true;
          }
        }
      } catch (e) {
        // Problem parsing one of the URLs
        this.log("Error parsing current or redirect URL", {
          id: experiment.key,
          error: e,
        });
        return true;
      }
    } else {
      // Block any unknown changeTypes
      return true;
    }

    if (
      experiment.changeId &&
      (this._ctx.blockedChangeIds || []).includes(experiment.changeId)
    ) {
      return true;
    }

    return false;
  }

  public getRedirectUrl(): string {
    return this._redirectedUrl;
  }

  private _getNavigateFunction(): {
    navigate: null | ((url: string) => void | Promise<void>);
    delay: number;
  } {
    if (this._ctx.navigate) {
      return {
        navigate: this._ctx.navigate,
        delay: 0,
      };
    } else if (isBrowser) {
      return {
        navigate: (url: string) => {
          window.location.replace(url);
        },
        delay: 100,
      };
    }
    return {
      navigate: null,
      delay: 0,
    };
  }

  private _applyDOMChanges(changes: AutoExperimentVariation) {
    if (!isBrowser) return;
    const undo: (() => void)[] = [];
    if (changes.css) {
      const s = document.createElement("style");
      s.innerHTML = changes.css;
      document.head.appendChild(s);
      undo.push(() => s.remove());
    }
    if (changes.js) {
      const script = document.createElement("script");
      script.innerHTML = changes.js;
      if (this._ctx.jsInjectionNonce) {
        script.nonce = this._ctx.jsInjectionNonce;
      }
      document.head.appendChild(script);
      undo.push(() => script.remove());
    }
    if (changes.domMutations) {
      changes.domMutations.forEach((mutation) => {
        undo.push(mutate.declarative(mutation as DeclarativeMutation).revert);
      });
    }
    return () => {
      undo.forEach((fn) => fn());
    };
  }

  private _deriveStickyBucketIdentifierAttributes(data?: FeatureApiResponse) {
    const attributes = new Set<string>();
    const features = data && data.features ? data.features : this.getFeatures();
    const experiments =
      data && data.experiments ? data.experiments : this.getExperiments();
    Object.keys(features).forEach((id) => {
      const feature = features[id];
      if (feature.rules) {
        for (const rule of feature.rules) {
          if (rule.variations) {
            attributes.add(rule.hashAttribute || "id");
            if (rule.fallbackAttribute) {
              attributes.add(rule.fallbackAttribute);
            }
          }
        }
      }
    });
    experiments.map((experiment) => {
      attributes.add(experiment.hashAttribute || "id");
      if (experiment.fallbackAttribute) {
        attributes.add(experiment.fallbackAttribute);
      }
    });
    return Array.from(attributes);
  }

  public async refreshStickyBuckets(data?: FeatureApiResponse) {
    if (this._ctx.stickyBucketService) {
      const attributes = this._getStickyBucketAttributes(data);
      this._ctx.stickyBucketAssignmentDocs = await this._ctx.stickyBucketService.getAllAssignments(
        attributes
      );
    }
  }

  private _getStickyBucketAttributes(
    data?: FeatureApiResponse
  ): Record<string, string> {
    const attributes: Record<string, string> = {};
    this._ctx.stickyBucketIdentifierAttributes = this._deriveStickyBucketIdentifierAttributes(
      data
    );
    this._ctx.stickyBucketIdentifierAttributes.forEach((attr) => {
      const { hashValue } = getHashAttribute(this._getEvalContext(), attr);
      attributes[attr] = toString(hashValue);
    });
    return attributes;
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
