import type {
  Context,
  Experiment,
  FeatureResult,
  Result,
  SubscriptionFunction,
  FeatureDefinition,
  FeatureResultSource,
  Attributes,
} from "./types/";
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
import { evalCondition } from "./mongrule";

export type {
  Context,
  Experiment,
  Result,
  FeatureDefinition,
  FeatureRule,
  Attributes,
  FeatureResult,
  ExperimentOverride,
} from "./types/";

export type { ConditionInterface } from "./types/mongrule";

const isBrowser = typeof window !== "undefined";

class GrowthBook {
  private context: Context;
  private _renderer: null | (() => void) = null;
  private _trackedExperiments = new Set();
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
  // eslint-disable-next-line
  private _forcedFeatureValues = new Map<string, any>();
  private _attributeOverrides: Attributes = {};

  constructor(context: Context = {}) {
    this.context = context;

    if (isBrowser && !context.disableDevTools) {
      window._growthbook = this;
      document.dispatchEvent(new Event("gbloaded"));
    }
  }

  private render() {
    if (this._renderer) {
      this._renderer();
    }
  }

  public setFeatures(features: Record<string, FeatureDefinition>) {
    this.context.features = features;
    this.render();
  }

  public setAttributes(attributes: Attributes) {
    this.context.attributes = attributes;
    this.render();
  }

  public setAttributeOverrides(overrides: Attributes) {
    this._attributeOverrides = overrides;
    this.render();
  }
  public setForcedVariations(vars: Record<string, number>) {
    this.context.forcedVariations = vars || {};
    this.render();
  }
  // eslint-disable-next-line
  public setForcedFeatures(map: Map<string, any>) {
    this._forcedFeatureValues = map;
    this.render();
  }

  public getAttributes() {
    return { ...this.context.attributes, ...this._attributeOverrides };
  }

  public getFeatures() {
    return this.context.features || {};
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
    this.context.forcedVariations = this.context.forcedVariations || {};
    this.context.forcedVariations[key] = variation;
    this.render();
  }

  public run<T>(experiment: Experiment<T>): Result<T> {
    const result = this._run(experiment);

    const key = experiment.key;

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
    value: T,
    source: FeatureResultSource,
    experiment: Experiment<T> | null = null
  ): FeatureResult<T> {
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
  public feature<T = any>(id: string): FeatureResult<T | null> {
    // Global override
    if (this._forcedFeatureValues.has(id)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Global override", {
          id,
          value: this._forcedFeatureValues.get(id),
        });
      return this.getFeatureResult(
        this._forcedFeatureValues.get(id),
        "override"
      );
    }

    // Unknown feature id
    if (!this.context.features || !this.context.features[id]) {
      process.env.NODE_ENV !== "production" && this.log("Unknown id", { id });
      return this.getFeatureResult(null, "unknownFeature");
    }

    // Get the feature
    const feature: FeatureDefinition<T> = this.context.features[id];

    // Loop through the rules
    if (feature.rules) {
      for (const rule of feature.rules) {
        // If it's a conditional rule, skip if the condition doesn't pass
        if (rule.condition && !this.conditionPasses(rule.condition)) {
          process.env.NODE_ENV !== "production" &&
            this.log("Skip rule because of condition", {
              id,
              rule,
            });
          continue;
        }
        // Feature value is being forced
        if (rule.force) {
          // Skip if coverage is reduced and user not included
          if ("coverage" in rule) {
            const { hashValue } = this.getHashAttribute(rule.hashAttribute);
            if (!hashValue) {
              process.env.NODE_ENV !== "production" &&
                this.log("Skip rule because of missing hashAttribute", {
                  id,
                  rule,
                });
              continue;
            }
            const n = (hashFnv32a(hashValue + id) % 1000) / 1000;
            if (n > (rule.coverage as number)) {
              process.env.NODE_ENV !== "production" &&
                this.log("Skip rule because of coverage", {
                  id,
                  rule,
                });
              continue;
            }
          }

          process.env.NODE_ENV !== "production" &&
            this.log("Force value from rule", {
              id,
              rule,
            });

          return this.getFeatureResult(rule.force, "force");
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
        const exp: Experiment<T> = {
          variations: rule.variations as [T, T, ...T[]],
          key: rule.key || id,
        };
        if ("coverage" in rule) exp.coverage = rule.coverage;
        if (rule.weights) exp.weights = rule.weights;
        if (rule.hashAttribute) exp.hashAttribute = rule.hashAttribute;
        if (rule.namespace) exp.namespace = rule.namespace;

        // Only return a value if the user is part of the experiment
        const res = this.run(exp);
        if (res.inExperiment) {
          return this.getFeatureResult(res.value, "experiment", exp);
        }
      }
    }

    process.env.NODE_ENV !== "production" &&
      this.log("Use default value", {
        id,
        value: feature.defaultValue ?? null,
      });

    // Fall back to using the default value
    return this.getFeatureResult(feature.defaultValue ?? null, "defaultValue");
  }

  private conditionPasses(condition: ConditionInterface): boolean {
    return evalCondition(this.getAttributes(), condition);
  }

