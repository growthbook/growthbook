import type {
  Context,
  Experiment,
  FeatureResult,
  Result,
  SubscriptionFunction,
  FeatureDefinition,
  FeatureResultSource,
  NewExperiment,
  LegacyExperiment,
} from "./types";
import type { ConditionInterface } from "./types/mongrule";
import {
  getUrlRegExp,
  isIncluded,
  getBucketRanges,
  hashFnv32a,
  chooseVariation,
  getQueryStringOverride,
  inNamespace,
} from "./util";
import { Condition } from "./mongrule";

export type {
  Context,
  Experiment,
  Result,
  FeatureResult,
  ExperimentOverride,
} from "./types";

export type { ConditionInterface } from "./types/mongrule";

const isBrowser = typeof window !== "undefined";

class GrowthBook {
  private context: Context;
  private features: Record<string, FeatureDefinition> = {};
  private _renderer: null | (() => void) = null;
  private _trackedExperiments = new Set();
  private _isReady = false;
  private _readyQueue: (() => void)[] = [];
  public debug = false;
  private subscriptions = new Set<SubscriptionFunction>();
  private assigned = new Map<
    string,
    {
      // eslint-disable-next-line
      experiment: Experiment<any>;
      // eslint-disable-next-line
      result: Result<any>;
    }
  >();

  constructor(context: Context = {}) {
    this.context = context;

    const features = context.features;

    if (
      features &&
      typeof features === "object" &&
      typeof features.then === "function"
    ) {
      features.then((res) => {
        if (res) {
          this.features = res;
        }
        this._isReady = true;
        this._readyQueue.forEach((cb) => cb());
      });
    } else if (features) {
      this.features = features as Record<string, FeatureDefinition>;
      this._isReady = true;
    } else {
      this._isReady = true;
    }

    if (isBrowser) {
      window._growthbook = this;
    }
  }

