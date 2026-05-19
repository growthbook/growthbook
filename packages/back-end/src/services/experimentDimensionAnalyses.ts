import uniqid from "uniqid";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  expandAllSliceMetricsInMap,
  getLatestPhaseVariations,
  isPrecomputedDimension,
} from "shared/experiments";
import { buildAnalysisKey } from "shared/snapshot-analysis-chunks";
import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import {
  getExperimentTimeSeriesContext,
  updateExperimentAnalysisTimeSeries,
} from "back-end/src/services/experimentTimeSeries";
import {
  getTimeSeriesBaseAnalysis,
  getOrCreatePrecomputedDimensionTimeSeriesAnalyses,
} from "back-end/src/services/experimentDimensionTimeSeries";
import {
  createExperimentSnapshotModel,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { getQueryMap } from "back-end/src/queryRunners/QueryRunner";
import { parseUnitDimQueryName } from "back-end/src/queryRunners/unitDimensionQueryNaming";
import { analyzeExperimentResults } from "back-end/src/services/stats";

/**
 * After a successful standard snapshot, runs gbstats analyses for every
 * precomputed dimension on the snapshot so we can persist dimension time series.
 */
export async function runEagerExperimentDimensionAnalyses({
  context,
  experiment,
  experimentSnapshot,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
}) {
  try {
    // Snapshots with dimension (unit dimension) already have their analyses populated
    if (
      experimentSnapshot.dimension !== null &&
      experimentSnapshot.dimension !== ""
    ) {
      return;
    }

    const precomputedDimensions = (
      experimentSnapshot.settings.dimensions ?? []
    ).filter((d) => isPrecomputedDimension(d.id, []));

    if (precomputedDimensions.length === 0) {
      return;
    }

    // We only run eager dimension analyses if we have a compatible base analysis
    if (!getTimeSeriesBaseAnalysis({ analyses: experimentSnapshot.analyses })) {
      return;
    }

    const timeSeriesContext = await getExperimentTimeSeriesContext({
      context,
      experiment,
      experimentSnapshot,
    });

    // Iterate dimensions sequentially
    for (const dim of precomputedDimensions) {
      try {
        const newAnalyses =
          await getOrCreatePrecomputedDimensionTimeSeriesAnalyses(context, {
            experiment,
            snapshot: experimentSnapshot,
            dimensionId: dim.id,
          });

        await updateExperimentAnalysisTimeSeries({
          context,
          experiment,
          experimentSnapshot,
          analyses: newAnalyses,
          allMetricIds: timeSeriesContext.allMetricIds,
          factMetrics: timeSeriesContext.factMetrics,
          factTableMap: timeSeriesContext.factTableMap,
        });
      } catch (err) {
        logger.error(
          {
            err,
            experimentId: experiment.id,
            snapshotId: experimentSnapshot.id,
            dimensionId: dim.id,
          },
          "Eager precomputed dimension analysis failed",
        );
      }
    }
  } catch (err) {
    logger.error(
      {
        err,
        experimentId: experiment.id,
        snapshotId: experimentSnapshot.id,
      },
      "Eager precomputed dimension analyses failed before per-dimension loop",
    );
  }
}

const DERIVE_MAX_ATTEMPTS = 3;

// Terminal status of a derived per-dim snapshot, derived deterministically
// from its source (parent) per-dim query pointers. Never left implicitly
// "running": a still-running source query (shouldn't happen, since the parent
// only reaches success once every query is terminal) is treated as "error" so
// the next parent refresh self-heals rather than stranding a spinner.
export function getDerivedSnapshotStatusFromQueries(
  queries: ExperimentSnapshotInterface["queries"],
): "ready" | "error" {
  const total = queries.length;
  const failed = queries.filter((q) => q.status === "failed").length;
  const running = queries.filter(
    (q) => q.status === "running" || q.status === "queued",
  ).length;
  if (running > 0) return "error";
  if (failed >= total / 2) return "error";
  return "ready";
}

/**
 * After a successful standard snapshot, derive one exploratory snapshot per
 * configured unit dimension from the per-dim metric queries the parent runner
 * already executed against the shared units table. This runs gbstats only —
 * zero new warehouse queries.
 *
 * Derived snapshots are append-only, exactly like every other snapshot: each
 * parent refresh inserts a fresh derived snapshot dated with the *parent's*
 * dateCreated. "Newest parent wins" then falls out of the existing read path
 * (`getLatestSnapshot` sorts by dateCreated desc) and the time-series layer
 * (`dropInvalidAndLimitDataPoints` keeps the newest-dated point per day), so
 * an older overlapping refresh finishing late can't supersede a newer one —
 * no dedupe index or compare-and-swap required.
 */
export async function runEagerUnitDimensionAnalyses({
  context,
  experiment,
  experimentSnapshot,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
}) {
  // Don't derive from a dimensioned or already-derived snapshot
  if (
    experimentSnapshot.dimension !== null &&
    experimentSnapshot.dimension !== ""
  ) {
    return;
  }
  if (experimentSnapshot.type !== "standard") return;
  if (experimentSnapshot.triggeredBy === "eager-unit-dimension") return;
  if (experiment.type === "multi-armed-bandit") return;

  if (
    (experimentSnapshot.settings.precomputedUnitDimensionIds ?? []).length === 0
  )
    return;

  try {
    // Group the parent's per-dim query pointers by dimension. This (not the
    // settings list) is the source of truth for what was actually computed.
    const pointersByDimension = new Map<
      string,
      ExperimentSnapshotInterface["queries"]
    >();
    for (const pointer of experimentSnapshot.queries) {
      const parsed = parseUnitDimQueryName(pointer.name);
      if (!parsed) continue;
      const list = pointersByDimension.get(parsed.dimensionId) ?? [];
      // Rewrite the namespaced name back to the bare metricId / group_N so
      // analyzeExperimentResults resolves it for the derived snapshot.
      list.push({ ...pointer, name: parsed.baseQueryName });
      pointersByDimension.set(parsed.dimensionId, list);
    }

    if (pointersByDimension.size === 0) return;

    const metricGroups = await context.models.metricGroups.getAll();
    const metricMap = await getMetricMap(context);
    const factTableMap = await getFactTableMap(context);
    expandAllSliceMetricsInMap({
      metricMap,
      factTableMap,
      experiment,
      metricGroups,
    });
    const variationNames = getLatestPhaseVariations(experiment).map(
      (v) => v.name,
    );

    // Write the terminal state to the derived snapshot.
    const finalizeDerived = (
      created: ExperimentSnapshotInterface,
      result:
        | { status: "success"; analyses: ExperimentSnapshotAnalysis[] }
        | { status: "error"; error: string },
    ) =>
      updateSnapshot({
        context,
        id: created.id,
        updates:
          result.status === "success"
            ? { status: "success", error: "", analyses: result.analyses }
            : {
                status: "error",
                error: result.error,
                analyses: created.analyses.map((a) => ({
                  ...a,
                  status: "error",
                  error: result.error,
                })),
              },
      });

    for (const [dimensionId, queries] of pointersByDimension.entries()) {
      try {
        const derivedStatus = getDerivedSnapshotStatusFromQueries(queries);

        const analyses: ExperimentSnapshotAnalysis[] =
          experimentSnapshot.analyses.map((a) => ({
            analysisKey: buildAnalysisKey(),
            dateCreated: new Date(),
            results: [],
            settings: a.settings,
            status: "running",
          }));

        const derivedDoc: ExperimentSnapshotInterface = {
          id: uniqid("snp_"),
          organization: experimentSnapshot.organization,
          experiment: experimentSnapshot.experiment,
          phase: experimentSnapshot.phase,
          dimension: dimensionId,
          runStarted: experimentSnapshot.runStarted,
          // Date the derived snapshot with the *parent's* dateCreated, not the
          // derive execution time. This makes "newest parent wins" fall out of
          // the existing read path and time-series per-day dedupe even when an
          // older overlapping refresh finishes its derive after a newer one.
          dateCreated: experimentSnapshot.dateCreated,
          status: "running",
          error: "",
          settings: {
            ...experimentSnapshot.settings,
            dimensions: [{ id: dimensionId }],
            precomputedUnitDimensionIds: [],
          },
          type: "exploratory",
          triggeredBy: "eager-unit-dimension",
          queries,
          analyses,
          unknownVariations: [],
          multipleExposures: 0,
        };

        // Append-only, like every other snapshot: one fresh derived snapshot
        // per parent refresh. No dedupe index or compare-and-swap.
        const created = await createExperimentSnapshotModel({
          context,
          data: derivedDoc,
        });

        if (derivedStatus === "error") {
          await finalizeDerived(created, {
            status: "error",
            error: "One or more per-dimension queries failed",
          });
          continue;
        }

        // Query results are immutable once the parent snapshot succeeded, so
        // load them once. Only gbstats can transiently fail, so the retry
        // loop wraps only analyzeExperimentResults — not this DB read.
        let queryMap: Awaited<ReturnType<typeof getQueryMap>>;
        try {
          queryMap = await getQueryMap(context, created.queries);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          await finalizeDerived(created, { status: "error", error });
          logger.error(
            {
              err,
              experimentId: experiment.id,
              snapshotId: experimentSnapshot.id,
              dimensionId,
            },
            "Eager unit-dim derive failed loading query results",
          );
          continue;
        }

        // Pure gbstats over already-persisted rows — cheap and retryable.
        let lastError: unknown = null;
        let completedAnalyses: ExperimentSnapshotAnalysis[] | null = null;
        for (let attempt = 1; attempt <= DERIVE_MAX_ATTEMPTS; attempt++) {
          try {
            const { results } = await analyzeExperimentResults({
              queryData: queryMap,
              snapshotSettings: created.settings,
              analysisSettings: created.analyses.map((a) => a.settings),
              variationNames,
              metricMap,
            });
            completedAnalyses = created.analyses.map((a, i) => ({
              ...a,
              results: results[i]?.dimensions ?? [],
              status: "success" as const,
              error: undefined,
            }));
            break;
          } catch (err) {
            lastError = err;
          }
        }

        if (completedAnalyses) {
          await finalizeDerived(created, {
            status: "success",
            analyses: completedAnalyses,
          });
        } else {
          const error =
            lastError instanceof Error ? lastError.message : String(lastError);
          await finalizeDerived(created, { status: "error", error });
          logger.error(
            {
              err: lastError,
              experimentId: experiment.id,
              snapshotId: experimentSnapshot.id,
              dimensionId,
            },
            "Eager unit-dim derive failed after retries",
          );
        }
      } catch (err) {
        logger.error(
          {
            err,
            experimentId: experiment.id,
            snapshotId: experimentSnapshot.id,
            dimensionId,
          },
          "Eager unit-dim derive failed for dimension",
        );
      }
    }
  } catch (err) {
    logger.error(
      {
        err,
        experimentId: experiment.id,
        snapshotId: experimentSnapshot.id,
      },
      "Eager unit-dim derive failed before per-dimension loop",
    );
  }
}