  private _run<T>(experiment: Experiment<T>): Result<T> {
    const key = experiment.key;

    // 1. If experiment is invalid, return immediately
    if (experiment.variations.length < 2) {
      process.env.NODE_ENV !== "production" &&
        this.log("Invalid experiment", { id: key });
      return this.getResult(experiment);
    }

    // 2. If the context is disabled, return immediately
    if (this.context.enabled === false) {
      process.env.NODE_ENV !== "production" &&
        this.log("Context disabled", { id: key });
      return this.getResult(experiment);
    }

    // 3. Merge in experiment overrides from the context
    experiment = this.mergeOverrides(experiment);

    // 4. If a variation is forced from a querystring, return the forced variation
    const qsOverride = getQueryStringOverride(key, this.getContextUrl());
    if (qsOverride !== null) {
      process.env.NODE_ENV !== "production" &&
        this.log("Force via querystring", {
          id: key,
          variation: qsOverride,
        });
      return this.getResult(experiment, qsOverride);
    }

    // 5. If a variation is forced in the context, return the forced variation
    if (this.context.forcedVariations && key in this.context.forcedVariations) {
      const variation = this.context.forcedVariations[key];
      process.env.NODE_ENV !== "production" &&
        this.log("Force via dev tools", {
          id: key,
          variation,
        });
      return this.getResult(experiment, variation);
    }

    // 6. Exclude if a draft experiment or not active
    if (experiment.status === "draft" || experiment.active === false) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because inactive", {
          id: key,
        });
      return this.getResult(experiment);
    }

    // 7. Get the hash attribute and return if empty
    const { hashValue } = this.getHashAttribute(experiment.hashAttribute);
    if (!hashValue) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because missing hashAttribute", {
          id: key,
        });
      return this.getResult(experiment);
    }

    // 8. Exclude if user not in experiment.namespace
    if (experiment.namespace && !inNamespace(hashValue, experiment.namespace)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because of namespace", {
          id: key,
        });
      return this.getResult(experiment);
    }

    // 9. Exclude if experiment.include returns false or throws
    if (experiment.include && !isIncluded(experiment.include)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because of include function", {
          id: key,
        });
      return this.getResult(experiment);
    }

    // 10. Exclude if condition is false
    if (experiment.condition && !this.conditionPasses(experiment.condition)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because of condition", {
          id: key,
        });
      return this.getResult(experiment);
    }

    // 11. Exclude if user is not in a required group
    if (
      experiment.groups &&
      !this.hasGroupOverlap(experiment.groups as string[])
    ) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because of groups", {
          id: key,
        });
      return this.getResult(experiment);
    }

    // 12. Exclude if not on a targeted url
    if (experiment.url && !this.urlIsValid(experiment.url as RegExp)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because of url", {
          id: key,
        });
      return this.getResult(experiment);
    }

    // 13. Get bucket ranges
    const ranges = getBucketRanges(
      experiment.variations.length,
      experiment.coverage || 1,
      experiment.weights
    );

    // 14. Compute hash
    const n = (hashFnv32a(hashValue + key) % 1000) / 1000;

    // 15. Assign a variation
    const assigned = chooseVariation(n, ranges);

    // 16. Return if not in experiment
    if (assigned < 0) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because of coverage", {
          id: key,
        });
      return this.getResult(experiment);
    }

    // 17. Experiment has a forced variation
    if ("force" in experiment) {
      process.env.NODE_ENV !== "production" &&
        this.log("Force variation", {
          id: key,
          variation: experiment.force,
        });
      return this.getResult(experiment, experiment.force);
    }

    // 18. Exclude if in QA mode
    if (this.context.qaMode) {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because QA mode", {
          id: key,
        });
      return this.getResult(experiment);
    }

    // 19. Exclude if experiment is stopped
    if (experiment.status === "stopped") {
      process.env.NODE_ENV !== "production" &&
        this.log("Skip because stopped", {
          id: key,
        });
      return this.getResult(experiment);
    }

    // 20. Fire the tracking callback
    const result = this.getResult(experiment, assigned, true);
    this.track(experiment, result);

    // 21. Return the result

    process.env.NODE_ENV !== "production" &&
      this.log("In experiment", {
        id: key,
        variation: result.variationId,
      });
    return result;
  }

  // eslint-disable-next-line
  private log(msg: string, ctx: Record<string, any>) {
    if (!this.debug) return;
    if (this.context.log) this.context.log(msg, ctx);
    else console.log(msg, ctx);
  }

  private track<T>(experiment: Experiment<T>, result: Result<T>) {
    if (!this.context.trackingCallback) return;

    const key = experiment.key;

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
    const key = experiment.key;
    const o = this.context.overrides;
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

  private getHashAttribute(attr?: string) {
    const hashAttribute = attr || "id";

    let hashValue = "";
    if (this._attributeOverrides[hashAttribute]) {
      hashValue = this._attributeOverrides[hashAttribute];
    } else if (this.context.attributes) {
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

    const { hashAttribute, hashValue } = this.getHashAttribute(
      experiment.hashAttribute
    );

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
