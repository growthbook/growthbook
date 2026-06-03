// See contextual-bandit-fix-prompt.md for the v1 scope and the v1.5 holdout TODOs.
//
// SMITH: When the real Python stats engine grows new output fields, those
// fields must be plumbed through in BOTH places:
//   1. `persistContextualBanditEvent` below (mapping result → CBE create payload), and
//   2. the validators in shared/src/validators/contextual-bandit-event.ts
//      (`contextualBanditResponseValidator`).
// Skipping either side will either drop the field on the floor or fail
// schema validation on write.
//
// TODO(holdout-v1.5): SDK tracking callback for holdout-bucket users is
// deferred. When holdout ships, the orchestrator must emit (or the SDK must
// receive) per-user assignment events that distinguish holdout vs bandit
// buckets. See sdk-callback-design-summary.md for the Option A (combined
// callback with a `train_id` column) vs Option B (separate callbacks)
// decision.

import { ExperimentInterface } from "shared/types/experiment";
import type {
  ExperimentSnapshotSettings,
  SnapshotStatusSummary,
} from "shared/types/experiment-snapshot";
import type { ContextualBanditSnapshot } from "shared/types/stats";
import { ExposureQuery } from "shared/types/datasource";
import {
  ContextualBanditEventInterface,
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  ContextualBanditSnapshotSettings,
} from "shared/validators";
import { deriveContextId } from "shared/util";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getSettingsForSnapshotMetrics,
  maybeCreateContextualBanditDoc,
} from "back-end/src/services/experiments";
import {
  getExperimentById,
  getPayloadKeys,
} from "back-end/src/models/ExperimentModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { ContextualBanditResultsQueryRunner } from "back-end/src/enterprise/queryRunners/ContextualBanditResultsQueryRunner";
import {
  ContextualBanditResult,
  ContextualBanditSettingsForStatsEngine,
} from "./contextualBanditStats";

/**
 * Orchestrates one contextual-bandit snapshot run end-to-end.
 *
 * High-level flow:
 *   1. Resolve CB doc + datasource + integration + exposure-assignment query.
 *   2. Freeze a typed `ContextualBanditSnapshotSettings` so the run is
 *      reproducible even if the parent CB doc mutates afterward.
 *   3. Open the CBS doc (`status: "running"`, `runStarted: null`, with the
 *      frozen settings already persisted as `frozenSettings`).
 *   4. Hand control to `ContextualBanditResultsQueryRunner`, which owns the
 *      SQL query lifecycle, the stats-engine call, and (on success) the
 *      side effects in `persistContextualBanditEvent`.
 *   5. Re-read the CBS to surface the final status + the CBE id back to the
 *      caller. Throws if the runner left the CBS in `"error"`.
 */
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

/** Latest CBS run status + CBE stats payload for the experiment results UI. */
export async function getContextualBanditResultsForUi(
  context: ReqContext,
  experiment: ExperimentInterface,
): Promise<ContextualBanditResultsForUi> {
  const phase = Math.max(0, experiment.phases.length - 1);
  const [latestCbs, latestCbe] = await Promise.all([
    context.models.contextualBanditSnapshots.getLatestForExperiment(
      experiment.id,
      phase,
    ),
    context.models.contextualBanditEvents.getLatestForExperiment(
      experiment.id,
      phase,
    ),
  ]);

  const contextualBanditSnapshot: ContextualBanditSnapshot | null = latestCbe
    ? {
        attributes: latestCbe.attributes,
        responses: latestCbe.responses,
        leaf_map: latestCbe.leaf_map,
      }
    : null;

  const latest = latestCbs
    ? toContextualBanditSnapshotStatusSummary(latestCbs)
    : null;

  return { contextualBanditSnapshot, latest };
}

