import { ExperimentInterface } from "shared/types/experiment";
import { ContextualBanditInterface } from "shared/validators";
import { deriveContextId } from "shared/util";
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

    const settings = getContextualBanditSettingsForStatsEngine(
      cb,
      phase,
      experiment,
      latestCBE
        ? Object.fromEntries(
            latestCBE.tree?.leaves.map((l) => [l.contextId, l.weights]) ?? [],
          )
        : {},
    );

    await context.contextualBanditSnapshots.updateById(cbs.id, {
      frozenSettings: settings as Record<string, unknown>,
      queries: [{ query: "contextual-bandit-sql", status: "running" }],
    });

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
    const result = await runContextualStatsEngine(settings, trimmed);

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
