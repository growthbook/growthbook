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
  FeatureResultSource,
  Filter,
  LoadFeaturesOptions,
  RealtimeUsageData,
  RefreshFeaturesOptions,
  RenderFunction,
  Result,
  StickyAssignments,
  StickyAssignmentsDocument,
  StickyAttributeKey,
  StickyExperimentKey,
  SubscriptionFunction,
  TrackingCallback,
  TrackingData,
  VariationMeta,
  VariationRange,
  WidenPrimitives,
  FeatureEvalContext,
  InitOptions,
  InitResponse,
} from "./types/growthbook";
import type { ConditionInterface } from "./types/mongrule";
import {
  chooseVariation,
  decrypt,
  getAutoExperimentChangeType,
  getBucketRanges,
  getQueryStringOverride,
  getUrlRegExp,
  hash,
  inNamespace,
  inRange,
  isIncluded,
  isURLTargeted,
  loadSDKVersion,
  mergeQueryStrings,
  toString,
} from "./util";
import { evalCondition } from "./mongrule";
import {
  refreshFeatures,
  startAutoRefresh,
  subscribe,
  unsubscribe,
} from "./feature-repository";

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
    } else if (context.antiFlicker) {
      this._setAntiFlicker();
    }

    // Legacy - passing in features/experiments into the constructor instead of using init
    if (this.ready) {
      this.refreshStickyBuckets(this.getPayload());
    }
  }

  public async setPayload(payload: FeatureApiResponse): Promise<void> {
    this._payload = payload;
    const data = await this.decryptPayload(payload);
    await this.refreshStickyBuckets(data);
    if (data.features) {
      this._ctx.features = data.features;
    }
    if (data.experiments) {
      this._ctx.experiments = data.experiments;
      this._updateAllAutoExperiments();
    }
    this.ready = true;
    this._render();
  }

  public async init(options?: InitOptions): Promise<InitResponse> {
    this._initialized = true;

    options = options || {};
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
    if (data.encryptedFeatures) {
      data.features = JSON.parse(
        await decrypt(
          data.encryptedFeatures,
          decryptionKey || this._ctx.decryptionKey,
          subtle
        )
      );
      delete data.encryptedFeatures;
    }
    if (data.encryptedExperiments) {
      data.experiments = JSON.parse(
        await decrypt(
          data.encryptedExperiments,
          decryptionKey || this._ctx.decryptionKey,
          subtle
        )
      );
      delete data.encryptedExperiments;
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
    const result = this._run(experiment, null);
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

    // Run the experiment (if blocked exclude)
    const result = isBlocked
      ? this._getResult(experiment, -1, false, "")
      : this.run(experiment);

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
        const navigate = this._getNavigateFunction();
        if (navigate) {
          if (isBrowser) {
            this._setAntiFlicker();
            window.setTimeout(() => {
              try {
                navigate(url);
              } catch (e) {
                console.error(e);
              }
            }, this._ctx.navigateDelay ?? 100);
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

  private _getFeatureResult<T>(
    key: string,
    value: T,
    source: FeatureResultSource,
    ruleId?: string,
    experiment?: Experiment<T>,
    result?: Result<T>
  ): FeatureResult<T> {
    const ret: FeatureResult = {
      value,
      on: !!value,
      off: !value,
      source,
      ruleId: ruleId || "",
    };
    if (experiment) ret.experiment = experiment;
    if (result) ret.experimentResult = result;

    // Track the usage of this feature in real-time
    this._trackFeatureUsage(key, ret);

    return ret;
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
    return this._evalFeature(id);
  }

  private _evalFeature<
    V extends AppFeatures[K],
    K extends string & keyof AppFeatures = string
  >(id: K, evalCtx?: FeatureEvalContext): FeatureResult<V | null> {
    evalCtx = evalCtx || { evaluatedFeatures: new Set() };

    if (evalCtx.evaluatedFeatures.has(id)) {
      process.env.NODE_ENV !== "production" &&
        this.log(
          `evalFeature: circular dependency detected: ${evalCtx.id} -> ${id}`,
          { from: evalCtx.id, to: id }
        );
      return this._getFeatureResult(id, null, "cyclicPrerequisite");
    }
    evalCtx.evaluatedFeatures.add(id);
    evalCtx.id = id;

    // Global override
    if (this._forcedFeatureValues.has(id)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Global override", {
          id,
          value: this._forcedFeatureValues.get(id),
        });
      return this._getFeatureResult(
        id,
        this._forcedFeatureValues.get(id),
        "override"
      );
    }

    // Unknown feature id
    if (!this._ctx.features || !this._ctx.features[id]) {
      process.env.NODE_ENV !== "production" &&
        this.log("Unknown feature", { id });
      return this._getFeatureResult(id, null, "unknownFeature");
    }

    // Get the feature
    const feature: FeatureDefinition<V> = this._ctx.features[id];

    // Loop through the rules
    if (feature.rules) {
      rules: for (const rule of feature.rules) {
        // If there are prerequisite flag(s), evaluate them
        if (rule.parentConditions) {
          for (const parentCondition of rule.parentConditions) {
            const parentResult = this._evalFeature(parentCondition.id, evalCtx);
            // break out for cyclic prerequisites
            if (parentResult.source === "cyclicPrerequisite") {
              return this._getFeatureResult(id, null, "cyclicPrerequisite");
            }

            const evalObj = { value: parentResult.value };
            const evaled = evalCondition(
              evalObj,
              parentCondition.condition || {}
            );
            if (!evaled) {
              // blocking prerequisite eval failed: feature evaluation fails
              if (parentCondition.gate) {
                process.env.NODE_ENV !== "production" &&
                  this.log("Feature blocked by prerequisite", { id, rule });
                return this._getFeatureResult(id, null, "prerequisite");
              }
              // non-blocking prerequisite eval failed: break out of parentConditions loop, jump to the next rule
              process.env.NODE_ENV !== "production" &&
                this.log("Skip rule because prerequisite evaluation fails", {
                  id,
                  rule,
                });
              continue rules;
            }
          }
        }

        // If there are filters for who is included (e.g. namespaces)
        if (rule.filters && this._isFilteredOut(rule.filters)) {
          process.env.NODE_ENV !== "production" &&
            this.log("Skip rule because of filters", {
              id,
              rule,
            });
          continue;
        }

        // Feature value is being forced
        if ("force" in rule) {
          // If it's a conditional rule, skip if the condition doesn't pass
          if (rule.condition && !this._conditionPasses(rule.condition)) {
            process.env.NODE_ENV !== "production" &&
              this.log("Skip rule because of condition ff", {
                id,
                rule,
              });
            continue;
          }

          // If this is a percentage rollout, skip if not included
          if (
            !this._isIncludedInRollout(
              rule.seed || id,
              rule.hashAttribute,
              this._ctx.stickyBucketService && !rule.disableStickyBucketing
                ? rule.fallbackAttribute
                : undefined,
              rule.range,
              rule.coverage,
              rule.hashVersion
            )
          ) {
            process.env.NODE_ENV !== "production" &&
              this.log("Skip rule because user not included in rollout", {
                id,
                rule,
              });
            continue;
          }

          process.env.NODE_ENV !== "production" &&
            this.log("Force value from rule", {
              id,
              rule,
            });

          // If this was a remotely evaluated experiment, fire the tracking callbacks
          if (rule.tracks) {
            rule.tracks.forEach((t) => {
              this._track(t.experiment, t.result);
            });
          }

          return this._getFeatureResult(id, rule.force as V, "force", rule.id);
        }
        if (!rule.variations) {
          process.env.NODE_ENV !== "production" &&
            this.log("Skip invalid rule", {
              id,
              rule,
            });

          continue;
        }

        // For experiment rules, run an experiment
        const exp: Experiment<V> = {
          variations: rule.variations as [V, V, ...V[]],
          key: rule.key || id,
        };
        if ("coverage" in rule) exp.coverage = rule.coverage;
        if (rule.weights) exp.weights = rule.weights;
        if (rule.hashAttribute) exp.hashAttribute = rule.hashAttribute;
        if (rule.fallbackAttribute)
          exp.fallbackAttribute = rule.fallbackAttribute;
        if (rule.disableStickyBucketing)
          exp.disableStickyBucketing = rule.disableStickyBucketing;
        if (rule.bucketVersion !== undefined)
          exp.bucketVersion = rule.bucketVersion;
        if (rule.minBucketVersion !== undefined)
          exp.minBucketVersion = rule.minBucketVersion;
        if (rule.namespace) exp.namespace = rule.namespace;
        if (rule.meta) exp.meta = rule.meta;
        if (rule.ranges) exp.ranges = rule.ranges;
        if (rule.name) exp.name = rule.name;
        if (rule.phase) exp.phase = rule.phase;
        if (rule.seed) exp.seed = rule.seed;
        if (rule.hashVersion) exp.hashVersion = rule.hashVersion;
        if (rule.filters) exp.filters = rule.filters;
        if (rule.condition) exp.condition = rule.condition;

        // Only return a value if the user is part of the experiment
        const res = this._run(exp, id);
        this._fireSubscriptions(exp, res);
        if (res.inExperiment && !res.passthrough) {
          return this._getFeatureResult(
            id,
            res.value,
            "experiment",
            rule.id,
            exp,
            res
          );
        }
      }
    }

    process.env.NODE_ENV !== "production" &&
      this.log("Use default value", {
        id,
        value: feature.defaultValue,
      });

    // Fall back to using the default value
    return this._getFeatureResult(
      id,
      feature.defaultValue === undefined ? null : feature.defaultValue,
      "defaultValue"
    );
  }

  private _isIncludedInRollout(
    seed: string,
    hashAttribute: string | undefined,
    fallbackAttribute: string | undefined,
    range: VariationRange | undefined,
    coverage: number | undefined,
    hashVersion: number | undefined
  ): boolean {
    if (!range && coverage === undefined) return true;

    if (!range && coverage === 0) return false;

    const { hashValue } = this._getHashAttribute(
      hashAttribute,
      fallbackAttribute
    );
    if (!hashValue) {
      return false;
    }

    const n = hash(seed, hashValue, hashVersion || 1);
    if (n === null) return false;

    return range
      ? inRange(n, range)
      : coverage !== undefined
      ? n <= coverage
      : true;
  }

  private _conditionPasses(condition: ConditionInterface): boolean {
    return evalCondition(this.getAttributes(), condition);
  }

  private _isFilteredOut(filters: Filter[]): boolean {
    return filters.some((filter) => {
      const { hashValue } = this._getHashAttribute(filter.attribute);
      if (!hashValue) return true;
      const n = hash(filter.seed, hashValue, filter.hashVersion || 2);
      if (n === null) return true;
      return !filter.ranges.some((r) => inRange(n, r));
    });
  }

  private _run<T>(
    experiment: Experiment<T>,
    featureId: string | null
  ): Result<T> {
    const key = experiment.key;
    const numVariations = experiment.variations.length;

    // 1. If experiment has less than 2 variations, return immediately
    if (numVariations < 2) {
      process.env.NODE_ENV !== "production" &&
        this.log("Invalid experiment", { id: key });
      return this._getResult(experiment, -1, false, featureId);
    }

    // 2. If the context is disabled, return immediately
    if (this._ctx.enabled === false) {
      process.env.NODE_ENV !== "production" &&
        this.log("Context disabled", { id: key });
      return this._getResult(experiment, -1, false, featureId);
    }

    // 2.5. Merge in experiment overrides from the context
    experiment = this._mergeOverrides(experiment);

    // 2.6 New, more powerful URL targeting
    if (
      experiment.urlPatterns &&
      !isURLTargeted(this._getContextUrl(), experiment.urlPatterns)
    ) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because of url targeting", {
          id: key,
        });
      return this._getResult(experiment, -1, false, featureId);
    }

    // 3. If a variation is forced from a querystring, return the forced variation
    const qsOverride = getQueryStringOverride(
      key,
      this._getContextUrl(),
      numVariations
    );
    if (qsOverride !== null) {
      process.env.NODE_ENV !== "production" &&
        this.log("Force via querystring", {
          id: key,
          variation: qsOverride,
        });
      return this._getResult(experiment, qsOverride, false, featureId);
    }

    // 4. If a variation is forced in the context, return the forced variation
    if (this._ctx.forcedVariations && key in this._ctx.forcedVariations) {
      const variation = this._ctx.forcedVariations[key];
      process.env.NODE_ENV !== "production" &&
        this.log("Force via dev tools", {
          id: key,
          variation,
        });
      return this._getResult(experiment, variation, false, featureId);
    }

    // 5. Exclude if a draft experiment or not active
    if (experiment.status === "draft" || experiment.active === false) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because inactive", {
          id: key,
        });
      return this._getResult(experiment, -1, false, featureId);
    }

    // 6. Get the hash attribute and return if empty
    const { hashAttribute, hashValue } = this._getHashAttribute(
      experiment.hashAttribute,
      this._ctx.stickyBucketService && !experiment.disableStickyBucketing
        ? experiment.fallbackAttribute
        : undefined
    );
    if (!hashValue) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because missing hashAttribute", {
          id: key,
        });
      return this._getResult(experiment, -1, false, featureId);
    }

    let assigned = -1;

    let foundStickyBucket = false;
    let stickyBucketVersionIsBlocked = false;
    if (this._ctx.stickyBucketService && !experiment.disableStickyBucketing) {
      const { variation, versionIsBlocked } = this._getStickyBucketVariation({
        expKey: experiment.key,
        expBucketVersion: experiment.bucketVersion,
        expHashAttribute: experiment.hashAttribute,
        expFallbackAttribute: experiment.fallbackAttribute,
        expMinBucketVersion: experiment.minBucketVersion,
        expMeta: experiment.meta,
      });
      foundStickyBucket = variation >= 0;
      assigned = variation;
      stickyBucketVersionIsBlocked = !!versionIsBlocked;
    }

    // Some checks are not needed if we already have a sticky bucket
    if (!foundStickyBucket) {
      // 7. Exclude if user is filtered out (used to be called "namespace")
      if (experiment.filters) {
        if (this._isFilteredOut(experiment.filters)) {
          process.env.NODE_ENV !== "production" &&
            this.log("Skip because of filters", {
              id: key,
            });
          return this._getResult(experiment, -1, false, featureId);
        }
      } else if (
        experiment.namespace &&
        !inNamespace(hashValue, experiment.namespace)
      ) {
        process.env.NODE_ENV !== "production" &&
          this.log("Skip because of namespace", {
            id: key,
          });
        return this._getResult(experiment, -1, false, featureId);
      }

      // 7.5. Exclude if experiment.include returns false or throws
      if (experiment.include && !isIncluded(experiment.include)) {
        process.env.NODE_ENV !== "production" &&
          this.log("Skip because of include function", {
            id: key,
          });
        return this._getResult(experiment, -1, false, featureId);
      }

      // 8. Exclude if condition is false
      if (
        experiment.condition &&
        !this._conditionPasses(experiment.condition)
      ) {
        process.env.NODE_ENV !== "production" &&
          this.log("Skip because of condition exp", {
            id: key,
          });
        return this._getResult(experiment, -1, false, featureId);
      }

      // 8.05. Exclude if prerequisites are not met
      if (experiment.parentConditions) {
        for (const parentCondition of experiment.parentConditions) {
          const parentResult = this._evalFeature(parentCondition.id);
          // break out for cyclic prerequisites
          if (parentResult.source === "cyclicPrerequisite") {
            return this._getResult(experiment, -1, false, featureId);
          }

          const evalObj = { value: parentResult.value };
          if (!evalCondition(evalObj, parentCondition.condition || {})) {
            process.env.NODE_ENV !== "production" &&
              this.log("Skip because prerequisite evaluation fails", {
                id: key,
              });
            return this._getResult(experiment, -1, false, featureId);
          }
        }
      }

      // 8.1. Exclude if user is not in a required group
      if (
        experiment.groups &&
        !this._hasGroupOverlap(experiment.groups as string[])
      ) {
        process.env.NODE_ENV !== "production" &&
          this.log("Skip because of groups", {
            id: key,
          });
        return this._getResult(experiment, -1, false, featureId);
      }
    }

    // 8.2. Old style URL targeting
    if (experiment.url && !this._urlIsValid(experiment.url as RegExp)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because of url", {
          id: key,
        });
      return this._getResult(experiment, -1, false, featureId);
    }

    // 9. Get the variation from the sticky bucket or get bucket ranges and choose variation
    const n = hash(
      experiment.seed || key,
      hashValue,
      experiment.hashVersion || 1
    );
    if (n === null) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because of invalid hash version", {
          id: key,
        });
      return this._getResult(experiment, -1, false, featureId);
    }

    if (!foundStickyBucket) {
      const ranges =
        experiment.ranges ||
        getBucketRanges(
          numVariations,
          experiment.coverage === undefined ? 1 : experiment.coverage,
          experiment.weights
        );
      assigned = chooseVariation(n, ranges);
    }

    // 9.5 Unenroll if any prior sticky buckets are blocked by version
    if (stickyBucketVersionIsBlocked) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because sticky bucket version is blocked", {
          id: key,
        });
      return this._getResult(experiment, -1, false, featureId, undefined, true);
    }

    // 10. Return if not in experiment
    if (assigned < 0) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because of coverage", {
          id: key,
        });
      return this._getResult(experiment, -1, false, featureId);
    }

    // 11. Experiment has a forced variation
    if ("force" in experiment) {
      process.env.NODE_ENV !== "production" &&
        this.log("Force variation", {
          id: key,
          variation: experiment.force,
        });
      return this._getResult(
        experiment,
        experiment.force === undefined ? -1 : experiment.force,
        false,
        featureId
      );
    }

    // 12. Exclude if in QA mode
    if (this._ctx.qaMode) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because QA mode", {
          id: key,
        });
      return this._getResult(experiment, -1, false, featureId);
    }

    // 12.5. Exclude if experiment is stopped
    if (experiment.status === "stopped") {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because stopped", {
          id: key,
        });
      return this._getResult(experiment, -1, false, featureId);
    }

    // 13. Build the result object
    const result = this._getResult(
      experiment,
      assigned,
      true,
      featureId,
      n,
      foundStickyBucket
    );

    // 13.5. Persist sticky bucket
    if (this._ctx.stickyBucketService && !experiment.disableStickyBucketing) {
      const {
        changed,
        key: attrKey,
        doc,
      } = this._generateStickyBucketAssignmentDoc(
        hashAttribute,
        toString(hashValue),
        {
          [this._getStickyBucketExperimentKey(
            experiment.key,
            experiment.bucketVersion
          )]: result.key,
        }
      );
      if (changed) {
        // update local docs
        this._ctx.stickyBucketAssignmentDocs =
          this._ctx.stickyBucketAssignmentDocs || {};
        this._ctx.stickyBucketAssignmentDocs[attrKey] = doc;
        // save doc
        this._ctx.stickyBucketService.saveAssignments(doc);
      }
    }

    // 14. Fire the tracking callback
    this._track(experiment, result);

    // 14.1 Keep track of completed changeIds
    "changeId" in experiment &&
      experiment.changeId &&
      this._completedChangeIds.add(experiment.changeId as string);

    // 15. Return the result
    process.env.NODE_ENV !== "production" &&
      this.log("In experiment", {
        id: key,
        variation: result.variationId,
      });
    return result;
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

  public fireDeferredTrackingCalls() {
    if (!this._ctx.trackingCallback) return;

    this._deferredTrackingCalls.forEach((call: TrackingData) => {
      if (!call || !call.experiment || !call.result) {
        console.error("Invalid deferred tracking call", { call: call });
      } else {
        this._track(call.experiment, call.result);
      }
    });

    this._deferredTrackingCalls.clear();
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

  private _track<T>(experiment: Experiment<T>, result: Result<T>) {
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
      this._ctx.trackingCallback(experiment, result);
    } catch (e) {
      console.error(e);
    }
  }

  private _mergeOverrides<T>(experiment: Experiment<T>): Experiment<T> {
    const key = experiment.key;
    const o = this._ctx.overrides;
    if (o && o[key]) {
      experiment = Object.assign({}, experiment, o[key]);
      if (typeof experiment.url === "string") {
        experiment.url = getUrlRegExp(
          // eslint-disable-next-line
          experiment.url as any
        );
      }
    }

    return experiment;
  }

  private _getHashAttribute(attr?: string, fallback?: string) {
    let hashAttribute = attr || "id";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hashValue: any = "";

    if (this._attributeOverrides[hashAttribute]) {
      hashValue = this._attributeOverrides[hashAttribute];
    } else if (this._ctx.attributes) {
      hashValue = this._ctx.attributes[hashAttribute] || "";
    } else if (this._ctx.user) {
      hashValue = this._ctx.user[hashAttribute] || "";
    }

    // if no match, try fallback
    if (!hashValue && fallback) {
      if (this._attributeOverrides[fallback]) {
        hashValue = this._attributeOverrides[fallback];
      } else if (this._ctx.attributes) {
        hashValue = this._ctx.attributes[fallback] || "";
      } else if (this._ctx.user) {
        hashValue = this._ctx.user[fallback] || "";
      }
      if (hashValue) {
        hashAttribute = fallback;
      }
    }

    return { hashAttribute, hashValue };
  }

  private _getResult<T>(
    experiment: Experiment<T>,
    variationIndex: number,
    hashUsed: boolean,
    featureId: string | null,
    bucket?: number,
    stickyBucketUsed?: boolean
  ): Result<T> {
    let inExperiment = true;
    // If assigned variation is not valid, use the baseline and mark the user as not in the experiment
    if (variationIndex < 0 || variationIndex >= experiment.variations.length) {
      variationIndex = 0;
      inExperiment = false;
    }

    const { hashAttribute, hashValue } = this._getHashAttribute(
      experiment.hashAttribute,
      this._ctx.stickyBucketService && !experiment.disableStickyBucketing
        ? experiment.fallbackAttribute
        : undefined
    );

    const meta: Partial<VariationMeta> = experiment.meta
      ? experiment.meta[variationIndex]
      : {};

    const res: Result<T> = {
      key: meta.key || "" + variationIndex,
      featureId,
      inExperiment,
      hashUsed,
      variationId: variationIndex,
      value: experiment.variations[variationIndex],
      hashAttribute,
      hashValue,
      stickyBucketUsed: !!stickyBucketUsed,
    };

    if (meta.name) res.name = meta.name;
    if (bucket !== undefined) res.bucket = bucket;
    if (meta.passthrough) res.passthrough = meta.passthrough;

    return res;
  }

  private _getContextUrl() {
    return this._ctx.url || (isBrowser ? window.location.href : "");
  }

  private _urlIsValid(urlRegex: RegExp): boolean {
    const url = this._getContextUrl();
    if (!url) return false;

    const pathOnly = url.replace(/^https?:\/\//, "").replace(/^[^/]*\//, "/");

    if (urlRegex.test(url)) return true;
    if (urlRegex.test(pathOnly)) return true;
    return false;
  }

  private _hasGroupOverlap(expGroups: string[]): boolean {
    const groups = this._ctx.groups || {};
    for (let i = 0; i < expGroups.length; i++) {
      if (groups[expGroups[i]]) return true;
    }
    return false;
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

  private _getNavigateFunction():
    | null
    | ((url: string) => void | Promise<void>) {
    if (this._ctx.navigate) {
      return this._ctx.navigate;
    } else if (isBrowser) {
      return (url: string) => {
        window.location.replace(url);
      };
    }
    return null;
  }

  private _setAntiFlicker() {
    if (!this._ctx.antiFlicker || !isBrowser) return;
    try {
      const styleTag = document.createElement("style");
      styleTag.innerHTML =
        ".gb-anti-flicker { opacity: 0 !important; pointer-events: none; }";
      document.head.appendChild(styleTag);
      document.documentElement.classList.add("gb-anti-flicker");

      // Fallback if GrowthBook fails to load in specified time or 3.5 seconds
      setTimeout(() => {
        document.documentElement.classList.remove("gb-anti-flicker");
      }, this._ctx.antiFlickerTimeout ?? 3500);
    } catch (e) {
      console.error(e);
    }
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

  private _getStickyBucketAssignments(
    expHashAttribute: string,
    expFallbackAttribute?: string
  ): StickyAssignments {
    if (!this._ctx.stickyBucketAssignmentDocs) return {};
    const { hashAttribute, hashValue } = this._getHashAttribute(
      expHashAttribute
    );
    const hashKey = `${hashAttribute}||${toString(hashValue)}`;

    const {
      hashAttribute: fallbackAttribute,
      hashValue: fallbackValue,
    } = this._getHashAttribute(expFallbackAttribute);
    const fallbackKey = fallbackValue
      ? `${fallbackAttribute}||${toString(fallbackValue)}`
      : null;

    const assignments: StickyAssignments = {};
    if (fallbackKey && this._ctx.stickyBucketAssignmentDocs[fallbackKey]) {
      Object.assign(
        assignments,
        this._ctx.stickyBucketAssignmentDocs[fallbackKey].assignments || {}
      );
    }
    if (this._ctx.stickyBucketAssignmentDocs[hashKey]) {
      Object.assign(
        assignments,
        this._ctx.stickyBucketAssignmentDocs[hashKey].assignments || {}
      );
    }
    return assignments;
  }

  private _getStickyBucketVariation({
    expKey,
    expBucketVersion,
    expHashAttribute,
    expFallbackAttribute,
    expMinBucketVersion,
    expMeta,
  }: {
    expKey: string;
    expBucketVersion?: number;
    expHashAttribute?: string;
    expFallbackAttribute?: string;
    expMinBucketVersion?: number;
    expMeta?: VariationMeta[];
  }): {
    variation: number;
    versionIsBlocked?: boolean;
  } {
    expBucketVersion = expBucketVersion || 0;
    expMinBucketVersion = expMinBucketVersion || 0;
    expHashAttribute = expHashAttribute || "id";
    expMeta = expMeta || [];
    const id = this._getStickyBucketExperimentKey(expKey, expBucketVersion);
    const assignments = this._getStickyBucketAssignments(
      expHashAttribute,
      expFallbackAttribute
    );

    // users with any blocked bucket version (0 to minExperimentBucketVersion) are excluded from the test
    if (expMinBucketVersion > 0) {
      for (let i = 0; i <= expMinBucketVersion; i++) {
        const blockedKey = this._getStickyBucketExperimentKey(expKey, i);
        if (assignments[blockedKey] !== undefined) {
          return {
            variation: -1,
            versionIsBlocked: true,
          };
        }
      }
    }
    const variationKey = assignments[id];
    if (variationKey === undefined)
      // no assignment found
      return { variation: -1 };
    const variation = expMeta.findIndex((m) => m.key === variationKey);
    if (variation < 0)
      // invalid assignment, treat as "no assignment found"
      return { variation: -1 };

    return { variation };
  }

  private _getStickyBucketExperimentKey(
    experimentKey: string,
    experimentBucketVersion?: number
  ): StickyExperimentKey {
    experimentBucketVersion = experimentBucketVersion || 0;
    return `${experimentKey}__${experimentBucketVersion}`;
  }

  private _getStickyBucketAttributes(
    data?: FeatureApiResponse
  ): Record<string, string> {
    const attributes: Record<string, string> = {};
    this._ctx.stickyBucketIdentifierAttributes = !this._ctx
      .stickyBucketIdentifierAttributes
      ? this._deriveStickyBucketIdentifierAttributes(data)
      : this._ctx.stickyBucketIdentifierAttributes;
    this._ctx.stickyBucketIdentifierAttributes.forEach((attr) => {
      const { hashValue } = this._getHashAttribute(attr);
      attributes[attr] = toString(hashValue);
    });
    return attributes;
  }

  private _generateStickyBucketAssignmentDoc(
    attributeName: string,
    attributeValue: string,
    assignments: StickyAssignments
  ): {
    key: StickyAttributeKey;
    doc: StickyAssignmentsDocument;
    changed: boolean;
  } {
    const key = `${attributeName}||${attributeValue}`;
    const existingAssignments =
      this._ctx.stickyBucketAssignmentDocs &&
      this._ctx.stickyBucketAssignmentDocs[key]
        ? this._ctx.stickyBucketAssignmentDocs[key].assignments || {}
        : {};
    const newAssignments = { ...existingAssignments, ...assignments };
    const changed =
      JSON.stringify(existingAssignments) !== JSON.stringify(newAssignments);

    return {
      key,
      doc: {
        attributeName,
        attributeValue,
        assignments: newAssignments,
      },
      changed,
    };
  }
}
