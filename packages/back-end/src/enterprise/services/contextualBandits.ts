import type {
  ExperimentSnapshotSettings,
  SnapshotStatusSummary,
} from "shared/types/experiment-snapshot";
import type { ContextualBanditSnapshot } from "shared/types/stats";
import {
  ContextualBanditEventInterface,
  ContextualBanditInterface,
  ContextualBanditQueryInterface,
  ContextualBanditSnapshotInterface,
  ContextualBanditSnapshotSettings,
  LeafWeight,
  Variation,
} from "shared/validators";
import {
  assertAtLeastTwoVariations,
  conditionFromLeafClauses,
  defaultAddedVariationValue,
  diffVariations,
  getRemovedVariationsInUse,
  reconcileVariationWeights,
  WeightReconcileMode,
} from "shared/experiments";
import {
  generateVariationId,
  resetReviewOnChange,
  validateFeatureValue,
} from "shared/util";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { cloneDeep } from "lodash";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getRefLinkedFeatureInfo } from "back-end/src/services/experiments";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import { computeContextualBanditStageAndSchedule } from "back-end/src/services/contextualBanditSchedule";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getDraftRevision } from "back-end/src/services/features";
import { updateRevision } from "back-end/src/models/FeatureRevisionModel";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import {
  PendingDraftFailure,
  publishPendingFeatureDraftsForContextualBandit,
} from "back-end/src/services/experiment-feature";
import {
  ContextualBanditResultsQueryRunner,
  ContextualBanditSrmResult,
} from "back-end/src/enterprise/queryRunners/ContextualBanditResultsQueryRunner";
import {
  ContextualBanditResult,
  ContextualBanditStatsSettings,
} from "./contextualBanditStats";

/**
 * Every contextual bandit snapshot only considers the trailing 90 days of data
 * so weight updates reflect recent behavior rather than the full lifetime.
 */
const CONTEXTUAL_BANDIT_LOOKBACK_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Enriched info for the features that link to this Contextual Bandit (via
 * `contextual-bandit-ref` rules). Mirrors `getLinkedFeatureInfo` for experiments
 * so the CB detail page can reuse the same `LinkedFeatureInfo` UI shape.
 */
export async function getContextualBanditLinkedFeatureInfo(
  context: ReqContext | ApiReqContext,
  contextualBandit: ContextualBanditInterface,
) {
  return getRefLinkedFeatureInfo({
    context,
    linkedFeatureIds: contextualBandit.linkedFeatures || [],
    refIsDraft: contextualBandit.status === "draft",
    matchRule: (rule) =>
      rule.type === "contextual-bandit-ref" &&
      rule.contextualBanditId === contextualBandit.id,
  });
}

export async function unlinkFeatureFromContextualBandit(
  context: ReqContext | ApiReqContext,
  cbId: string,
  featureId: string,
): Promise<void> {
  const cbModel = context.models.contextualBandits;
  await cbModel.removeLinkedFeature(cbId, featureId);
  await cbModel.removePendingFeatureDraft(cbId, featureId);
}

