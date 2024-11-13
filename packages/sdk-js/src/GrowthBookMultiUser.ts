import type {
  ApiHost,
  ClientKey,
  Experiment,
  FeatureApiResponse,
  FeatureResult,
  RefreshFeaturesOptions,
  Result,
  WidenPrimitives,
  EvalContext,
  InitOptions,
  InitResponse,
  InitSyncOptions,
  GlobalContext,
  UserContext,
  MultiUserOptions,
  FeatureDefinitions,
  AutoExperiment,
  TrackingDataWithUser,
  TrackingCallbackWithUser,
} from "./types/growthbook";
import { loadSDKVersion } from "./util";
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
  getAllStickyBucketAssignmentDocs,
  decryptPayload,
} from "./core";
import { StickyBucketService } from "./sticky-bucket-service";

const SDK_VERSION = loadSDKVersion();

export class GrowthBookMultiUser<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AppFeatures extends Record<string, any> = Record<string, any>
> {
  public debug: boolean;
  public ready: boolean;
  public version: string;

  // Properties and methods that start with "_" are mangled by Terser (saves ~150 bytes)
  private _options: MultiUserOptions;
  private _trackedExperiments: Set<string>;
  private _deferredTrackingCalls: Map<string, TrackingDataWithUser>;

  private _features: FeatureDefinitions;
  private _experiments: AutoExperiment[];
  private _payload: FeatureApiResponse | undefined;
  private _decryptedPayload: FeatureApiResponse | undefined;

  constructor(options?: MultiUserOptions) {
    options = options || {};
    // These properties are all initialized in the constructor instead of above
    // This saves ~80 bytes in the final output
    this.version = SDK_VERSION;
    this._options = options;
    this._trackedExperiments = new Set();
    this.debug = !!options.debug;
    this.ready = false;
    this._features = {};
    this._experiments = [];
    this._deferredTrackingCalls = new Map();

    this.log = this.log.bind(this);
    this._track = this._track.bind(this);
    this._trackFeatureUsage = this._trackFeatureUsage.bind(this);
  }

  public async setPayload(payload: FeatureApiResponse): Promise<void> {
    this._payload = payload;
    const data = await decryptPayload(payload, this._options.decryptionKey);
    this._decryptedPayload = data;
    if (data.features) {
      this._features = data.features;
    }
    if (data.experiments) {
      this._experiments = data.experiments;
    }
    if (data.savedGroups) {
      this._options.savedGroups = data.savedGroups;
    }
    this.ready = true;
  }

  public initSync(options: InitSyncOptions): GrowthBookMultiUser<AppFeatures> {
    const payload = options.payload;

    if (payload.encryptedExperiments || payload.encryptedFeatures) {
      throw new Error("initSync does not support encrypted payloads");
    }

    this._payload = payload;
    this._decryptedPayload = payload;
    if (payload.features) {
      this._features = payload.features;
    }
    if (payload.experiments) {
      this._experiments = payload.experiments;
    }

    this.ready = true;

    if (options.streaming) {
      if (!this._options.clientKey) {
        throw new Error("Must specify clientKey to enable streaming");
      }
      startAutoRefresh(this, true);
      subscribe(this);
    }

    return this;
  }

  public async init(options?: InitOptions): Promise<InitResponse> {
    options = options || {};

    if (options.cacheSettings) {
      configureCache(options.cacheSettings);
    }

    if (options.payload) {
      await this.setPayload(options.payload);
      if (options.streaming) {
        if (!this._options.clientKey) {
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
    const defaultHost = this._options.apiHost || "https://cdn.growthbook.io";
    return {
      apiHost: defaultHost.replace(/\/*$/, ""),
      streamingHost: (this._options.streamingHost || defaultHost).replace(
        /\/*$/,
        ""
      ),
      apiRequestHeaders: this._options.apiHostRequestHeaders,
      streamingHostRequestHeaders: this._options.streamingHostRequestHeaders,
    };
  }
  public getClientKey(): string {
    return this._options.clientKey || "";
  }
  public getPayload(): FeatureApiResponse {
    return (
      this._payload || {
        features: this.getFeatures(),
        experiments: this._experiments || [],
      }
    );
  }
  public getDecryptedPayload(): FeatureApiResponse {
    return this._decryptedPayload || this.getPayload();
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
      backgroundSync: streaming ?? true,
    });
  }

  public getFeatures() {
    return this._features || {};
  }

  public destroy() {
    unsubscribe(this);

    // Release references to save memory
    this._deferredTrackingCalls.clear();
    this._trackedExperiments.clear();
    this._features = {};
    this._experiments = [];
    this._decryptedPayload = undefined;
    this._payload = undefined;
    this._options = {};
  }

  public runInlineExperiment<T>(
    experiment: Experiment<T>,
    userContext: UserContext
  ): Result<T> {
    const { result } = runExperiment(
      experiment,
      null,
      this._getEvalContext(userContext)
    );
    return result;
  }

  private _getEvalContext(userContext: UserContext): EvalContext {
    return {
      user: userContext,
      global: this._getGlobalContext(),
      stack: {
        evaluatedFeatures: new Set(),
      },
    };
  }

  private _getGlobalContext(): GlobalContext {
    return {
      features: this._features,
      experiments: this._experiments,
      log: this.log,
      enabled: this._options.enabled,
      qaMode: this._options.qaMode,
      savedGroups: this._options.savedGroups,
      stickyBucketIdentifierAttributes: this._options
        .stickyBucketIdentifierAttributes,
      onExperimentView: this._track,
      onFeatureUsage: this._trackFeatureUsage,
    };
  }

  private _trackFeatureUsage(
    key: string,
    res: FeatureResult,
    user: UserContext
  ): void {
    // Don't track feature usage that was forced via an override
    if (res.source === "override") return;

    // Fire user-supplied callback
    if (this._options.onFeatureUsage) {
      try {
        this._options.onFeatureUsage(key, res, user);
      } catch (e) {
        // Ignore feature usage callback errors
      }
    }
  }

  public isOn<K extends string & keyof AppFeatures = string>(
    key: K,
    userContext: UserContext
  ): boolean {
    return this.evalFeature(key, userContext).on;
  }

  public isOff<K extends string & keyof AppFeatures = string>(
    key: K,
    userContext: UserContext
  ): boolean {
    return this.evalFeature(key, userContext).off;
  }

  public getFeatureValue<
    V extends AppFeatures[K],
    K extends string & keyof AppFeatures = string
  >(key: K, defaultValue: V, userContext: UserContext): WidenPrimitives<V> {
    const value = this.evalFeature<WidenPrimitives<V>, K>(key, userContext)
      .value;
    return value === null ? (defaultValue as WidenPrimitives<V>) : value;
  }

  public evalFeature<
    V extends AppFeatures[K],
    K extends string & keyof AppFeatures = string
  >(id: K, userContext: UserContext): FeatureResult<V | null> {
    return _evalFeature(id, this._getEvalContext(userContext));
  }

  log(msg: string, ctx: Record<string, unknown>) {
    if (!this.debug) return;
    if (this._options.log) this._options.log(msg, ctx);
    else console.log(msg, ctx);
  }

  public getDeferredTrackingCalls(): TrackingDataWithUser[] {
    return Array.from(this._deferredTrackingCalls.values());
  }

  public setDeferredTrackingCalls(calls: TrackingDataWithUser[]) {
    this._deferredTrackingCalls = new Map(
      calls
        .filter((c) => c && c.experiment && c.result)
        .map((c) => {
          return [this._getTrackKey(c.experiment, c.result), c];
        })
    );
  }

  public async fireDeferredTrackingCalls() {
    if (!this._options.trackingCallback) return;

    const promises: ReturnType<TrackingCallbackWithUser>[] = [];
    this._deferredTrackingCalls.forEach((call: TrackingDataWithUser) => {
      if (!call || !call.experiment || !call.result) {
        console.error("Invalid deferred tracking call", { call: call });
      } else {
        promises.push(this._track(call.experiment, call.result, call.user));
      }
    });
    this._deferredTrackingCalls.clear();
    await Promise.all(promises);
  }

  public setTrackingCallback(callback: TrackingCallbackWithUser) {
    this._options.trackingCallback = callback;
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

  private async _track<T>(
    experiment: Experiment<T>,
    result: Result<T>,
    user: UserContext
  ) {
    const k = this._getTrackKey(experiment, result);

    if (!this._options.trackingCallback) {
      // Add to deferred tracking if it hasn't already been added
      if (!this._deferredTrackingCalls.has(k)) {
        this._deferredTrackingCalls.set(k, { experiment, result, user });
      }
      return;
    }

    // Make sure a tracking callback is only fired once per unique experiment
    if (this._trackedExperiments.has(k)) return;
    this._trackedExperiments.add(k);

    try {
      await this._options.trackingCallback(experiment, result, user);
    } catch (e) {
      console.error(e);
    }
  }

  public async applyStickyBuckets(
    partialContext: Omit<
      UserContext,
      "stickyBucketService" | "stickyBucketAssignmentDocs"
    >,
    stickyBucketService: StickyBucketService
  ): Promise<UserContext> {
    const ctx = this._getEvalContext(partialContext);

    const stickyBucketAssignmentDocs = await getAllStickyBucketAssignmentDocs(
      ctx,
      stickyBucketService
    );

    const userContext: UserContext = {
      ...partialContext,
      stickyBucketAssignmentDocs,
      saveStickyBucketAssignmentDoc: (doc) =>
        stickyBucketService.saveAssignments(doc),
    };

    return userContext;
  }
}
