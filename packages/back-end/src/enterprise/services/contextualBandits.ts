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
} from "shared/validators";
import { leafConditionFromContexts } from "shared/experiments";
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
import { logger } from "back-end/src/util/logger";
import {
  ContextualBanditResult,
  ContextualBanditStatsSettings,
} from "./contextualBanditStats";

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

export function leafWeightsFromContextualBanditResult(
  result: ContextualBanditResult,
  variations: { id: string }[],
): LeafWeight[] {
  const responses = result.responses ?? [];
  const leafMap = result.leaf_map ?? [];
  const attributeOrder = result.attributes ?? [];

  const indicesByLeaf = new Map<number, number[]>();
  const leafOrder: number[] = [];
  responses.forEach((_, i) => {
    const leafId = leafMap[i]?.leafId ?? 0;
    const existing = indicesByLeaf.get(leafId);
    if (existing) {
      existing.push(i);
    } else {
      indicesByLeaf.set(leafId, [i]);
      leafOrder.push(leafId);
    }
  });

  const leafWeights: LeafWeight[] = [];
  for (const leafId of [...leafOrder].sort((a, b) => a - b)) {
    const indices = indicesByLeaf.get(leafId) ?? [];
    const updatedWeights = responses[indices[0]]?.updatedWeights;
    if (!updatedWeights || updatedWeights.length === 0) {
      continue;
    }
    const contexts = indices.map((i) => leafMap[i]?.context ?? {});
    logger.info(
      {
        leafId,
        contexts,
        attributeOrder,
      },
      "Building contextual bandit leaf condition from stats engine contexts",
    );
    leafWeights.push({
      leafId,
      condition: leafConditionFromContexts(contexts, attributeOrder),
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
  const weightsWereUpdated = inExploreStage
    ? false
    : contextualBanditWeightsWereUpdated(
        result,
        currentLeafWeights,
        cb.variations,
      );
  const leafWeights = inExploreStage
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

    startDate: cb.dateStarted ?? new Date(),
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
