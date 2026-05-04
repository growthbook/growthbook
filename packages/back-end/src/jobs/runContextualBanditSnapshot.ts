/**
 * Contextual Bandit snapshot orchestrator (P4.2).
 *
 * Inputs: a CB-flagged ExperimentInterface + phase index + opts (reweight).
 *
 * Pipeline:
 *   1. Load CBAQ + datasource integration
 *   2. Validate that all active attributes are present in a sample of rows
 *   3. Generate the CTE chain via getContextualBanditDimensionSql + run it
 *   4. POST the aggregated rows to the python stats engine
 *      (`process_contextual_bandit_results` entrypoint)
 *   5. Cap result to CONTEXTUAL_BANDIT_EVENT_CELL_CAP (3000) by trimming the
 *      least-populated contexts to the residual "other" bucket
 *   6. Persist a ContextualBanditEvent (CBE)
 *   7. Update phase.currentLeafWeights + phase.lastContextualBanditEventId,
 *      and re-randomize a new bandit seed for the next run
 *   8. Optionally update the snapshot row (if provided)
 *   9. Emit `experiment.contextual_bandit.*` webhook events
 *
 * The python call is routed through the existing `statsServerPool` with a
 * `kind: "contextual_bandit"` discriminator (see stats_server.py).
 */

import {
  CONTEXTUAL_BANDIT_EVENT_CELL_CAP,
  ContextResult,
  ContextualBanditEventInterface,
  TreeSummary,
} from "shared/validators";
import {
  ExperimentInterface,
  ExperimentPhase,
  LeafWeight,
} from "shared/validators/experiments";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import {
  getContextualBanditDimensionSql,
  CbaqDialect,
} from "back-end/src/integrations/contextualBanditSql";
import { validateContextualAttributesInPayload } from "back-end/src/services/stats";
import { statsServerPool } from "back-end/src/services/python";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { createEvent } from "back-end/src/models/EventModel";

export interface RunContextualBanditOptions {
  reweight?: boolean;
  /** Optional snapshot id to back-link the CBE to an enclosing snapshot row. */
  snapshotId?: string;
  /** Override the default tick-time (mainly for tests). */
  now?: Date;
}

export interface ContextualBanditSnapshotResult {
  event: ContextualBanditEventInterface;
  weightsWereUpdated: boolean;
  trimmedContexts: number;
  warnings: string[];
}