export async function executeContextualBanditVariationChange(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
  requestedVariations: Variation[],
  newVariationValues?: Record<string, Record<string, string>>,
): Promise<{
  updated: ContextualBanditInterface;
  featureDraftPublishFailures: PendingDraftFailure[];
}> {
  if (cb.status === "stopped") {
    throw new Error(
      "invalid_status: Cannot edit variations on a stopped contextual bandit",
    );
  }

  const newVariations: Variation[] = requestedVariations.map((v) => ({
    ...v,
    id: v.id || generateVariationId(),
    screenshots: v.screenshots ?? [],
  }));

  assertAtLeastTwoVariations(newVariations);

  const diff = diffVariations(cb.variations, newVariations);

  if (diff.removedIds.length > 0) {
    const linkedInfo = await getContextualBanditLinkedFeatureInfo(context, cb);
    const referencedVariationIds = new Set<string>();
    linkedInfo.forEach((info) =>
      info.values.forEach((value) =>
        referencedVariationIds.add(value.variationId),
      ),
    );
    const inUse = getRemovedVariationsInUse(
      diff.removedIds,
      referencedVariationIds,
    );
    if (inUse.length > 0) {
      throw new Error(
        `Cannot remove variation(s) still used by a linked feature: ${inUse.join(
          ", ",
        )}. Update the linked feature(s) first.`,
      );
    }
  }

  // Validate + authorize new-arm feature values BEFORE any persistence, so a bad
  // value or a missing publish permission aborts cleanly with nothing committed.
  if (diff.addedIds.length > 0) {
    await validateAndAuthorizeAddedVariationValues(
      context,
      cb,
      diff.addedIds,
      newVariationValues,
    );
  }

  const armSetChanged = diff.addedIds.length > 0 || diff.removedIds.length > 0;

  let updated: ContextualBanditInterface;

  if (armSetChanged) {
    const mode: WeightReconcileMode =
      !cb.stage || cb.stage === "explore" ? "uniform" : "redistribute";
    const newVariationIds = newVariations.map((v) => v.id);

    const newVariationWeights = reconcileVariationWeights(
      cb.variationWeights ?? [],
      newVariationIds,
      mode,
    );

    const newLeafWeights: LeafWeight[] =
      mode === "uniform"
        ? []
        : (cb.currentLeafWeights ?? []).map((lw) => ({
            ...lw,
            weights: reconcileVariationWeights(
              lw.weights,
              newVariationIds,
              mode,
            ),
          }));

    await context.models.contextualBandits.update(cb, {
      variations: newVariations,
      variationWeights: newVariationWeights,
    });

    updated = await context.models.contextualBandits.patchLeafWeights(
      cb.id,
      newLeafWeights,
      { bumpVersion: true },
    );
  } else {
    // Same arm set: weights stay valid (keyed by variationId). A reorder still
    // shifts variation indices / the positional SDK arrays, so it must open a
    // new epoch (bump banditVersion) to avoid conflating pre/post-reorder
    // exposures; a pure metadata edit (names/keys) leaves assignment unchanged
    // and skips the bump.
    const orderChanged =
      cb.variations.map((v) => v.id).join(",") !==
      newVariations.map((v) => v.id).join(",");
    updated = await context.models.contextualBandits.update(cb, {
      variations: newVariations,
    });
    if (orderChanged) {
      updated = await context.models.contextualBandits.patchLeafWeights(
        cb.id,
        [],
        { bumpVersion: true },
      );
    }
  }

  let featureDraftPublishFailures: PendingDraftFailure[] = [];
  let payloadAlreadyRefreshed = false;
  if (diff.addedIds.length > 0) {
    const applied = await addVariationValuesToLinkedFeatures(
      context,
      updated,
      diff.addedIds,
      newVariationValues,
    );
    updated = applied.cb;
    featureDraftPublishFailures = applied.failures;
    payloadAlreadyRefreshed = applied.refreshedPayload;
  }

  // Publishing the added-arm feature drafts already rebuilds the payload; only
  // refresh here when it didn't (no adds, draft CB, or a failed/partial publish).
  if (!payloadAlreadyRefreshed) {
    await refreshLinkedFeaturePayloads(
      context,
      updated,
      "contextualBandit.refresh",
    );
  }

  return { updated, featureDraftPublishFailures };
}

/**
 * Validate the value each linked feature will serve for the newly-added arms,
 * and (for a running CB, which publishes immediately) require publish permission
 * on those features. Throws before any persistence so the whole edit is aborted.
 */
async function validateAndAuthorizeAddedVariationValues(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
  addedIds: string[],
  providedValues?: Record<string, Record<string, string>>,
): Promise<void> {
  const linkedInfo = await getContextualBanditLinkedFeatureInfo(context, cb);
  for (const info of linkedInfo) {
    const feature = info.feature;
    const existing = new Set(info.values.map((v) => v.variationId));
    const controlValue = info.values[0]?.value;

    let hasNewValue = false;
    for (const addedId of addedIds) {
      if (existing.has(addedId)) continue;
      hasNewValue = true;
      // Throws on a type mismatch (e.g. non-numeric value on a number feature).
      validateFeatureValue(
        feature,
        defaultAddedVariationValue(
          providedValues?.[feature.id]?.[addedId],
          controlValue,
          feature.defaultValue,
        ),
        `Variation ${addedId}`,
      );
    }

    if (!hasNewValue) continue;

    // A running CB publishes the linked-feature draft immediately, so the editor
    // must be allowed to publish it.
    if (cb.status === "running") {
      const envs = Object.keys(info.environmentStates ?? {});
      const publishEnvs = envs.length > 0 ? envs : context.environments;
      if (!context.permissions.canPublishFeature(feature, publishEnvs)) {
        context.permissions.throwPermissionError();
      }
    }
  }
}

