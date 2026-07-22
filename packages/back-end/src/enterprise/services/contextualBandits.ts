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
  diffVariations,
  getRemovedVariationsInUse,
  reconcileVariationWeights,
  WeightReconcileMode,
} from "shared/experiments";
import { generateVariationId } from "shared/util";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getRefLinkedFeatureInfo } from "back-end/src/services/experiments";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import { computeContextualBanditStageAndSchedule } from "back-end/src/services/contextualBanditSchedule";
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

/**
 * P2 — edit a Contextual Bandit's variations (add/remove/rename) and reconcile
 * its weights. The client sends the full desired variation list; this function
 * owns weights:
 *   1. guards (not stopped; at least two arms; no removed arm still in use);
 *   2. only when the arm SET changes (add/remove), reconciles weights — the mode
 *      comes from the CB's stage (draft/explore → uniform; exploit/paused →
 *      redistribute, which throws until the P6 formula lands, so exploit
 *      add/remove is cleanly refused for now). A metadata-only edit (names/keys)
 *      or a reorder leaves the id-keyed weights valid, so weights and
 *      `banditVersion` are left untouched — this is what lets exploit-stage
 *      metadata edits through;
 *   3. persists the new `variations` (+ reconciled weights on an arm-set change,
 *      bumping `banditVersion` via `patchLeafWeights`);
 *   4. refreshes the SDK payload for linked features.
 */
export async function executeContextualBanditVariationChange(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
  requestedVariations: Variation[],
): Promise<{ updated: ContextualBanditInterface }> {
  if (cb.status === "stopped") {
    throw new Error(
      "invalid_status: Cannot edit variations on a stopped contextual bandit",
    );
  }

  // Server owns ids: generate one for any new (id-less) variation, keep the
  // screenshots array well-formed.
  const newVariations: Variation[] = requestedVariations.map((v) => ({
    ...v,
    id: v.id || generateVariationId(),
    screenshots: v.screenshots ?? [],
  }));

  assertAtLeastTwoVariations(newVariations);

  const diff = diffVariations(cb.variations, newVariations);

  // Block removing a variation that a linked feature still maps a value to.
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

  const armSetChanged = diff.addedIds.length > 0 || diff.removedIds.length > 0;

  let updated: ContextualBanditInterface;

  if (armSetChanged) {
    const mode: WeightReconcileMode =
      !cb.stage || cb.stage === "explore" ? "uniform" : "redistribute";
    const newVariationIds = newVariations.map((v) => v.id);

    // Reconcile the aggregate (MAB-fallback) weights. In redistribute mode this
    // throws (P6), aborting before any write.
    const newVariationWeights = reconcileVariationWeights(
      cb.variationWeights ?? [],
      newVariationIds,
      mode,
    );

    // Reconcile every leaf's weights. Uniform mode has no per-leaf weights (they
    // only exist in exploit), so we clear them and let the SDK fall back to the
    // uniform aggregate.
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

    // Persist variations + aggregate weights (auto-audits as contextualBandit.update).
    await context.models.contextualBandits.update(cb, {
      variations: newVariations,
      variationWeights: newVariationWeights,
    });

    // Bump banditVersion (and write leaf weights in exploit). patchLeafWeights
    // always $inc's banditVersion; in uniform mode we pass an empty array, so the
    // version advances without overwriting leaf weights.
    updated = await context.models.contextualBandits.patchLeafWeights(
      cb.id,
      newLeafWeights,
    );
  } else {
    // Metadata-only or reorder: weights are keyed by variationId and stay valid,
    // so we leave them (and banditVersion) untouched and just persist the new
    // variation metadata/order.
    updated = await context.models.contextualBandits.update(cb, {
      variations: newVariations,
    });
  }

  const payloadKeys = getPayloadKeysForContextualBandit(context, updated);
  if (payloadKeys.length > 0) {
    queueSDKPayloadRefresh({
      context,
      payloadKeys,
      auditContext: {
        event: "contextualBandit.update",
        model: "contextualBandit",
        id: cb.id,
      },
    });
  }

  return { updated };
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
    // Stamp the weight epoch at run-start so persist can detect a mid-run
    // arm-set change (P3 concurrency guard).
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

  // Concurrency guard: if the CB's weight epoch changed while this run was in
  // flight (e.g. an add/remove-variation edit bumped `banditVersion`), the run's
  // per-leaf weights were computed against the old variation set. Their
  // positional order no longer aligns with the current `cb.variations`, so
  // `leafWeightsFromContextualBanditResult`'s index→id zip would misattribute
  // weights. Discard the weights (keep the CBE for its stats/telemetry) rather
  // than corrupt the live payload; the next scheduled run recomputes cleanly.
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
