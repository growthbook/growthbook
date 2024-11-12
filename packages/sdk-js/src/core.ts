import {
  FeatureEvalContext,
  FeatureDefinition,
  FeatureResult,
  Experiment,
  FeatureResultSource,
  Result,
  Filter,
  VariationRange,
  VariationMeta,
  StickyExperimentKey,
  StickyAssignments,
  StickyAttributeKey,
  StickyAssignmentsDocument,
} from "./types/growthbook";
import { evalCondition } from "./mongrule";
import { ConditionInterface } from "./types/mongrule";
import {
  chooseVariation,
  getBucketRanges,
  getQueryStringOverride,
  getUrlRegExp,
  hash,
  inNamespace,
  inRange,
  isIncluded,
  isURLTargeted,
  toString,
} from "./util";

export function evalFeature<V = unknown>(
  id: string,
  ctx: FeatureEvalContext
): FeatureResult<V | null> {
  if (ctx.evaluatedFeatures.has(id)) {
    process.env.NODE_ENV !== "production" &&
      ctx.log(`evalFeature: circular dependency detected: ${ctx.id} -> ${id}`, {
        from: ctx.id,
        to: id,
      });
    return getFeatureResult(ctx, id, null, "cyclicPrerequisite");
  }
  ctx.evaluatedFeatures.add(id);
  ctx.id = id;

  // Global override
  if (ctx.forcedFeatureValues.has(id)) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Global override", {
        id,
        value: ctx.forcedFeatureValues.get(id),
      });
    return getFeatureResult(
      ctx,
      id,
      ctx.forcedFeatureValues.get(id),
      "override"
    );
  }

  // Unknown feature id
  if (!ctx.features || !ctx.features[id]) {
    process.env.NODE_ENV !== "production" && ctx.log("Unknown feature", { id });
    return getFeatureResult(ctx, id, null, "unknownFeature");
  }

  // Get the feature
  const feature: FeatureDefinition<V> = ctx.features[id];

  // Loop through the rules
  if (feature.rules) {
    rules: for (const rule of feature.rules) {
      // If there are prerequisite flag(s), evaluate them
      if (rule.parentConditions) {
        for (const parentCondition of rule.parentConditions) {
          const parentResult = evalFeature(parentCondition.id, ctx);
          // break out for cyclic prerequisites
          if (parentResult.source === "cyclicPrerequisite") {
            return getFeatureResult(ctx, id, null, "cyclicPrerequisite");
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
                ctx.log("Feature blocked by prerequisite", { id, rule });
              return getFeatureResult(ctx, id, null, "prerequisite");
            }
            // non-blocking prerequisite eval failed: break out of parentConditions loop, jump to the next rule
            process.env.NODE_ENV !== "production" &&
              ctx.log("Skip rule because prerequisite evaluation fails", {
                id,
                rule,
              });
            continue rules;
          }
        }
      }

      // If there are filters for who is included (e.g. namespaces)
      if (rule.filters && isFilteredOut(rule.filters, ctx)) {
        process.env.NODE_ENV !== "production" &&
          ctx.log("Skip rule because of filters", {
            id,
            rule,
          });
        continue;
      }

      // Feature value is being forced
      if ("force" in rule) {
        // If it's a conditional rule, skip if the condition doesn't pass
        if (rule.condition && !conditionPasses(rule.condition, ctx)) {
          process.env.NODE_ENV !== "production" &&
            ctx.log("Skip rule because of condition ff", {
              id,
              rule,
            });
          continue;
        }

        // If this is a percentage rollout, skip if not included
        if (
          !isIncludedInRollout(
            ctx,
            rule.seed || id,
            rule.hashAttribute,
            ctx.stickyBucketService && !rule.disableStickyBucketing
              ? rule.fallbackAttribute
              : undefined,
            rule.range,
            rule.coverage,
            rule.hashVersion
          )
        ) {
          process.env.NODE_ENV !== "production" &&
            ctx.log("Skip rule because user not included in rollout", {
              id,
              rule,
            });
          continue;
        }

        process.env.NODE_ENV !== "production" &&
          ctx.log("Force value from rule", {
            id,
            rule,
          });

        // If this was a remotely evaluated experiment, fire the tracking callbacks
        if (rule.tracks) {
          rule.tracks.forEach((t) => {
            ctx.onExperimentView(t.experiment, t.result);
          });
        }

        return getFeatureResult(ctx, id, rule.force as V, "force", rule.id);
      }
      if (!rule.variations) {
        process.env.NODE_ENV !== "production" &&
          ctx.log("Skip invalid rule", {
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
      const { result } = runExperiment(exp, id, ctx);
      ctx.onExperimentEval(exp, result);
      if (result.inExperiment && !result.passthrough) {
        return getFeatureResult(
          ctx,
          id,
          result.value,
          "experiment",
          rule.id,
          exp,
          result
        );
      }
    }
  }

  process.env.NODE_ENV !== "production" &&
    ctx.log("Use default value", {
      id,
      value: feature.defaultValue,
    });

  // Fall back to using the default value
  return getFeatureResult(
    ctx,
    id,
    feature.defaultValue === undefined ? null : feature.defaultValue,
    "defaultValue"
  );
}

export function runExperiment<T>(
  experiment: Experiment<T>,
  featureId: string | null,
  ctx: FeatureEvalContext
): {
  result: Result<T>;
  trackingCall?: Promise<void>;
} {
  const key = experiment.key;
  const numVariations = experiment.variations.length;

  // 1. If experiment has less than 2 variations, return immediately
  if (numVariations < 2) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Invalid experiment", { id: key });
    return {
      result: getExperimentResult(ctx, experiment, -1, false, featureId),
    };
  }

  // 2. If the context is disabled, return immediately
  if (ctx.enabled === false) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Context disabled", { id: key });
    return {
      result: getExperimentResult(ctx, experiment, -1, false, featureId),
    };
  }

  // 2.5. Merge in experiment overrides from the context
  experiment = mergeOverrides(experiment, ctx);

  // 2.6 New, more powerful URL targeting
  if (
    experiment.urlPatterns &&
    !isURLTargeted(ctx.url, experiment.urlPatterns)
  ) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Skip because of url targeting", {
        id: key,
      });
    return {
      result: getExperimentResult(ctx, experiment, -1, false, featureId),
    };
  }

  // 3. If a variation is forced from a querystring, return the forced variation
  const qsOverride = getQueryStringOverride(key, ctx.url, numVariations);
  if (qsOverride !== null) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Force via querystring", {
        id: key,
        variation: qsOverride,
      });
    return {
      result: getExperimentResult(
        ctx,
        experiment,
        qsOverride,
        false,
        featureId
      ),
    };
  }

  // 4. If a variation is forced in the context, return the forced variation
  if (ctx.forcedVariations && key in ctx.forcedVariations) {
    const variation = ctx.forcedVariations[key];
    process.env.NODE_ENV !== "production" &&
      ctx.log("Force via dev tools", {
        id: key,
        variation,
      });
    return {
      result: getExperimentResult(ctx, experiment, variation, false, featureId),
    };
  }

  // 5. Exclude if a draft experiment or not active
  if (experiment.status === "draft" || experiment.active === false) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Skip because inactive", {
        id: key,
      });
    return {
      result: getExperimentResult(ctx, experiment, -1, false, featureId),
    };
  }

  // 6. Get the hash attribute and return if empty
  const { hashAttribute, hashValue } = getHashAttribute(
    ctx,
    experiment.hashAttribute,
    ctx.stickyBucketService && !experiment.disableStickyBucketing
      ? experiment.fallbackAttribute
      : undefined
  );
  if (!hashValue) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Skip because missing hashAttribute", {
        id: key,
      });
    return {
      result: getExperimentResult(ctx, experiment, -1, false, featureId),
    };
  }

  let assigned = -1;

  let foundStickyBucket = false;
  let stickyBucketVersionIsBlocked = false;
  if (ctx.stickyBucketService && !experiment.disableStickyBucketing) {
    const { variation, versionIsBlocked } = getStickyBucketVariation({
      ctx,
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
      if (isFilteredOut(experiment.filters, ctx)) {
        process.env.NODE_ENV !== "production" &&
          ctx.log("Skip because of filters", {
            id: key,
          });
        return {
          result: getExperimentResult(ctx, experiment, -1, false, featureId),
        };
      }
    } else if (
      experiment.namespace &&
      !inNamespace(hashValue, experiment.namespace)
    ) {
      process.env.NODE_ENV !== "production" &&
        ctx.log("Skip because of namespace", {
          id: key,
        });
      return {
        result: getExperimentResult(ctx, experiment, -1, false, featureId),
      };
    }

    // 7.5. Exclude if experiment.include returns false or throws
    if (experiment.include && !isIncluded(experiment.include)) {
      process.env.NODE_ENV !== "production" &&
        ctx.log("Skip because of include function", {
          id: key,
        });
      return {
        result: getExperimentResult(ctx, experiment, -1, false, featureId),
      };
    }

    // 8. Exclude if condition is false
    if (experiment.condition && !conditionPasses(experiment.condition, ctx)) {
      process.env.NODE_ENV !== "production" &&
        ctx.log("Skip because of condition exp", {
          id: key,
        });
      return {
        result: getExperimentResult(ctx, experiment, -1, false, featureId),
      };
    }

    // 8.05. Exclude if prerequisites are not met
    if (experiment.parentConditions) {
      for (const parentCondition of experiment.parentConditions) {
        const parentResult = evalFeature(parentCondition.id, ctx);
        // break out for cyclic prerequisites
        if (parentResult.source === "cyclicPrerequisite") {
          return {
            result: getExperimentResult(ctx, experiment, -1, false, featureId),
          };
        }

        const evalObj = { value: parentResult.value };
        if (!evalCondition(evalObj, parentCondition.condition || {})) {
          process.env.NODE_ENV !== "production" &&
            ctx.log("Skip because prerequisite evaluation fails", {
              id: key,
            });
          return {
            result: getExperimentResult(ctx, experiment, -1, false, featureId),
          };
        }
      }
    }

    // 8.1. Exclude if user is not in a required group
    if (
      experiment.groups &&
      !hasGroupOverlap(experiment.groups as string[], ctx)
    ) {
      process.env.NODE_ENV !== "production" &&
        ctx.log("Skip because of groups", {
          id: key,
        });
      return {
        result: getExperimentResult(ctx, experiment, -1, false, featureId),
      };
    }
  }

  // 8.2. Old style URL targeting
  if (experiment.url && !urlIsValid(experiment.url as RegExp, ctx)) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Skip because of url", {
        id: key,
      });
    return {
      result: getExperimentResult(ctx, experiment, -1, false, featureId),
    };
  }

  // 9. Get the variation from the sticky bucket or get bucket ranges and choose variation
  const n = hash(
    experiment.seed || key,
    hashValue,
    experiment.hashVersion || 1
  );
  if (n === null) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Skip because of invalid hash version", {
        id: key,
      });
    return {
      result: getExperimentResult(ctx, experiment, -1, false, featureId),
    };
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
      ctx.log("Skip because sticky bucket version is blocked", {
        id: key,
      });
    return {
      result: getExperimentResult(
        ctx,
        experiment,
        -1,
        false,
        featureId,
        undefined,
        true
      ),
    };
  }

  // 10. Return if not in experiment
  if (assigned < 0) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Skip because of coverage", {
        id: key,
      });
    return {
      result: getExperimentResult(ctx, experiment, -1, false, featureId),
    };
  }

  // 11. Experiment has a forced variation
  if ("force" in experiment) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Force variation", {
        id: key,
        variation: experiment.force,
      });
    return {
      result: getExperimentResult(
        ctx,
        experiment,
        experiment.force === undefined ? -1 : experiment.force,
        false,
        featureId
      ),
    };
  }

  // 12. Exclude if in QA mode
  if (ctx.qaMode) {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Skip because QA mode", {
        id: key,
      });
    return {
      result: getExperimentResult(ctx, experiment, -1, false, featureId),
    };
  }

  // 12.5. Exclude if experiment is stopped
  if (experiment.status === "stopped") {
    process.env.NODE_ENV !== "production" &&
      ctx.log("Skip because stopped", {
        id: key,
      });
    return {
      result: getExperimentResult(ctx, experiment, -1, false, featureId),
    };
  }

  // 13. Build the result object
  const result = getExperimentResult(
    ctx,
    experiment,
    assigned,
    true,
    featureId,
    n,
    foundStickyBucket
  );

  // 13.5. Persist sticky bucket
  if (ctx.stickyBucketService && !experiment.disableStickyBucketing) {
    const { changed, key: attrKey, doc } = generateStickyBucketAssignmentDoc(
      ctx,
      hashAttribute,
      toString(hashValue),
      {
        [getStickyBucketExperimentKey(
          experiment.key,
          experiment.bucketVersion
        )]: result.key,
      }
    );
    if (changed) {
      // update local docs
      ctx.stickyBucketAssignmentDocs = ctx.stickyBucketAssignmentDocs || {};
      ctx.stickyBucketAssignmentDocs[attrKey] = doc;
      // save doc
      ctx.stickyBucketService.saveAssignments(doc);
    }
  }

  // 14. Fire the tracking callback
  // Store the promise in case we're awaiting it (ex: browser url redirects)
  const trackingCall = ctx.onExperimentView(experiment, result);

  // 14.1 Keep track of completed changeIds
  "changeId" in experiment &&
    experiment.changeId &&
    ctx.recordChangeId &&
    ctx.recordChangeId(experiment.changeId as string);

  // 15. Return the result
  process.env.NODE_ENV !== "production" &&
    ctx.log("In experiment", {
      id: key,
      variation: result.variationId,
    });
  return { result, trackingCall };
}