export async function addVariationValuesToLinkedFeatures(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
  addedIds: string[],
  providedValues?: Record<string, Record<string, string>>,
): Promise<{
  cb: ContextualBanditInterface;
  failures: PendingDraftFailure[];
  // True when publishing already rebuilt the SDK payload for every affected
  // feature (so the caller can skip a redundant refresh).
  refreshedPayload: boolean;
}> {
  const featureIds = cb.linkedFeatures ?? [];
  if (addedIds.length === 0 || featureIds.length === 0)
    return { cb, failures: [], refreshedPayload: false };

  let stagedAny = false;

  for (const featureId of featureIds) {
    const feature = await getFeature(context, featureId);
    if (!feature) continue;

    const revision = await getDraftRevision(context, feature, feature.version);
    const rules = cloneDeep(revision.rules ?? []);
    const changedEnvironments = new Set<string>();
    let changed = false;

    for (const rule of rules) {
      if (
        rule.type !== "contextual-bandit-ref" ||
        rule.contextualBanditId !== cb.id
      ) {
        continue;
      }
      const existing = new Set(rule.variations.map((v) => v.variationId));
      const controlValue = rule.variations[0]?.value;
      let ruleChanged = false;
      for (const addedId of addedIds) {
        if (existing.has(addedId)) continue;
        const value = validateFeatureValue(
          feature,
          defaultAddedVariationValue(
            providedValues?.[featureId]?.[addedId],
            controlValue,
            feature.defaultValue,
          ),
          `Variation ${addedId}`,
        );
        rule.variations.push({ variationId: addedId, value });
        ruleChanged = true;
      }
      if (ruleChanged) {
        changed = true;
        (rule.allEnvironments
          ? context.environments
          : (rule.environments ?? [])
        ).forEach((e) => changedEnvironments.add(e));
      }
    }

    if (!changed) continue;

    const resetReview = resetReviewOnChange({
      feature,
      changedEnvironments: [...changedEnvironments],
      defaultValueChanged: false,
      settings: context.org.settings,
    });

    const updatedRevision =
      (await updateRevision(
        context,
        feature,
        revision,
        { rules },
        {
          user: context.auditUser,
          action: "add contextual bandit variation value",
          subject: `for "${cb.name}"`,
          value: JSON.stringify({ addedVariationIds: addedIds }),
        },
        resetReview,
      )) ?? revision;

    await recordRevisionUpdate(
      context,
      feature,
      updatedRevision,
      "rule.update",
      { environments: [...changedEnvironments] },
    );

    await context.models.contextualBandits.addPendingFeatureDraft(
      cb.id,
      feature.id,
      updatedRevision.version,
    );
    stagedAny = true;
  }

  if (!stagedAny) return { cb, failures: [], refreshedPayload: false };

  const refreshed =
    (await context.models.contextualBandits.getById(cb.id)) ?? cb;
  if (refreshed.status === "running") {
    const result = await publishPendingFeatureDraftsForContextualBandit(
      context,
      refreshed,
    );
    if (result.failed.length > 0) {
      context.logger.warn(
        { contextualBanditId: cb.id, failed: result.failed },
        "Linked-feature draft(s) for added contextual bandit variations could not be auto-published; the new variation will serve its default value until the feature is published",
      );
    }
    const rereadCb =
      (await context.models.contextualBandits.getById(cb.id)) ?? refreshed;
    // Every added arm stages a draft on every linked feature, so a clean publish
    // (nothing failed) rebuilt the payload for all of them — no extra refresh
    // needed. A partial/failed publish leaves some payloads stale, so the caller
    // must still refresh.
    return {
      cb: rereadCb,
      failures: result.failed,
      refreshedPayload:
        result.published.length > 0 && result.failed.length === 0,
    };
  }
  return { cb: refreshed, failures: [], refreshedPayload: false };
}

export type ContextualBanditResultsForUi = {
  contextualBanditSnapshot: ContextualBanditSnapshot | null;
  latestSnapshotSummary: SnapshotStatusSummary | null;
  /** SRM of the latest snapshot run; null when the run has no SRM result. */
  srm: ContextualBanditSrmResult | null;
};

function mapCbsStatusToSnapshotStatus(
  status: ContextualBanditSnapshotInterface["status"],
): SnapshotStatusSummary["status"] {
  if (status === "success" || status === "partial") {
    return "success";
  }
  if (status === "error") {
    return "error";
  }
  return "running";
}