export async function runContextualBanditSnapshot({
  context,
  experiment,
  phaseIndex,
  opts = {},
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  phaseIndex: number;
  opts?: RunContextualBanditOptions;
}): Promise<ContextualBanditSnapshotResult> {
  if (!experiment.isContextualBandit) {
    throw new Error(
      "runContextualBanditSnapshot called on non-CB experiment " + experiment.id,
    );
  }
  const phase = experiment.phases[phaseIndex];
  if (!phase) throw new Error(`Invalid phase index ${phaseIndex}`);
  if (!experiment.cbaqId) {
    throw new Error("Experiment is missing a contextual bandit query id");
  }

  const cbaq = await context.models.contextualBanditQueries.getById(
    experiment.cbaqId,
  );
  if (!cbaq) {
    throw new Error(`CBAQ ${experiment.cbaqId} not found`);
  }

  const datasource = await getDataSourceById(context, cbaq.datasource);
  if (!datasource) {
    throw new Error(`Datasource ${cbaq.datasource} not found`);
  }

  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!integration.runTestQuery) {
    throw new Error(
      `Datasource ${datasource.id} does not support runTestQuery`,
    );
  }

  // Step 2: Sample + validate contextual attribute coverage. We pull a small
  // sample of the CBAQ output and check that the configured columns exist.
  const activeAttrs = cbaq.attributes.filter((a) => !a.deleted);
  if (activeAttrs.length === 0) {
    throw new Error(
      `CBAQ ${cbaq.id} has no active attributes; cannot run a contextual bandit snapshot`,
    );
  }

  const warnings: string[] = [];
  let sampleRows: Record<string, unknown>[] = [];
  try {
    const sampleSql = `SELECT * FROM (\n${cbaq.sql}\n) cbaq_sample LIMIT 5000`;
    const result = await integration.runTestQuery(
      sampleSql,
      [],
      "cbaqSample",
    );
    sampleRows = result.results;
  } catch (e) {
    throw new Error(
      `Failed to sample CBAQ ${cbaq.id}: ${(e as Error).message}`,
    );
  }
  const validation = validateContextualAttributesInPayload(
    activeAttrs.map((a) => ({
      name: a.name,
      column: a.column,
      deleted: a.deleted,
    })),
    sampleRows,
  );
  if (!validation.ok) {
    throw new Error(
      `CBAQ ${cbaq.id} attribute validation failed: ${validation.error}`,
    );
  }
  if (validation.ok && validation.warnings?.length) {
    for (const w of validation.warnings) {
      warnings.push(
        `High null rate (${(w.nullRate * 100).toFixed(1)}%) for column ${w.column}`,
      );
    }
  }

  // Step 3: Generate + run the aggregation SQL.
  const dialect = inferDialect(datasource.type);
  const aggSql = getContextualBanditDimensionSql({
    dialect,
    cbaqSql: cbaq.sql,
    metricValueColumn: "value",
    variationColumn: "variation",
    attributes: activeAttrs.map((a) => ({
      name: a.name,
      column: a.column,
      datatype: a.datatype,
      topValues: a.topValues,
    })),
  });

  let aggregatedRows: AggregatedCbRow[] = [];
  try {
    const result = await integration.runTestQuery(aggSql, [], "cbAggregate");
    aggregatedRows = (result.results as Record<string, unknown>[]).map(
      (row) => ({
        context_id: String(row.context_id ?? ""),
        variation: String(row.variation ?? ""),
        n: Number(row.n ?? 0),
        main_sum: Number(row.main_sum ?? 0),
        main_sum_squares: Number(row.main_sum_squares ?? 0),
      }),
    );
  } catch (e) {
    throw new Error(
      `Failed to run contextual bandit aggregation SQL: ${(e as Error).message}`,
    );
  }

  // Step 5 (early): hard cap on (contexts × variations). We trim the
  // smallest contexts into "other" to keep the python stats engine within
  // the 3000-cell budget.
  const variationKeys = Array.from(
    new Set(aggregatedRows.map((r) => r.variation)),
  ).sort();
  const variationCount = variationKeys.length || experiment.variations.length;
  const { rows: cappedRows, trimmedContexts } = capContexts(
    aggregatedRows,
    variationCount,
    CONTEXTUAL_BANDIT_EVENT_CELL_CAP,
  );

  // Step 4: stats engine.
  const seed =
    phase.lastContextualBanditEventId
      ? Math.floor(Math.random() * 1_000_000)
      : Math.floor(Math.random() * 1_000_000);

  const enginePayload: ContextualBanditEnginePayload = {
    rows: cappedRows.map((r) => ({
      context_id: r.context_id,
      variation: r.variation,
      n: r.n,
      main_sum: r.main_sum,
      main_sum_squares: r.main_sum_squares,
    })),
    settings: {
      var_id_map: Object.fromEntries(
        experiment.variations.map((v, i) => [v.key || String(i), i]),
      ),
      var_names: experiment.variations.map((v) => v.name),
      weights: phase.variationWeights,
      bandit_weights_seed: seed,
      reweight: !!opts.reweight,
      decision_metric: experiment.goalMetrics?.[0] ?? "",
      contextual_attributes: activeAttrs.map((a) => a.name),
      current_weights_by_context: collectCurrentWeightsByContext(phase),
      max_leaves: experiment.contextualBanditConfig?.maxContexts ?? 12,
      min_users_per_leaf:
        experiment.contextualBanditConfig?.minUsersPerLeaf ?? 100,
      tree_model:
        experiment.contextualBanditConfig?.treeModel ?? "regression_tree",
    },
  };

  let engineResult: ContextualBanditEngineResult;
  try {
    engineResult = await postToContextualBanditEngine(enginePayload);
  } catch (e) {
    throw new Error(
      `Contextual bandit stats engine failed: ${(e as Error).message}`,
    );
  }

  // Step 6: persist a ContextualBanditEvent.
  const now = opts.now ?? new Date();
  const cbe: Omit<
    ContextualBanditEventInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  > = {
    experiment: experiment.id,
    phase: phaseIndex,
    snapshotId: opts.snapshotId,
    date: now,
    cbaqId: cbaq.id,
    contextResults: engineResult.context_results,
    tree: engineResult.tree,
    updateMessage: engineResult.update_message,
    error: engineResult.error,
    weightsWereUpdated: !!engineResult.weights_were_updated,
    reweight: !!opts.reweight,
    bestArmProbabilitiesByLeaf: engineResult.best_arm_probabilities_by_leaf,
    seed,
  };

  const created = await context.models.contextualBanditEvents.create(cbe);

  // Step 7: stamp current leaf weights onto the phase.
  if (cbe.weightsWereUpdated) {
    const newCurrentLeafWeights = leafWeightsFromTree(engineResult.tree);
    const updatedPhases = experiment.phases.map((p, idx) =>
      idx === phaseIndex
        ? {
            ...p,
            currentLeafWeights: newCurrentLeafWeights,
            lastContextualBanditEventId: created.id,
          }
        : p,
    );
    await updateExperiment({
      context,
      experiment,
      changes: { phases: updatedPhases },
    });
  } else {
    const updatedPhases = experiment.phases.map((p, idx) =>
      idx === phaseIndex
        ? { ...p, lastContextualBanditEventId: created.id }
        : p,
    );
    await updateExperiment({
      context,
      experiment,
      changes: { phases: updatedPhases },
    });
  }

  // Step 9: webhook events. (P6.6 attaches the formal payload schemas to
  // these names; subscribers receive the envelope and fetch event details
  // via the read-only ContextualBanditEvent API.)
  await emitContextualBanditWebhooks({
    context,
    experiment,
    event: created,
    weightsWereUpdated: !!cbe.weightsWereUpdated,
    coverageWarnings: warnings,
    trimmedContexts,
  });

  return {
    event: created,
    weightsWereUpdated: !!cbe.weightsWereUpdated,
    trimmedContexts,
    warnings,
  };
}

