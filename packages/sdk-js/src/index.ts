import { Context, Experiment, Result, SubscriptionFunction } from "./types";
import {
  getUrlRegExp,
  isIncluded,
  getBucketRanges,
  hashFnv32a,
  chooseVariation,
  getQueryStringOverride,
} from "./util";

const EVENT_NAME = "GBDEV_LOADED";

export type { Context, Experiment, Result, ExperimentOverride } from "./types";

const isBrowser = typeof window !== "undefined";

class GrowthBook {
  context: Context;

  private devcb: null | (() => void) = null;
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

  constructor(context: Context) {
    this.context = context || {};

    if (!this.context.disableDevMode && isBrowser) {
      this.devcb = () => this.onDevLoaded();
      document.body.addEventListener(EVENT_NAME, this.devcb, false);
      this.onDevLoaded();
    }
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

    if (isBrowser && this.devcb) {
      document.body.removeEventListener(EVENT_NAME, this.devcb, false);
    }
  }

  private onDevLoaded() {
    if (!isBrowser) return;
    if (window.growthbookDev && window.growthbookDev.init) {
      window.growthbookDev.init(this);
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

    // If assigned variation has changed, fire subscriptions
    const prev = this.assigned.get(experiment.key);
    // TODO: what if the experiment definition has changed?
    if (
      !prev ||
      prev.result.inExperiment !== result.inExperiment ||
      prev.result.variationId !== result.variationId
    ) {
      this.assigned.set(experiment.key, { experiment, result });
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

  private _run<T>(experiment: Experiment<T>): Result<T> {
    process.env.NODE_ENV !== "production" &&
      this.log("runExperiment", experiment.key);

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
    const qsOverride = getQueryStringOverride(
      experiment.key,
      this.getContextUrl()
    );
    if (qsOverride !== null) {
      process.env.NODE_ENV !== "production" &&
        this.log("Forced via querystring");
      return this.getResult(experiment, qsOverride);
    }

    // 5. If a variation is forced in the context, return the forced variation
    if (
      this.context.forcedVariations &&
      experiment.key in this.context.forcedVariations
    ) {
      process.env.NODE_ENV !== "production" &&
        this.log("Forced via context.forcedVariations");
      return this.getResult(
        experiment,
        this.context.forcedVariations[experiment.key]
      );
    }

    // 6. Exclude if a draft experiment
    if (experiment.status === "draft") {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because of draft status");
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

    // 8. Exclude if experiment.include returns false or throws
    if (experiment.include && !isIncluded(experiment.include)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because experiment.include did not return true");
      return this.getResult(experiment);
    }

    // 9. Exclude if user is not in a required group
    if (experiment.groups && !this.hasGroupOverlap(experiment.groups)) {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because user not in required group");
      return this.getResult(experiment);
    }

    // 10. Exclude if not on a targeted url
    if (experiment.url && !this.urlIsValid(experiment.url)) {
      process.env.NODE_ENV !== "production" &&
        this.log(
          "Exclude because context url does not match experiment.url regex"
        );
      return this.getResult(experiment);
    }

    // 11. Experiment has a forced variation
    if ("force" in experiment) {
      process.env.NODE_ENV !== "production" &&
        this.log("Forced via experiment");
      return this.getResult(experiment, experiment.force);
    }

    // 12. Exclude if experiment is stopped
    if (experiment.status === "stopped") {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because status is 'stopped'");
      return this.getResult(experiment);
    }

    // 13. Exclude if in QA mode
    if (this.context.qaMode) {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because context is in QA mode");
      return this.getResult(experiment);
    }

    // 14. Compute a hash
    const n = (hashFnv32a(hashValue + experiment.key) % 1000) / 1000;

    // 15. Get bucket ranges
    const ranges = getBucketRanges(
      experiment.variations.length,
      experiment.coverage || 1,
      experiment.weights
    );

    // 16. Assign a variation
    const assigned = chooseVariation(n, ranges);

    // 17. Return if not in experiment
    if (assigned < 0) {
      process.env.NODE_ENV !== "production" &&
        this.log("Exclude because of coverage");
      return this.getResult(experiment);
    }

    // 18. Fire the tracking callback
    const result = this.getResult(experiment, assigned, true);
    this.track(experiment, result);

    // 19. Return the result
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

    // Make sure a tracking callback is only fired once per unique experiment
    const k =
      result.hashAttribute +
      result.hashValue +
      experiment.key +
      result.variationId;
    if (this._trackedExperiments.has(k)) return;
    this._trackedExperiments.add(k);

    try {
      this.context.trackingCallback(experiment, result);
    } catch (e) {
      console.error(e);
    }
  }

  private mergeOverrides<T>(experiment: Experiment<T>): Experiment<T> {
    const o = this.context.overrides;
    if (o && o[experiment.key]) {
      experiment = Object.assign({}, experiment, o[experiment.key]);
      if (typeof experiment.url === "string") {
        experiment.url = getUrlRegExp(experiment.url);
      }
    }

    return experiment;
  }

  private getHashAttribute<T>(experiment: Experiment<T>) {
    const hashAttribute = experiment.hashAttribute || "id";
    const hashValue =
      (this.context.user && this.context.user[hashAttribute]) || "";
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