export function toContextualBanditSnapshotStatusSummary(
  cbs: ContextualBanditSnapshotInterface,
): SnapshotStatusSummary {
  return {
    id: cbs.id,
    status: mapCbsStatusToSnapshotStatus(cbs.status),
    error: cbs.error ?? "",
    queries: cbs.queries,
    runStarted: cbs.runStarted,
    dateCreated: cbs.dateCreated,
    multipleExposures: 0,
    type: "standard",
    triggeredBy: cbs.triggeredBy,
  };
}

/** Latest CBS run status + CBE stats payload for the CB results UI. */
export async function getContextualBanditResultsForUi(
  context: ReqContext,
  cb: ContextualBanditInterface,
): Promise<ContextualBanditResultsForUi> {
  const [latestSnapshot, latestEvent] = await Promise.all([
    context.models.contextualBanditSnapshots.getLatestForContextualBandit(
      cb.id,
    ),
    context.models.contextualBanditEvents.getLatestForContextualBandit(cb.id),
  ]);

  const contextualBanditSnapshot: ContextualBanditSnapshot | null = latestEvent
    ? {
        attributes: latestEvent.attributes,
        responses: latestEvent.responses,
        leaf_map: latestEvent.leaf_map,
        leaf_stats: latestEvent.leaf_stats,
        sse_trajectory: latestEvent.sse_trajectory,
      }
    : null;

  const latestSnapshotSummary = latestSnapshot
    ? toContextualBanditSnapshotStatusSummary(latestSnapshot)
    : null;

  return {
    contextualBanditSnapshot,
    latestSnapshotSummary,
    srm: latestSnapshot?.srm ?? null,
  };
}

export async function runContextualBanditSnapshot(
  context: ApiReqContext,
  cb: ContextualBanditInterface,
  opts: {
    triggeredBy: "manual" | "scheduled";
    wait?: boolean;
  },
): Promise<{ snapshotId: string; cbeId?: string }> {
  if (!context.hasPremiumFeature("contextual-bandits")) {
    context.throwPlanDoesNotAllowError(
      "Contextual Bandits require an Enterprise plan.",
    );
  }

  const ds = await getDataSourceById(context, cb.datasource);
  if (!ds) throw new Error(`Datasource missing: ${cb.datasource}`);

  const cbQuery = await context.models.contextualBanditQueries.getById(
    cb.contextualBanditQueryId,
  );
  if (!cbQuery) {
    throw new Error(
      `Contextual bandit query missing: ${cb.contextualBanditQueryId}`,
    );
  }

  // Compute bandit stage before running the update, in case this
  // update moves bandits from explore to exploit.
  const scheduleChanges = computeContextualBanditStageAndSchedule(cb);
  const updatedCb = await context.models.contextualBandits.update(
    cb,
    scheduleChanges,
  );

  const snapshotSettings = buildContextualBanditSnapshotSettings(
    updatedCb,
    cbQuery,
  );

  const cbs = await context.models.contextualBanditSnapshots.create({
    contextualBandit: updatedCb.id,
    status: "running",
    queries: [],
    runStarted: null,
    frozenSettings: snapshotSettings,
    triggeredBy: opts.triggeredBy === "manual" ? "manual" : "schedule",
    weightsWereUpdated: false,
    banditVersion: updatedCb.banditVersion,
  });

  const integration = getSourceIntegrationObject(context, ds, true);
  const runner = new ContextualBanditResultsQueryRunner(
    context,
    cbs,
    integration,
    false,
  );

  const variationNames = (updatedCb.variations ?? []).map((v) => v.name);

  await runner.startAnalysis({
    snapshotSettings,
    variationNames,
  });

  if (!opts.wait) {
    return { snapshotId: cbs.id };
  }

  await runner.waitForResults();

  const finalCbs =
    await context.models.contextualBanditSnapshots.getBySnapshotIdInOrg(cbs.id);
  if (!finalCbs) {
    throw new Error(`CBS disappeared during run: ${cbs.id}`);
  }
  if (finalCbs.status === "error") {
    throw new Error(
      finalCbs.error ??
        "Contextual bandit snapshot failed with no error message",
    );
  }

  return {
    snapshotId: finalCbs.id,
    cbeId: finalCbs.contextualBanditEventId ?? undefined,
  };
}

