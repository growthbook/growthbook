import type {
  SnapshotMetricRequest,
  SnapshotStatusSummary,
} from "shared/types/experiment-snapshot";
import type { ContextualBanditSnapshot } from "shared/types/stats";
import { ExposureQuery } from "shared/types/datasource";
import {
  ContextualBanditEventInterface,
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  ContextualBanditSnapshotSettings,
  LeafWeight,
} from "shared/validators";
import { deriveContextId } from "shared/util";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSettingsForSnapshotMetrics } from "back-end/src/services/experiments";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { getPayloadKeysForContextualBandit } from "back-end/src/services/contextualBanditChanges";
import {
  ContextualBanditResultsQueryRunner,
  ContextualBanditSrmResult,
} from "back-end/src/enterprise/queryRunners/ContextualBanditResultsQueryRunner";
import {
  ContextualBanditResult,
  ContextualBanditSettingsForStatsEngine,
} from "./contextualBanditStats";

export type ContextualBanditResultsForUi = {
  contextualBanditSnapshot: ContextualBanditSnapshot | null;
  latest: SnapshotStatusSummary | null;
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
  const [latestCbs, latestCbe] = await Promise.all([
    context.models.contextualBanditSnapshots.getLatestForContextualBandit(
      cb.id,
    ),
    context.models.contextualBanditEvents.getLatestForContextualBandit(cb.id),
  ]);

  const contextualBanditSnapshot: ContextualBanditSnapshot | null = latestCbe
    ? {
        attributes: latestCbe.attributes,
        responses: latestCbe.responses,
        leaf_map: latestCbe.leaf_map,
        leaf_stats: latestCbe.leaf_stats,
      }
    : null;

  const latest = latestCbs
    ? toContextualBanditSnapshotStatusSummary(latestCbs)
    : null;

  return { contextualBanditSnapshot, latest };
}