  public ready(cb?: () => void): Promise<void> {
    if (this._isReady) {
      cb && cb();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this._readyQueue.push(() => {
        cb && cb();
        resolve();
      });
    });
  }

  public subscribe(cb: SubscriptionFunction): () => void {
    this.subscriptions.add(cb);

    return () => {
      this.subscriptions.delete(cb);
    };
  }

  public getAllResults() {
    return new Map(this.assigned);
  }

  public destroy() {
    // Release references to save memory
    this.subscriptions.clear();
    this.assigned.clear();
    this._trackedExperiments.clear();

    if (isBrowser && window._growthbook === this) {
      delete window._growthbook;
    }
  }

  public setRenderer(renderer: () => void) {
    this._renderer = renderer;
  }

  public forceVariation(key: string, variation: number) {
    if (!this.context) return;

    this.context.forcedVariations = this.context.forcedVariations || {};
    this.context.forcedVariations[key] = variation;

    if (this._renderer) {
      this._renderer();
    }
  }

  public run<T>(experiment: Experiment<T>): Result<T> {
    const result = this._run(experiment);

    const key = this.getExperimentKey(experiment);

    // If assigned variation has changed, fire subscriptions
    const prev = this.assigned.get(key);
    // TODO: what if the experiment definition has changed?
    if (
      !prev ||
      prev.result.inExperiment !== result.inExperiment ||
      prev.result.variationId !== result.variationId
    ) {
      this.assigned.set(key, { experiment, result });
      this.subscriptions.forEach((cb) => {
        try {
          cb(experiment, result);
        } catch (e) {
          console.error(e);
        }
      });
    }

    return result;
  }

  private getFeatureResult<T>(
    values: T[],
    source: FeatureResultSource,
    index = 0,
    experiment: Experiment<T> | null = null
  ): FeatureResult {
    const value = values[index >= 0 && index < values.length ? index : 0];

    const ret: FeatureResult = {
      value,
      on: !!value,
      off: !value,
      source,
    };
    if (experiment) ret.experiment = experiment;
    return ret;
  }

  // eslint-disable-next-line
  public feature<T = any>(id: string): FeatureResult<T> {
    // Unknown feature id
    if (!this.features[id]) {
      return this.getFeatureResult([null], "unknownFeature");
    }

    // Get the feature and array of values
    const feature: FeatureDefinition<T> = this.features[id];
    const values = feature.values || [false, true];

    // Loop through the rules
    if (feature.rules) {
      for (const rule of feature.rules) {
        // If it's a conditional rule, skip if the condition doesn't pass
        if (rule.condition && !this.conditionPasses(rule.condition)) {
          continue;
        }
        // For force rules, return the forced value immediately
        if (rule.type === "force") {
          return this.getFeatureResult(values as T[], "force", rule.value);
        }
        // For experiment rules, run an experiment
        if (rule.type === "experiment") {
          const variations = rule.variations
            ? rule.variations.map((i) => values[i])
            : values;
          const exp: Experiment<T> = {
            variations: variations as [T, T, ...T[]],
            trackingKey: rule.trackingKey || id,
          };
          if (rule.coverage) exp.coverage = rule.coverage;
          if (rule.weights) exp.weights = rule.weights;
          if (rule.hashAttribute) exp.hashAttribute = rule.hashAttribute;
          if (rule.namespace) exp.namespace = rule.namespace;

          // Only return a value if the user is part of the experiment
          const res = this.run(exp);
          if (res.inExperiment) {
            return this.getFeatureResult(
              exp.variations,
              "experiment",
              res.variationId,
              exp
            );
          }
        }
      }
    }

    // Fall back to using the default value
    return this.getFeatureResult(
      values as T[],
      "defaultValue",
      feature.defaultValue || 0
    );
  }

  private getExperimentKey<T>(experiment: Experiment<T>): string {
    return (
      (experiment as NewExperiment<T>).trackingKey ||
      (experiment as LegacyExperiment<T>).key ||
      ""
    );
  }

  private conditionPasses(condition: ConditionInterface): boolean {
    const cond = new Condition(condition);
    return cond.test(this.context.attributes || {});
  }

  private _run<T>(experiment: Experiment<T>): Result<T> {
    const key = this.getExperimentKey(experiment);

    process.env.NODE_ENV !== "production" && this.log("runExperiment", key);

    // 1. If experiment is invalid, return immediately
    if (experiment.variations.length < 2) {
      process.env.NODE_ENV !== "production" &&
        this.log("Experiment is invalid");
      return this.getResult(experiment);
    }

    // 2. If the context is disabled, return immediately
    if (this.context.enabled === false) {
      process.env.NODE_ENV !== "production" && this.log("Context Disabled");
      return this.getResult(experiment);
    }

    // 3. Merge in experiment overrides from the context
    experiment = this.mergeOverrides(experiment);

    // 4. If a variation is forced from a querystring, return the forced variation
    const qsOverride = getQueryStringOverride(key, this.getContextUrl());
    if (qsOverride !== null) {
      process.env.NODE_ENV !== "production" &&
        this.log("Forced via querystring");
      return this.getResult(experiment, qsOverride);
    }

    // 5. If a variation is forced in the context, return the forced variation
    if (this.context.forcedVariations && key in this.context.forcedVariations) {
      process.env.NODE_ENV !== "production" &&
        this.log("Forced via context.forcedVariations");
      return this.getResult(experiment, this.context.forcedVariations[key]);
    }

    // 6. Exclude if a draft experiment or not active
    if (
      (experiment as LegacyExperiment<T>).status === "draft" ||
      (experiment as NewExperiment<T>).active === false
    ) {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because of draft status or not active");
      return this.getResult(experiment);
    }

    // 7. Get the hash attribute and return if empty
    const { hashAttribute, hashValue } = this.getHashAttribute(experiment);
    if (!hashValue) {
      process.env.NODE_ENV !== "production" &&
        this.log(
          "Exclude because of missing hashAttribute in context",
          hashAttribute
        );
      return this.getResult(experiment);
    }

    // 8. Exclude if user not in experiment.namespace
    if (experiment.namespace && !inNamespace(hashValue, experiment.namespace)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because hashValue not in experiment.namespace range");
      return this.getResult(experiment);
    }

    // 9. Exclude if experiment.include returns false or throws
    if (experiment.include && !isIncluded(experiment.include)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because experiment.include did not return true");
      return this.getResult(experiment);
    }

    // 9a. Exclude if condition is false
    if (
      (experiment as NewExperiment<T>).condition &&
      !this.conditionPasses((experiment as NewExperiment<T>).condition)
    ) {
      process.env.NODE_ENV !== "production" &&
        this.log(
          "Exclude because experiment.condition did not evaluate to true"
        );
      return this.getResult(experiment);
    }

    // 10. Exclude if user is not in a required group
    if (
      (experiment as LegacyExperiment<T>).groups &&
      !this.hasGroupOverlap(
        (experiment as LegacyExperiment<T>).groups as string[]
      )
    ) {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because user not in required group");
      return this.getResult(experiment);
    }

    // 11. Exclude if not on a targeted url
    if (
      (experiment as LegacyExperiment<T>).url &&
      !this.urlIsValid((experiment as LegacyExperiment<T>).url as RegExp)
    ) {
      process.env.NODE_ENV !== "production" &&
        this.log(
          "Exclude because context url does not match experiment.url regex"
        );
      return this.getResult(experiment);
    }

    // 12. Experiment has a forced variation
    if ("force" in experiment) {
      process.env.NODE_ENV !== "production" &&
        this.log("Forced via experiment");
      return this.getResult(experiment, experiment.force);
    }

    // 13. Exclude if experiment is stopped
    if ((experiment as LegacyExperiment<T>).status === "stopped") {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because status is 'stopped'");
      return this.getResult(experiment);
    }

    // 14. Exclude if in QA mode
    if (this.context.qaMode) {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because context is in QA mode");
      return this.getResult(experiment);
    }

    // 15. Compute a hash
    const n = (hashFnv32a(hashValue + key) % 1000) / 1000;

    // 16. Get bucket ranges
    const ranges = getBucketRanges(
      experiment.variations.length,
      experiment.coverage || 1,
      experiment.weights
    );

    // 17. Assign a variation
    const assigned = chooseVariation(n, ranges);

    // 18. Return if not in experiment
    if (assigned < 0) {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because of coverage");
      return this.getResult(experiment);
    }

    // 19. Fire the tracking callback
    const result = this.getResult(experiment, assigned, true);
    this.track(experiment, result);

    // 20. Return the result
    process.env.NODE_ENV !== "production" &&
      this.log("Assigned variation", result.variationId);
    return result;
  }

  // eslint-disable-next-line
  private log(msg: string, ctx?: any) {
    this.debug && console.log(msg, ctx);
  }

  private track<T>(experiment: Experiment<T>, result: Result<T>) {
    if (!this.context.trackingCallback) return;

    const key = this.getExperimentKey(experiment);

    // Make sure a tracking callback is only fired once per unique experiment
    const k =
      result.hashAttribute + result.hashValue + key + result.variationId;
    if (this._trackedExperiments.has(k)) return;
    this._trackedExperiments.add(k);

    try {
      this.context.trackingCallback(experiment, result);
    } catch (e) {
      console.error(e);
    }
  }

  private mergeOverrides<T>(experiment: Experiment<T>): Experiment<T> {
    const key = this.getExperimentKey(experiment);
    const o = this.context.overrides;
    if (o && o[key]) {
      experiment = Object.assign({}, experiment, o[key]);
      if (typeof (experiment as LegacyExperiment<T>).url === "string") {
        (experiment as LegacyExperiment<T>).url = getUrlRegExp(
          // eslint-disable-next-line
          (experiment as LegacyExperiment<T>).url as any
        );
      }
    }

    return experiment;
  }

  private getHashAttribute<T>(experiment: Experiment<T>) {
    const hashAttribute = experiment.hashAttribute || "id";

    let hashValue = "";
    if (this.context.attributes) {
      hashValue = this.context.attributes[hashAttribute] || "";
    } else if (this.context.user) {
      hashValue = this.context.user[hashAttribute] || "";
    }

    return { hashAttribute, hashValue };
  }

  private getResult<T>(
    experiment: Experiment<T>,
    variationIndex: number = 0,
    inExperiment: boolean = false
  ): Result<T> {
    if (variationIndex < 0 || variationIndex >= experiment.variations.length) {
      variationIndex = 0;
    }

    const { hashAttribute, hashValue } = this.getHashAttribute(experiment);

    return {
      inExperiment,
      variationId: variationIndex,
      value: experiment.variations[variationIndex],
      hashAttribute,
      hashValue,
    };
  }

  private getContextUrl() {
    return this.context.url || (isBrowser ? window.location.href : "");
  }

  private urlIsValid(urlRegex: RegExp): boolean {
    const url = this.getContextUrl();
    if (!url) return false;

    const pathOnly = url.replace(/^https?:\/\//, "").replace(/^[^/]*\//, "/");

    if (urlRegex.test(url)) return true;
    if (urlRegex.test(pathOnly)) return true;
    return false;
  }

  private hasGroupOverlap(expGroups: string[]): boolean {
    const groups = this.context.groups || {};
    for (let i = 0; i < expGroups.length; i++) {
      if (groups[expGroups[i]]) return true;
    }
    return false;
  }
}

export { GrowthBook };