/**
 * Collapses a run's per-leaf `leaf_map` into one `LeafWeight` per tree leaf:
 * `{ leafId, condition, weights }`. `condition` is the targeting predicate that
 * routes a context to the leaf (derived from the leaf's structured clauses), so
 * the persisted weights are self-contained for the SDK payload without re-joining
 * the event's `leaf_map`. Leaves whose responses carry no updated weights are
 * skipped.
 */
export function leafWeightsFromContextualBanditResult(
  result: ContextualBanditResult,
  variations: { id: string }[],
): LeafWeight[] {
  const responses = result.responses ?? [];
  const leafMap = result.leaf_map ?? [];

  const updatedWeightsByLeaf = new Map<number, number[]>();
  responses.forEach((response) => {
    const leafId = response.leafId ?? 0;
    const updatedWeights = response.updatedWeights;
    if (updatedWeights && updatedWeights.length > 0) {
      if (!updatedWeightsByLeaf.has(leafId)) {
        updatedWeightsByLeaf.set(leafId, updatedWeights);
      }
    }
  });

  const leafWeights: LeafWeight[] = [];
  for (const entry of [...leafMap].sort((a, b) => a.leafId - b.leafId)) {
    const updatedWeights = updatedWeightsByLeaf.get(entry.leafId);
    if (!updatedWeights || updatedWeights.length === 0) {
      continue;
    }
    leafWeights.push({
      leafId: entry.leafId,
      condition: conditionFromLeafClauses(entry.context),
      weights: updatedWeights.map((weight, i) => ({
        variationId: variations[i]?.id ?? String(i),
        weight,
      })),
    });
  }
  return leafWeights;
}

export function contextualBanditWeightsWereUpdated(
  result: ContextualBanditResult,
  currentLeafWeights: LeafWeight[],
  variations: { id: string }[],
): boolean {
  const newLeafWeights = leafWeightsFromContextualBanditResult(
    result,
    variations,
  );

  if (newLeafWeights.length === 0) {
    return false;
  }

  if (newLeafWeights.length !== currentLeafWeights.length) {
    return true;
  }

  const currentByCondition = new Map(
    currentLeafWeights.map((lw) => [
      JSON.stringify(lw.condition),
      { leafId: lw.leafId, weights: lw.weights.map((p) => p.weight) },
    ]),
  );

  return newLeafWeights.some((lw) => {
    const current = currentByCondition.get(JSON.stringify(lw.condition));
    if (!current) {
      return true;
    }
    return (
      current.leafId !== lw.leafId ||
      JSON.stringify(current.weights) !==
        JSON.stringify(lw.weights.map((p) => p.weight))
    );
  });
}

/** Persists one CB run's side effects: creates the CBE doc, patches parent CB leaf weights, refreshes SDK payload. */
export async function persistContextualBanditEvent(
  context: ReqContext,
  cbs: ContextualBanditSnapshotInterface,
  result: ContextualBanditResult & { srm?: ContextualBanditSrmResult },
): Promise<ContextualBanditEventInterface> {
  const cb = await context.models.contextualBandits.getById(
    cbs.contextualBandit,
  );
  if (!cb) {
    throw new Error(`No CB doc for ${cbs.contextualBandit}`);
  }

  const currentLeafWeights = cb.currentLeafWeights ?? [];
  const inExploreStage = cb.stage === "explore";

  const staleWeightEpoch =
    cbs.banditVersion !== undefined && cbs.banditVersion !== cb.banditVersion;
  if (staleWeightEpoch) {
    context.logger.warn(
      `Contextual bandit ${cb.id} snapshot ${cbs.id} ran against banditVersion ` +
        `${cbs.banditVersion} but the CB is now at ${cb.banditVersion}; ` +
        `discarding this run's weights (arm set changed mid-run).`,
    );
  }

  const discardWeights = inExploreStage || staleWeightEpoch;
  const weightsWereUpdated = discardWeights
    ? false
    : contextualBanditWeightsWereUpdated(
        result,
        currentLeafWeights,
        cb.variations,
      );
  const leafWeights = discardWeights
    ? []
    : leafWeightsFromContextualBanditResult(result, cb.variations);

  const cbe = await context.models.contextualBanditEvents.create({
    contextualBandit: cb.id,
    snapshotId: cbs.id,
    attributes: result.attributes,
    responses: result.responses,
    leaf_map: result.leaf_map,
    leaf_stats: result.leaf_stats,
    sse_trajectory: result.sse_trajectory,
    weightsWereUpdated,
    ...(result.srm ? { degreesOfFreedom: result.srm.degreesOfFreedom } : {}),
  });

  await context.models.contextualBandits.patchLeafWeights(cb.id, leafWeights, {
    bumpVersion: weightsWereUpdated,
  });

  if (weightsWereUpdated) {
    await refreshLinkedFeaturePayloads(context, cb, "contextualBandit.refresh");
  }

  return cbe;
}

