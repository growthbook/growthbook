import { ExperimentAggregateUnitsQueryResponseRows } from "shared/types/integrations";
import {
  ExperimentSnapshotTraffic,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import { analyzeExperimentTraffic } from "back-end/src/services/stats";
import { logger } from "back-end/src/util/logger";

/**
 * Outcome of one isolated `runAnalysis` step. `error === null` is the success
 * discriminator, so a step whose own return type includes `undefined` (e.g.
 * `analyzeExperimentPower`) is still distinguishable from a failure.
 */
export type AnalysisStepResult<T> =
  | { value: T; error: null }
  | { value: null; error: string };

/**
 * Run one step of a runner's `runAnalysis` in isolation.
 *
 * `runAnalysis` assembles its result from several independent steps (metric
 * analysis, then traffic/health, power, covariate imbalance). They all used to
 * run inline, so a throw in a *later* step discarded the result of every earlier
 * one — a power or covariate-imbalance bug threw away metric results that had
 * already computed successfully, and failed the whole snapshot with them
 * (design Q7).
 *
 * Wrapping a step here converts its throw into a value the caller records on
 * that step's own block, leaving the rest of the result intact. The failure is
 * logged with the model id so it is still diagnosable in ops.
 *
 * Deliberately *not* used for the metric-analysis step: if that throws there are
 * no results to persist, so it stays fatal to the snapshot (see the callers).
 *
 * Steps are synchronous CPU work in all three runners, so this is sync too.
 */
export function runIsolatedAnalysisStep<T>({
  step,
  modelId,
  run,
}: {
  /** Step name, used only for the log line. */
  step: string;
  modelId: string;
  run: () => T;
}): AnalysisStepResult<T> {
  try {
    return { value: run(), error: null };
  } catch (e) {
    logger.error(e, `${modelId} runner: "${step}" analysis step failed`);
    return {
      value: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * The traffic/health step, isolated. Shared by all three runners because
 * `ExperimentSnapshotHealth.traffic` is non-optional: on failure the block still
 * has to exist, so it is re-derived from the step's own error — which produces
 * exactly the empty-with-error shape `analyzeExperimentTraffic` already returns
 * for a *failed traffic query*, and which the Health tab already renders.
 *
 * `error` is non-null when the step itself threw; callers use it to skip work
 * derived from the traffic health (power analysis in particular) rather than
 * computing it from the zero-filled placeholder.
 */
export function runTrafficAnalysisStep({
  modelId,
  rows,
  queryError,
  variations,
}: {
  modelId: string;
  rows: ExperimentAggregateUnitsQueryResponseRows;
  /** Error of the traffic query itself, which `analyzeExperimentTraffic` folds into its result. */
  queryError?: string;
  variations: SnapshotSettingsVariation[];
}): { traffic: ExperimentSnapshotTraffic; error: string | null } {
  const step = runIsolatedAnalysisStep({
    step: "traffic",
    modelId,
    run: () =>
      analyzeExperimentTraffic({ rows, error: queryError, variations }),
  });

  if (step.error === null) return { traffic: step.value, error: null };

  return {
    // Safe from re-throwing: given an error, analyzeExperimentTraffic returns
    // before it looks at `rows` at all.
    traffic: analyzeExperimentTraffic({
      rows: [],
      error: step.error,
      variations,
    }),
    error: step.error,
  };
}