function getFeatureResult<T>(
  ctx: FeatureEvalContext,
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
  ctx.onFeatureUsage(key, ret);

  return ret;
}

function conditionPasses(
  condition: ConditionInterface,
  ctx: FeatureEvalContext
): boolean {
  return evalCondition(ctx.attributes, condition, ctx.savedGroups || {});
}

function isFilteredOut(filters: Filter[], ctx: FeatureEvalContext): boolean {
  return filters.some((filter) => {
    const { hashValue } = getHashAttribute(ctx, filter.attribute);
    if (!hashValue) return true;
    const n = hash(filter.seed, hashValue, filter.hashVersion || 2);
    if (n === null) return true;
    return !filter.ranges.some((r) => inRange(n, r));
  });
}

function isIncludedInRollout(
  ctx: FeatureEvalContext,
  seed: string,
  hashAttribute: string | undefined,
  fallbackAttribute: string | undefined,
  range: VariationRange | undefined,
  coverage: number | undefined,
  hashVersion: number | undefined
): boolean {
  if (!range && coverage === undefined) return true;

  if (!range && coverage === 0) return false;

  const { hashValue } = getHashAttribute(ctx, hashAttribute, fallbackAttribute);
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

export function getExperimentResult<T>(
  ctx: FeatureEvalContext,
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

  const { hashAttribute, hashValue } = getHashAttribute(
    ctx,
    experiment.hashAttribute,
    ctx.stickyBucketService && !experiment.disableStickyBucketing
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

function mergeOverrides<T>(
  experiment: Experiment<T>,
  ctx: FeatureEvalContext
): Experiment<T> {
  const key = experiment.key;
  const o = ctx.overrides;
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

export function getHashAttribute(
  ctx: FeatureEvalContext,
  attr?: string,
  fallback?: string
) {
  let hashAttribute = attr || "id";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hashValue: any = "";

  if (ctx.attributes[hashAttribute]) {
    hashValue = ctx.attributes[hashAttribute];
  }

  // if no match, try fallback
  if (!hashValue && fallback) {
    if (ctx.attributes[fallback]) {
      hashValue = ctx.attributes[fallback];
    }
    if (hashValue) {
      hashAttribute = fallback;
    }
  }

  return { hashAttribute, hashValue };
}

function urlIsValid(urlRegex: RegExp, ctx: FeatureEvalContext): boolean {
  const url = ctx.url;
  if (!url) return false;

  const pathOnly = url.replace(/^https?:\/\//, "").replace(/^[^/]*\//, "/");

  if (urlRegex.test(url)) return true;
  if (urlRegex.test(pathOnly)) return true;
  return false;
}

function hasGroupOverlap(
  expGroups: string[],
  ctx: FeatureEvalContext
): boolean {
  const groups = ctx.groups || {};
  for (let i = 0; i < expGroups.length; i++) {
    if (groups[expGroups[i]]) return true;
  }
  return false;
}

function getStickyBucketVariation({
  ctx,
  expKey,
  expBucketVersion,
  expHashAttribute,
  expFallbackAttribute,
  expMinBucketVersion,
  expMeta,
}: {
  ctx: FeatureEvalContext;
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
  const id = getStickyBucketExperimentKey(expKey, expBucketVersion);
  const assignments = getStickyBucketAssignments(
    ctx,
    expHashAttribute,
    expFallbackAttribute
  );

  // users with any blocked bucket version (0 to minExperimentBucketVersion) are excluded from the test
  if (expMinBucketVersion > 0) {
    for (let i = 0; i <= expMinBucketVersion; i++) {
      const blockedKey = getStickyBucketExperimentKey(expKey, i);
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

function getStickyBucketExperimentKey(
  experimentKey: string,
  experimentBucketVersion?: number
): StickyExperimentKey {
  experimentBucketVersion = experimentBucketVersion || 0;
  return `${experimentKey}__${experimentBucketVersion}`;
}

function getStickyBucketAssignments(
  ctx: FeatureEvalContext,
  expHashAttribute: string,
  expFallbackAttribute?: string
): StickyAssignments {
  if (!ctx.stickyBucketAssignmentDocs) return {};
  const { hashAttribute, hashValue } = getHashAttribute(ctx, expHashAttribute);
  const hashKey = `${hashAttribute}||${toString(hashValue)}`;

  const {
    hashAttribute: fallbackAttribute,
    hashValue: fallbackValue,
  } = getHashAttribute(ctx, expFallbackAttribute);
  const fallbackKey = fallbackValue
    ? `${fallbackAttribute}||${toString(fallbackValue)}`
    : null;

  const assignments: StickyAssignments = {};
  if (fallbackKey && ctx.stickyBucketAssignmentDocs[fallbackKey]) {
    Object.assign(
      assignments,
      ctx.stickyBucketAssignmentDocs[fallbackKey].assignments || {}
    );
  }
  if (ctx.stickyBucketAssignmentDocs[hashKey]) {
    Object.assign(
      assignments,
      ctx.stickyBucketAssignmentDocs[hashKey].assignments || {}
    );
  }
  return assignments;
}

function generateStickyBucketAssignmentDoc(
  ctx: FeatureEvalContext,
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
    ctx.stickyBucketAssignmentDocs && ctx.stickyBucketAssignmentDocs[key]
      ? ctx.stickyBucketAssignmentDocs[key].assignments || {}
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