/** Builds the frozen snapshot settings stored on CBS so the run is reproducible if the parent CB mutates. */
export function buildContextualBanditSnapshotSettings(
  cb: ContextualBanditInterface,
  cbQuery: ContextualBanditQueryInterface,
): ContextualBanditSnapshotSettings {
  const numVariations = cb.variations?.length || 1;

  const banditStart = cb.dateStarted ?? new Date();
  const effectiveEnd = cb.dateStopped ?? new Date();
  const lookbackStart = new Date(
    effectiveEnd.getTime() - CONTEXTUAL_BANDIT_LOOKBACK_DAYS * DAY_MS,
  );
  const startDate = new Date(
    Math.max(banditStart.getTime(), lookbackStart.getTime()),
  );

  return {
    experimentId: cb.id,
    trackingKey: cb.trackingKey || cb.id,
    contextualBanditId: cb.id,

    datasourceId: cb.datasource,
    contextualBanditQueryId: cb.contextualBanditQueryId,
    query: cbQuery.query,
    userIdType: cbQuery.userIdType,
    contextualAttributes:
      cbQuery.targetingAttributeColumns ?? cb.contextualAttributes,

    decisionMetric: cb.decisionMetric ?? "",
    metricSettings: {},

    variations: (cb.variations ?? []).map((v) => ({
      id: v.id,
      weight:
        cb.variationWeights?.find((w) => w.variationId === v.id)?.weight ??
        1 / numVariations,
    })),

    minUsersPerLeaf: cb.minUsersPerLeaf,
    maxLeaves: cb.maxLeaves,
    banditModelVersion: cb.banditModelVersion,

    startDate,
    endDate: cb.dateStopped ?? null,
    reweight: true,
    banditWeightsSeed: 0,

    // TODO(holdout-v1.5): thread `holdoutPercent` + seed so SQL can split train_id=0/1 and stats can compute holdout-vs-bandit lift.
  };
}

/** Translates `ContextualBanditSnapshotSettings` into the `ExperimentSnapshotSettings` shape used by `SqlIntegration.getSnapshotMetricQuery`. */
export function buildSnapshotSettingsForCb(
  cbSnapshotSettings: ContextualBanditSnapshotSettings,
): ExperimentSnapshotSettings {
  const decisionMetric = cbSnapshotSettings.decisionMetric;
  return {
    experimentId: cbSnapshotSettings.trackingKey,
    queryFilter: "",
    datasourceId: cbSnapshotSettings.datasourceId,
    exposureQueryId: cbSnapshotSettings.contextualBanditQueryId,
    startDate: cbSnapshotSettings.startDate,
    endDate: cbSnapshotSettings.endDate ?? new Date(),
    goalMetrics: decisionMetric ? [decisionMetric] : [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    metricSettings: [],
    variations: cbSnapshotSettings.variations,
    dimensions: [],
    coverage: cbSnapshotSettings.variations.reduce((s, v) => s + v.weight, 0),
    segment: "",
    skipPartialData: false,
    attributionModel: "firstExposure",
    regressionAdjustmentEnabled: false,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: DEFAULT_PROPER_PRIOR_STDDEV,
    },
    banditSettings: {
      contextualBandit: true,
      targetingAttributeColumns: cbSnapshotSettings.contextualAttributes,
      reweight: cbSnapshotSettings.reweight,
      decisionMetric,
      seed: cbSnapshotSettings.banditWeightsSeed,
      currentWeights: cbSnapshotSettings.variations.map((v) => v.weight),
      historicalWeights: [],
    },
  };
}

export function getContextualBanditSettingsForStatsEngine(
  cb: ContextualBanditInterface,
  variationIds: string[],
): ContextualBanditStatsSettings {
  return {
    varIds: variationIds,
    contextualAttributes: cb.contextualAttributes,
    maxLeaves: cb.maxLeaves,
    minUsersPerLeaf: cb.minUsersPerLeaf,
  };
}
