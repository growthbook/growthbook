import { ExperimentInterface } from "shared/types/experiment";
import {
  ContextualBanditInterface,
  ContextualBanditSnapshotSettings,
} from "shared/validators";
import { deriveContextId } from "shared/util";
import { ExposureQuery } from "shared/types/datasource";
import { ReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getPayloadKeys } from "back-end/src/models/ExperimentModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { runContextualBanditQuery } from "./contextualBanditSql";
import {
  runContextualStatsEngine,
  ContextualBanditSettingsForStatsEngine,
} from "./contextualBanditStats";

export async function runContextualBanditSnapshot(
  context: ReqContext,
  experiment: ExperimentInterface,
  phase: number,
  opts: { triggeredBy: "manual" | "scheduled"; triggeredByUser?: string },
): Promise<{ snapshotId: string; cbeId?: string }> {
  // 1. Load CB doc
  const cb = await context.contextualBandits.getByExperimentId(experiment.id);
  if (!cb) throw new Error(`No CB doc for experiment ${experiment.id}`);

  // 2. Open CBS in "running"
  const cbs = await context.contextualBanditSnapshots.create({
    experiment: experiment.id,
    phase,
    status: "running",
    queries: [],
    triggeredBy: opts.triggeredBy === "manual" ? "manual" : "schedule",
    weightsWereUpdated: false,
  });

  try {
    // 3. Resolve datasource + EAQ + build settings
    const ds = await getDataSourceById(context, cb.datasourceId);
    if (!ds) throw new Error(`Datasource missing: ${cb.datasourceId}`);

    const eaq = ds.settings?.queries?.exposure?.find(
      (q) => q.id === cb.exposureQueryId,
    );
    if (!eaq) throw new Error(`EAQ missing: ${cb.exposureQueryId}`);

    const latestCBE =
      await context.contextualBanditEvents.getLatestForExperiment(
        experiment.id,
        phase,
      );

    // Freeze the snapshot config first (reproducibility — survives later CB doc mutations)
    const snapshotSettings = buildContextualBanditSnapshotSettings(
      cb,
      experiment,
      phase,
      eaq,
    );

    await context.contextualBanditSnapshots.updateById(cbs.id, {
      frozenSettings: snapshotSettings,
      queries: [{ query: "contextual-bandit-sql", status: "running" }],
    });

    // Stats-engine input — derived from CB doc + latest CBE weights
    const statsSettings = getContextualBanditSettingsForStatsEngine(
      cb,
      phase,
      experiment,
      latestCBE
        ? Object.fromEntries(
            latestCBE.tree?.leaves.map((l) => [l.contextId, l.weights]) ?? [],
          )
        : {},
    );

    // 4. Run SQL (STUB — Luke replaces with real SQL gen + execution)
    const rows = await runContextualBanditQuery(context, cb, ds, eaq);
    await context.contextualBanditSnapshots.updateById(cbs.id, {
      queries: [
        {
          query: "contextual-bandit-sql",
          status: "succeeded",
          durationMs: 0,
        },
      ],
    });

    // 5. Tag rows with contextIds
    const tagged = rows.map((r) => ({
      ...r,
      contextId: deriveContextId(
        experiment.id,
        attributesToCondition(r.attributes),
      ),
    }));

    // 6. Enforce Mongo cap (contexts × variations ≤ 3000)
    const { rows: trimmed } = enforceContextCap(
      tagged,
      cb.maxContexts,
      experiment.variations?.length ?? 2,
    );

    // 7. Call stats engine (STUB — Luke replaces with real Python call)
    const result = await runContextualStatsEngine(statsSettings, trimmed);

    // 8. Persist CBE
    const cbe = await context.contextualBanditEvents.create({
      experiment: experiment.id,
      phase,
      snapshotId: cbs.id,
      contextResults: result.contextResults,
      tree: result.tree,
      weightsWereUpdated: result.weightsWereUpdated,
    });

    // 9. Update CB doc's phase weights
    await context.contextualBandits.patchPhaseWeights(
      cb.id,
      phase,
      result.tree.leaves.map((l) => ({
        contextId: l.contextId,
        weights: l.weights,
      })),
    );

    // 10. Refresh SDK payload + close CBS
    const payloadKeys = getPayloadKeys(context, experiment);
    if (payloadKeys.length > 0) {
      queueSDKPayloadRefresh({
        context,
        payloadKeys,
        auditContext: {
          event: "contextual-bandit.refresh",
          model: "experiment",
          id: experiment.id,
        },
      });
    }

    await context.contextualBanditSnapshots.updateById(cbs.id, {
      status: "success",
      contextualBanditEventId: cbe.id,
      weightsWereUpdated: result.weightsWereUpdated,
    });

    return { snapshotId: cbs.id, cbeId: cbe.id };
  } catch (e) {
    await context.contextualBanditSnapshots.updateById(cbs.id, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
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
  };
}

/**
 * Builds the settings object passed to the stats engine.
 */
export function getContextualBanditSettingsForStatsEngine(
  cb: ContextualBanditInterface,
  phase: number,
  experiment: ExperimentInterface,
  currentWeightsByContext: Record<string, number[]>,
): ContextualBanditSettingsForStatsEngine {
  const varNames = experiment.variations?.map((v) => v.name) ?? [];
  const varIds = experiment.variations?.map((v) => v.id) ?? [];

  return {
    var_names: varNames,
    var_ids: varIds,
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