export async function runContextualBanditSnapshot(
  context: ApiReqContext,
  cb: ContextualBanditInterface,
  opts: { triggeredBy: "manual" | "scheduled"; triggeredByUser?: string },
): Promise<{ snapshotId: string; cbeId?: string }> {
  // Defense-in-depth: re-check licensing so background jobs / internal callers can't bypass.
  if (!context.hasPremiumFeature("contextual-bandits")) {
    context.throwPlanDoesNotAllowError(
      "Contextual Bandits require an Enterprise plan.",
    );
  }

  const ds = await getDataSourceById(context, cb.datasourceId);
  if (!ds) throw new Error(`Datasource missing: ${cb.datasourceId}`);

  const eaq = ds.settings?.queries?.exposure?.find(
    (q) => q.id === cb.exposureQueryId,
  );
  if (!eaq) throw new Error(`EAQ missing: ${cb.exposureQueryId}`);

  const { regressionAdjustmentEnabled } = await getSettingsForSnapshotMetrics(
    context,
    cb,
  );

  const snapshotSettings = buildContextualBanditSnapshotSettings(
    cb,
    eaq,
    regressionAdjustmentEnabled,
  );

  const cbs = await context.models.contextualBanditSnapshots.create({
    contextualBandit: cb.id,
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

  const variationNames = (cb.variations ?? []).map((v) => v.name);

  await runner.startAnalysis({
    snapshotSettings,
    variationNames,
  });
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

/** Derives stable leaf ids from per-leaf targeting conditions; seed must match the one used when reading `currentLeafWeights`. */
export function leafWeightsFromContextualBanditResult(
  seed: string,
  result: ContextualBanditResult,
  variations: { id: string }[],
): LeafWeight[] {
  return result.responses
    .filter((r) => r.updatedWeights != null && r.updatedWeights.length > 0)
    .map((r) => ({
      contextId: deriveContextId(seed, r.context),
      weights: r.updatedWeights!.map((weight, i) => ({
        variationId: variations[i]?.id ?? String(i),
        weight,
      })),
    }));
}

/** True when any leaf's updated weights differ from the current leaf weights. */
export function contextualBanditWeightsWereUpdated(
  result: ContextualBanditResult,
  seed: string,
  currentLeafWeights: LeafWeight[],
): boolean {
  const currentByContext = Object.fromEntries(
    currentLeafWeights.map((lw) => [lw.contextId, lw.weights]),
  );

  return result.responses.some((r) => {
    if (r.error || !r.updatedWeights?.length) {
      return false;
    }
    const contextId = deriveContextId(seed, r.context);
    const current = currentByContext[contextId];
    if (!current) {
      return true;
    }
    const currentNumbers = current.map((p) => p.weight);
    return JSON.stringify(currentNumbers) !== JSON.stringify(r.updatedWeights);
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
  const weightsWereUpdated = contextualBanditWeightsWereUpdated(
    result,
    cb.id,
    currentLeafWeights,
  );
  const leafWeights = leafWeightsFromContextualBanditResult(
    cb.id,
    result,
    cb.variations,
  );

  const cbe = await context.models.contextualBanditEvents.create({
    contextualBandit: cb.id,
    snapshotId: cbs.id,
    attributes: result.attributes,
    responses: result.responses,
    leaf_map: result.leaf_map,
    leaf_stats: result.leaf_stats,
    weightsWereUpdated,
    ...(result.srm ? { degreesOfFreedom: result.srm.degreesOfFreedom } : {}),
  });

  // Always patch on a successful snapshot so `banditVersion` advances once per CBE, even when
  // there are no leaf weights to write. `patchLeafWeights` leaves `currentLeafWeights` untouched
  // when `leafWeights` is empty, so this can't wipe existing weights.
  await context.models.contextualBandits.patchLeafWeights(cb.id, leafWeights);

  const payloadKeys = getPayloadKeysForContextualBandit(context, cb);
  if (payloadKeys.length > 0) {
    queueSDKPayloadRefresh({
      context,
      payloadKeys,
      auditContext: {
        event: "contextualBandit.refresh",
        model: "contextualBandit",
        id: cb.id,
      },
    });
  }

  return cbe;
}

/**
 * Converts an attribute map to a targeting condition.
 * Null/undefined values are stripped; an empty map produces `{}` (the "other" catch-all).
 */
export function attributesToCondition(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  if (!attributes || typeof attributes !== "object") return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (v !== null && v !== undefined) {
      result[k] = v;
    }
  }
  return result;
}

/** Builds the frozen snapshot settings stored on CBS so the run is reproducible if the parent CB mutates. */
export function buildContextualBanditSnapshotSettings(
  cb: ContextualBanditInterface,
  exposureQuery: ExposureQuery,
  regressionAdjustmentEnabled: boolean,
): ContextualBanditSnapshotSettings {
  const numVariations = cb.variations?.length || 1;

  return {
    experimentId: cb.id,
    trackingKey: cb.trackingKey || cb.id,
    contextualBanditId: cb.id,

    datasourceId: cb.datasourceId,
    exposureQueryId: cb.exposureQueryId,
    contextualAttributes:
      exposureQuery.targetingAttributeColumns ?? cb.contextualAttributes,

    goalMetrics: cb.goalMetrics ?? [],
    metricSettings: Object.fromEntries(
      (cb.metricOverrides ?? []).map((m) => [m.id, m]),
    ),

    variations: (cb.variations ?? []).map((v) => ({
      id: v.id,
      weight:
        cb.variationWeights?.find((w) => w.variationId === v.id)?.weight ??
        1 / numVariations,
    })),

    minUsersPerLeaf: cb.minUsersPerLeaf,
    maxLeaves: cb.maxLeaves,
    canonicalFormVersion: cb.canonicalFormVersion,

    regressionAdjustmentEnabled,

    startDate: cb.dateStarted ?? new Date(),
    endDate: cb.dateStopped ?? null,
    reweight: true,
    // Seed is a fixed 0. A future stored `banditSeed` field can re-introduce variability if needed.
    banditWeightsSeed: 0,

    // TODO(holdout-v1.5): thread `holdoutPercent` + seed so SQL can split train_id=0/1 and stats can compute holdout-vs-bandit lift.
  };
}

/** Translates `ContextualBanditSnapshotSettings` into the `SnapshotMetricRequest` shape used by `SqlIntegration.getSnapshotMetricQuery`. */
export function buildSnapshotMetricRequestForCb(
  cbSnapshotSettings: ContextualBanditSnapshotSettings,
): SnapshotMetricRequest {
  const decisionMetric = cbSnapshotSettings.goalMetrics[0] ?? "";
  return {
    experimentId: cbSnapshotSettings.trackingKey,
    queryFilter: "",
    datasourceId: cbSnapshotSettings.datasourceId,
    exposureQueryId: cbSnapshotSettings.exposureQueryId,
    startDate: cbSnapshotSettings.startDate,
    endDate: cbSnapshotSettings.endDate ?? new Date(),
    goalMetrics: cbSnapshotSettings.goalMetrics,
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    // CB v1 doesn't apply per-metric overrides at SQL gen time; empty array is the safe default.
    metricSettings: [],
    variations: cbSnapshotSettings.variations,
    dimensions: [],
    coverage: cbSnapshotSettings.variations.reduce((s, v) => s + v.weight, 0),
    segment: "",
    skipPartialData: false,
    attributionModel: "firstExposure",
    regressionAdjustmentEnabled: cbSnapshotSettings.regressionAdjustmentEnabled,
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
      // CUPED covariate aggregates yes; pooled bandit-period theta no.
      poolRegressionTheta: false,
    },
  };
}

/** Whether updated CB variation weights are computed by the Python stats engine (`true`) or in TypeScript (`false`). */
const UPDATE_WEIGHTS_USING_PYTHON = false;

export function getContextualBanditSettingsForStatsEngine(
  cb: ContextualBanditInterface,
  variations: { id: string; name: string }[],
  currentWeightsByContext: Record<string, number[]>,
): ContextualBanditSettingsForStatsEngine {
  return {
    var_names: variations.map((v) => v.name),
    var_ids: variations.map((v) => v.id),
    reweight: true,
    // Seed is a fixed 0 (matches `buildContextualBanditSnapshotSettings.banditWeightsSeed`).
    bandit_weights_seed: 0,
    contextual_attributes: cb.contextualAttributes,
    current_weights_by_context: currentWeightsByContext,
    max_leaves: cb.maxLeaves,
    min_users_per_leaf: cb.minUsersPerLeaf,
    update_weights_using_python: UPDATE_WEIGHTS_USING_PYTHON,
  };
}