export async function runContextualBanditSnapshot(
  context: ApiReqContext,
  experiment: ExperimentInterface,
  phase: number,
  opts: { triggeredBy: "manual" | "scheduled"; triggeredByUser?: string },
): Promise<{ snapshotId: string; cbeId?: string }> {
  // Defense-in-depth: callers already gate this; check again so future callers
  // (background jobs, internal scripts) can't bypass licensing.
  if (!context.hasPremiumFeature("contextual-bandits")) {
    context.throwPlanDoesNotAllowError(
      "Contextual Bandits require an Enterprise plan.",
    );
  }

  let cb = await context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    // A `contextual-bandit` experiment can reach this path without a linked
    // CB doc — e.g. a doc forward-migrated from the deprecated
    // `banditIsContextual` flag (see upgradeExperimentDoc), or one whose
    // creation-time provisioning didn't complete. Lazily provision it
    // (idempotent) so we self-heal instead of failing every scheduled refresh.
    await maybeCreateContextualBanditDoc(context, experiment);
    cb = await context.models.contextualBandits.getByExperimentId(
      experiment.id,
    );
  }
  if (!cb) throw new Error(`No CB doc for experiment ${experiment.id}`);

  const ds = await getDataSourceById(context, cb.datasourceId);
  if (!ds) throw new Error(`Datasource missing: ${cb.datasourceId}`);

  const eaq = ds.settings?.queries?.exposure?.find(
    (q) => q.id === cb.exposureQueryId,
  );
  if (!eaq) throw new Error(`EAQ missing: ${cb.exposureQueryId}`);

  const { regressionAdjustmentEnabled } = await getSettingsForSnapshotMetrics(
    context,
    experiment,
  );

  const snapshotSettings = buildContextualBanditSnapshotSettings(
    cb,
    experiment,
    phase,
    eaq,
    regressionAdjustmentEnabled,
  );

  const cbs = await context.models.contextualBanditSnapshots.create({
    experiment: experiment.id,
    phase,
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

  const variationNames = (experiment.variations ?? []).map((v) => v.name);

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

/** Derives stable leaf ids from per-leaf targeting conditions. */
export function leafWeightsFromContextualBanditResult(
  experimentId: string,
  result: ContextualBanditResult,
): { contextId: string; weights: number[] }[] {
  return result.responses
    .filter((r) => r.updatedWeights != null && r.updatedWeights.length > 0)
    .map((r) => ({
      contextId: deriveContextId(experimentId, r.context),
      weights: r.updatedWeights!,
    }));
}

/** True when any leaf's updated weights differ from the current phase weights. */
export function contextualBanditWeightsWereUpdated(
  result: ContextualBanditResult,
  experimentId: string,
  currentLeafWeights: { contextId: string; weights: number[] }[],
): boolean {
  const currentByContext = Object.fromEntries(
    currentLeafWeights.map((lw) => [lw.contextId, lw.weights]),
  );

  return result.responses.some((r) => {
    if (r.error || !r.updatedWeights?.length) {
      return false;
    }
    const contextId = deriveContextId(experimentId, r.context);
    const current = currentByContext[contextId];
    if (!current) {
      return true;
    }
    return JSON.stringify(current) !== JSON.stringify(r.updatedWeights);
  });
}

/**
 * Persists the result of one CB run to Mongo and fans out the side effects.
 *
 * Called from `ContextualBanditResultsQueryRunner.updateModel` on the
 * `succeeded` transition. The runner owns the CBS status / `queries` /
 * `runStarted` / `contextualBanditEventId` writes; this function only owns
 * the artifacts that aren't part of the CBS doc itself (CBE create, parent
 * CB patch, SDK payload refresh).
 *
 * Responsibilities (in order):
 *   1. Create a new ContextualBanditEvent doc with the stats engine output.
 *   2. Patch the parent CB doc's `phases[phase].currentLeafWeights`.
 *   3. Fire SDK payload refresh so live SDKs pick up the new weights.
 *
 * SMITH: every new Python output field needs two synchronized updates:
 *   - the CBE create payload below, AND
 *   - the validators in shared/src/validators/contextual-bandit-event.ts.
 * Keep the function signature stable — the query runner depends on it.
 */
export async function persistContextualBanditEvent(
  context: ReqContext,
  cbs: ContextualBanditSnapshotInterface,
  result: ContextualBanditResult,
): Promise<ContextualBanditEventInterface> {
  const cb = await context.models.contextualBandits.getByExperimentId(
    cbs.experiment,
  );
  if (!cb) {
    throw new Error(`No CB doc for experiment ${cbs.experiment}`);
  }

  const experiment = await getExperimentById(context, cbs.experiment);
  if (!experiment) {
    throw new Error(`No experiment doc for ${cbs.experiment}`);
  }

  const currentLeafWeights = cb.phases[cbs.phase]?.currentLeafWeights ?? [];
  const weightsWereUpdated = contextualBanditWeightsWereUpdated(
    result,
    cbs.experiment,
    currentLeafWeights,
  );
  const leafWeights = leafWeightsFromContextualBanditResult(
    cbs.experiment,
    result,
  );

  // 1. Create CBE doc
  const cbe = await context.models.contextualBanditEvents.create({
    experiment: cbs.experiment,
    phase: cbs.phase,
    snapshotId: cbs.id,
    attributes: result.attributes,
    responses: result.responses,
    leaf_map: result.leaf_map,
    weightsWereUpdated,
  });

  // 2. Patch parent CB doc's per-phase weights
  if (leafWeights.length > 0) {
    await context.models.contextualBandits.patchPhaseWeights(
      cb.id,
      cbs.phase,
      leafWeights,
    );
  }

  // 3. Refresh SDK payload so live clients pick up the new weights
  const payloadKeys = getPayloadKeys(context, experiment);
  if (payloadKeys.length > 0) {
    queueSDKPayloadRefresh({
      context,
      payloadKeys,
      auditContext: {
        event: "contextual-bandit.refresh",
        model: "experiment",
        id: cbs.experiment,
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

/**
 * Pure transform: builds the frozen snapshot settings persisted on the CBS doc.
 *
 * Mirrors the *shape* of `ExperimentSnapshotSettings` for the fields that
 * apply, but is intentionally a separate type. Notably: no `guardrailMetrics`
 * (CB has a single decision metric in MVP, and the validator's `.strict()`
 * rejects it anyway).
 *
 * The output is what gets stored in `CBS.frozenSettings` so a run is
 * reproducible even if the parent CB doc mutates later.
 */
export function buildContextualBanditSnapshotSettings(
  cb: ContextualBanditInterface,
  experiment: ExperimentInterface,
  phase: number,
  exposureQuery: ExposureQuery,
  regressionAdjustmentEnabled: boolean,
): ContextualBanditSnapshotSettings {
  const cbPhase = cb.phases[phase];
  const expPhase = experiment.phases?.[phase];
  const numVariations = experiment.variations?.length || 1;

  return {
    experimentId: experiment.id,
    trackingKey: experiment.trackingKey || experiment.id,
    contextualBanditId: cb.id,
    phase,

    datasourceId: cb.datasourceId,
    exposureQueryId: cb.exposureQueryId,
    contextualAttributes:
      exposureQuery.targetingAttributeColumns ?? cb.contextualAttributes,

    goalMetrics: experiment.goalMetrics ?? [],
    secondaryMetrics: experiment.secondaryMetrics ?? [],
    // TODO(D1.1): mirror `getMetricForSnapshot` from services/experiments.ts
    // and produce a typed MetricForSnapshot[]. For now we key the raw
    // overrides by metric id to satisfy `z.record(z.string(), z.unknown())`.
    metricSettings: Object.fromEntries(
      (experiment.metricOverrides ?? []).map((m) => [m.id, m]),
    ),

    variations: (experiment.variations ?? []).map((v, i) => ({
      id: v.id,
      weight: expPhase?.variationWeights?.[i] ?? 1 / numVariations,
    })),

    maxContexts: cb.maxContexts,
    // `cb.treeModel` is typed as `z.string()` on the CB validator; narrow
    // defensively so the strict snapshot validator never trips on a stray
    // legacy/free-form value.
    treeModel:
      cb.treeModel === "linear_thompson"
        ? "linear_thompson"
        : "regression_tree",
    minUsersPerLeaf: cb.minUsersPerLeaf,
    maxLeaves: cb.maxLeaves,
    canonicalFormVersion: cb.canonicalFormVersion,

    regressionAdjustmentEnabled,

    startDate: cbPhase?.dateStarted ?? new Date(),
    endDate: cbPhase?.dateEnded ?? null,
    reweight: true,
    banditWeightsSeed: phase,

    // TODO(holdout-v1.5): `holdoutPercent` (and likely a holdout seed) will
    // need to be threaded into the frozen snapshot settings so the SQL runner
    // can split traffic into train_id=0 (holdout) and train_id=1 (bandit)
    // buckets, and the stats engine can compute a holdout-vs-bandit lift
    // comparison alongside the per-leaf weights. See
    // contextual-bandit-fix-prompt.md for the full plug-in list.
  };
}

/**
 * Translates the parallel-pipeline `ContextualBanditSnapshotSettings` into the
 * shape `SqlIntegration.getExperimentMetricQuery` expects.
 *
 * Sets `banditSettings.banditIsContextual = true` and
 * `banditSettings.targetingAttributeColumns` so the contextual-bandit CTEs in
 * `contextual-bandit-experiment-units-cte.ts` fire on the warehouse side.
 *
 * The source of `banditIsContextual` is the CB snapshot doc — NOT
 * `ExperimentInterface.banditIsContextual`, which was migrated to
 * `experiment.type === "contextual-bandit"` in `util/migrations.ts:760-774`.
 */
export function buildExperimentSnapshotSettingsForCb(
  cbSnapshotSettings: ContextualBanditSnapshotSettings,
): ExperimentSnapshotSettings {
  const decisionMetric = cbSnapshotSettings.goalMetrics[0] ?? "";
  return {
    experimentId: cbSnapshotSettings.trackingKey,
    queryFilter: "",
    datasourceId: cbSnapshotSettings.datasourceId,
    exposureQueryId: cbSnapshotSettings.exposureQueryId,
    startDate: cbSnapshotSettings.startDate,
    endDate: cbSnapshotSettings.endDate ?? new Date(),
    goalMetrics: cbSnapshotSettings.goalMetrics,
    secondaryMetrics: cbSnapshotSettings.secondaryMetrics,
    guardrailMetrics: [],
    activationMetric: null,
    // The CB-side `metricSettings` is a loose `Record<string, unknown>` keyed
    // by metric id; the standard pipeline expects an array of typed
    // `MetricForSnapshot` entries. CB v1 doesn't apply per-metric overrides
    // at SQL gen time, so an empty array is the safe default. Tighten when
    // CB plan D1.1 lands.
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
      banditIsContextual: true,
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

/**
 * Whether updated contextual bandit variation weights are computed by the
 * Python stats engine (`true`) or in TypeScript by
 * `computeContextualBanditWeights` (`false`). Hardcoded for now; flip to
 * `false` to use the TypeScript path.
 */
const UPDATE_WEIGHTS_USING_PYTHON = false;

/**
 * Builds the settings object passed to the stats engine.
 */
export function getContextualBanditSettingsForStatsEngine(
  cb: ContextualBanditInterface,
  phase: number,
  variations: { id: string; name: string }[],
  currentWeightsByContext: Record<string, number[]>,
): ContextualBanditSettingsForStatsEngine {
  return {
    var_names: variations.map((v) => v.name),
    var_ids: variations.map((v) => v.id),
    reweight: true,
    bandit_weights_seed: phase,
    contextual_attributes: cb.contextualAttributes,
    current_weights_by_context: currentWeightsByContext,
    max_leaves: cb.maxLeaves,
    min_users_per_leaf: cb.minUsersPerLeaf,
    update_weights_using_python: UPDATE_WEIGHTS_USING_PYTHON,
  };
}