interface AggregatedCbRow {
  context_id: string;
  variation: string;
  n: number;
  main_sum: number;
  main_sum_squares: number;
}

interface ContextualBanditEnginePayload {
  rows: AggregatedCbRow[];
  settings: {
    var_id_map: Record<string, number>;
    var_names: string[];
    weights: number[];
    bandit_weights_seed: number;
    reweight: boolean;
    decision_metric: string;
    contextual_attributes: string[];
    current_weights_by_context: Record<string, number[]>;
    max_leaves: number;
    min_users_per_leaf: number;
    tree_model: "regression_tree" | "linear_thompson";
  };
}

interface ContextualBanditEngineResult {
  context_results: ContextResult[];
  tree: TreeSummary;
  weights_were_updated?: boolean;
  update_message?: string;
  error?: string;
  best_arm_probabilities_by_leaf?: Record<string, number[]>;
}

async function postToContextualBanditEngine(
  payload: ContextualBanditEnginePayload,
): Promise<ContextualBanditEngineResult> {
  if (process.env.EXTERNAL_PYTHON_SERVER_URL) {
    const res = await fetch(
      `${process.env.EXTERNAL_PYTHON_SERVER_URL}/contextual-bandit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Stats server returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
      );
    }
    const json = (await res.json()) as { results: ContextualBanditEngineResult };
    return json.results;
  }

  // Local (in-process) python pool path. We dispatch via the `kind`
  // discriminator added to stats_server.py.
  const server = (await statsServerPool.acquire()) as unknown as {
    call: (
      data: ContextualBanditEnginePayload,
      kind: string,
    ) => Promise<ContextualBanditEngineResult>;
  };
  try {
    return await server.call(payload, "contextual_bandit");
  } finally {
    statsServerPool.release(server as unknown as Parameters<typeof statsServerPool.release>[0]);
  }
}

/**
 * Trims the least-populated contexts down to a residual "other" entry until
 * `contexts × variations <= cap`. Returns the new aggregated rows + the
 * count of contexts trimmed.
 */
export function capContexts(
  rows: AggregatedCbRow[],
  variationCount: number,
  cap: number,
): { rows: AggregatedCbRow[]; trimmedContexts: number } {
  if (variationCount <= 0) return { rows, trimmedContexts: 0 };
  const totalsByContext = new Map<string, number>();
  for (const r of rows) {
    totalsByContext.set(
      r.context_id,
      (totalsByContext.get(r.context_id) ?? 0) + r.n,
    );
  }
  const allContexts = [...totalsByContext.keys()];
  const maxContexts = Math.max(1, Math.floor(cap / variationCount));
  if (allContexts.length <= maxContexts) {
    return { rows, trimmedContexts: 0 };
  }

  // Keep the top (maxContexts - 1) contexts, lump the rest into "other".
  const sorted = [...allContexts].sort(
    (a, b) => (totalsByContext.get(b) ?? 0) - (totalsByContext.get(a) ?? 0),
  );
  const keep = new Set(sorted.slice(0, maxContexts - 1));
  const otherKey = "other";
  const merged = new Map<string, AggregatedCbRow>();
  for (const r of rows) {
    const ctx = keep.has(r.context_id) ? r.context_id : otherKey;
    const k = `${ctx}|${r.variation}`;
    const existing = merged.get(k);
    if (existing) {
      existing.n += r.n;
      existing.main_sum += r.main_sum;
      existing.main_sum_squares += r.main_sum_squares;
    } else {
      merged.set(k, { ...r, context_id: ctx });
    }
  }
  return {
    rows: [...merged.values()],
    trimmedContexts: allContexts.length - maxContexts + 1,
  };
}

function collectCurrentWeightsByContext(
  phase: ExperimentPhase,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const lw of phase.currentLeafWeights ?? []) {
    for (const cid of lw.contextIds) {
      out[cid] = lw.weights;
    }
  }
  return out;
}

function leafWeightsFromTree(tree: TreeSummary): LeafWeight[] {
  return tree.leaves.map((leaf) => ({
    leafId: leaf.leafId,
    rule: leaf.rule,
    condition: leaf.condition,
    weights: leaf.weights,
    contextIds: leaf.contextIds,
  }));
}

function inferDialect(datasourceType: string): CbaqDialect {
  switch (datasourceType) {
    case "postgres":
    case "vertica":
      return "postgres";
    case "redshift":
      return "redshift";
    case "snowflake":
      return "snowflake";
    case "bigquery":
      return "bigquery";
    case "databricks":
    case "athena":
      return "databricks";
    case "mysql":
    case "clickhouse":
      return "mysql";
    case "mssql":
      return "mssql";
    default:
      // Fall back to postgres-style portable SQL.
      return "postgres";
  }
}

async function emitContextualBanditWebhooks({
  context,
  experiment,
  event,
  weightsWereUpdated,
  coverageWarnings,
  trimmedContexts,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  event: ContextualBanditEventInterface;
  weightsWereUpdated: boolean;
  coverageWarnings: string[];
  trimmedContexts: number;
}) {
  const baseRef = {
    experimentId: experiment.id,
    cbaqId: event.cbaqId,
    contextualBanditEventId: event.id,
    snapshotId: event.snapshotId,
    phase: event.phase,
    date: event.date.toISOString(),
  };
  const projects = experiment.project ? [experiment.project] : [];
  const tags = experiment.tags || [];

  try {
    await createEvent({
      context: context as ReqContext,
      object: "experiment",
      objectId: experiment.id,
      event: "contextual_bandit.snapshot.completed",
      data: {
        object: {
          ...baseRef,
          weightsWereUpdated,
          reweight: !!event.reweight,
          trimmedContexts,
          warnings: coverageWarnings.length ? coverageWarnings : undefined,
          error: event.error,
        },
      },
      projects,
      tags,
      environments: [],
      containsSecrets: false,
    });
  } catch (e) {
    logger.warn(e, "failed to emit contextual_bandit.snapshot.completed");
  }

  if (weightsWereUpdated) {
    try {
      await createEvent({
        context: context as ReqContext,
        object: "experiment",
        objectId: experiment.id,
        event: "contextual_bandit.weights.updated",
        data: {
          object: {
            ...baseRef,
            leafCount: event.tree.leaves.length,
            variationCount:
              event.tree.leaves[0]?.weights.length ??
              experiment.variations.length,
          },
        },
        projects,
        tags,
        environments: [],
        containsSecrets: false,
      });
    } catch (e) {
      logger.warn(e, "failed to emit contextual_bandit.weights.updated");
    }
  }

  if (coverageWarnings.length > 0) {
    try {
      await createEvent({
        context: context as ReqContext,
        object: "experiment",
        objectId: experiment.id,
        event: "contextual_bandit.attribute_coverage_degraded",
        data: {
          object: {
            ...baseRef,
            attributes: coverageWarnings.map((w) => {
              // Warning strings are formatted as "High null rate (X.X%) for column Y"
              const match = /\(([\d.]+)%\) for column (.+)$/.exec(w);
              return match
                ? { column: match[2], nullRate: Number(match[1]) / 100 }
                : { column: "unknown", nullRate: 1 };
            }),
          },
        },
        projects,
        tags,
        environments: [],
        containsSecrets: false,
      });
    } catch (e) {
      logger.warn(
        e,
        "failed to emit contextual_bandit.attribute_coverage_degraded",
      );
    }
  }
}
