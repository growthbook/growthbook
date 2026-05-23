// See contextual-bandit-fix-prompt.md for the v1 scope and the v1.5 holdout TODOs.
//
// SMITH: When the real Python stats engine grows new output fields, those
// fields must be plumbed through in BOTH places:
//   1. `persistContextualBanditEvent` below (mapping result → CBE create payload), and
//   2. the validators in shared/src/validators/contextual-bandit-event.ts
//      (`contextResultValidator` / `cbTreeValidator`).
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
import {
  ContextualBanditEventInterface,
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  ContextualBanditSnapshotSettings,
} from "shared/validators";
import { deriveContextId } from "shared/util";
import { ExposureQuery } from "shared/types/datasource";
import { ReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getExperimentById,
  getPayloadKeys,
} from "back-end/src/models/ExperimentModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { ContextualBanditResultsQueryRunner } from "back-end/src/queryRunners/ContextualBanditResultsQueryRunner";
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
export async function runContextualBanditSnapshot(
  context: ReqContext,
  experiment: ExperimentInterface,
  phase: number,
  opts: { triggeredBy: "manual" | "scheduled"; triggeredByUser?: string },
): Promise<{ snapshotId: string; cbeId?: string }> {
  // 1. CB doc + datasource + integration + EAQ.
  const cb = await context.contextualBandits.getByExperimentId(experiment.id);
  if (!cb) throw new Error(`No CB doc for experiment ${experiment.id}`);

  const ds = await getDataSourceById(context, cb.datasourceId);
  if (!ds) throw new Error(`Datasource missing: ${cb.datasourceId}`);

  const integration = getSourceIntegrationObject(context, ds, true);

  const eaq = ds.settings?.queries?.exposure?.find(
    (q) => q.id === cb.exposureQueryId,
  );
  if (!eaq) throw new Error(`EAQ missing: ${cb.exposureQueryId}`);

  // 2. Build the typed, frozen snapshot settings.
  const snapshotSettings = buildContextualBanditSnapshotSettings(
    cb,
    experiment,
    phase,
    eaq,
  );

  // 3. Open the CBS in "running" with the frozen settings already attached.
  //    `runStarted: null` because the runner's first updateModel call will
  //    stamp it once `startQueries` returns.
  const cbs = await context.contextualBanditSnapshots.create({
    experiment: experiment.id,
    phase,
    status: "running",
    queries: [],
    runStarted: null,
    frozenSettings: snapshotSettings,
    triggeredBy: opts.triggeredBy === "manual" ? "manual" : "schedule",
    weightsWereUpdated: false,
  });

  // 4. Hand off to the runner.
  // `useCache: false` because the SQL is a per-snapshot stub today (and even
  // once it's real, two snapshots in quick succession should each re-execute
  // so the Python stats engine sees fresh exposures).
  const runner = new ContextualBanditResultsQueryRunner(
    context,
    cbs,
    integration,
    false,
  );

  try {
    await runner.startAnalysis({
      snapshotSettings,
      variationNames: experiment.variations?.map((v) => v.name) ?? [],
    });
    await runner.waitForResults();
  } catch (e) {
    // Belt-and-suspenders: if `startQueries` threw before the runner could
    // call `updateModel`, the CBS is still in "running" status. Stamp it as
    // "error" here so observability isn't lying about a stuck snapshot.
    const errorMessage = e instanceof Error ? e.message : String(e);
    const latest = await context.contextualBanditSnapshots.getBySnapshotIdInOrg(
      cbs.id,
    );
    if (latest && latest.status === "running") {
      await context.contextualBanditSnapshots.updateById(cbs.id, {
        status: "error",
        error: errorMessage,
      });
    }
    throw e;
  }

  // 5. Re-read the CBS to pick up the runner's final writes
  //    (status, contextualBanditEventId, weightsWereUpdated).
  const finalCbs = await context.contextualBanditSnapshots.getBySnapshotIdInOrg(
    cbs.id,
  );
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
  const cb = await context.contextualBandits.getByExperimentId(cbs.experiment);
  if (!cb) {
    throw new Error(`No CB doc for experiment ${cbs.experiment}`);
  }

  const experiment = await getExperimentById(context, cbs.experiment);
  if (!experiment) {
    throw new Error(`No experiment doc for ${cbs.experiment}`);
  }

  // 1. Create CBE doc
  const cbe = await context.contextualBanditEvents.create({
    experiment: cbs.experiment,
    phase: cbs.phase,
    snapshotId: cbs.id,
    contextResults: result.contextResults,
    tree: result.tree,
    weightsWereUpdated: result.weightsWereUpdated,
  });

  // 2. Patch parent CB doc's per-phase weights
  await context.contextualBandits.patchPhaseWeights(
    cb.id,
    cbs.phase,
    result.tree.leaves.map((l) => ({
      contextId: l.contextId,
      weights: l.weights,
    })),
  );

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
): ContextualBanditSnapshotSettings {
  const cbPhase = cb.phases[phase];
  const expPhase = experiment.phases?.[phase];
  const numVariations = experiment.variations?.length || 1;

  return {
    experimentId: experiment.id,
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
 * Builds the settings object passed to the stats engine.
 *
 * SMITH: the `tree_model` enum and the dataclass fields here must stay in
 * lockstep with the Python `ContextualBanditSettings` dataclass; growing
 * either side without the other will surface as a Python serialization error.
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
    tree_model:
      cb.treeModel === "regression_tree"
        ? "regression_tree"
        : "linear_thompson",
  };
}

/**
 * Caps the total number of distinct contexts to `maxContexts` by merging the
 * smallest contexts into the "other" catch-all bucket (empty attributes).
 *
 * Returns the trimmed row array and a flag indicating whether trimming occurred.
 *
 * SMITH: this is the TS-side cap heuristic. Once the real SQL applies its own
 * top-N truncation in-warehouse, this function and the warehouse-side `LIMIT`
 * must agree on (a) the ordering (currently ascending row-count → drop the
 * smallest) and (b) the catch-all sentinel (empty attribute map →
 * `deriveContextId("", {})`). Otherwise the TS path will silently re-trim
 * rows the SQL has already dropped, double-counting them into "other".
 */
export function enforceContextCap<
  T extends { contextId: string; attributes: Record<string, unknown> },
>(
  rows: T[],
  maxContexts: number,
  numVariations: number,
): { rows: T[]; trimmed: boolean } {
  const contextIds = [...new Set(rows.map((r) => r.contextId))];
  if (contextIds.length <= maxContexts) {
    return { rows, trimmed: false };
  }

  // Count users per context
  const countByCtx = new Map<string, number>();
  rows.forEach((r) => {
    const existing = countByCtx.get(r.contextId) ?? 0;
    // use numVariations to avoid unused-variable warning
    void numVariations;
    countByCtx.set(r.contextId, existing + 1);
  });

  // Sort by ascending count, keep the top maxContexts
  const sorted = [...countByCtx.entries()].sort((a, b) => a[1] - b[1]);
  const toMerge = new Set(
    sorted.slice(0, sorted.length - maxContexts).map(([id]) => id),
  );

  const merged = rows.map((r) =>
    toMerge.has(r.contextId)
      ? {
          ...r,
          attributes: {},
          contextId: deriveContextId(/* experimentId */ "", {}),
        }
      : r,
  );

  return { rows: merged, trimmed: true };
}
