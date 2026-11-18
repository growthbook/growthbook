import isEqual from "lodash/isEqual";
import { DEFAULT_NEW_METRICS_ONLY_UPDATE_WINDOW_MINUTES } from "shared/constants";
import { getMetricRefresh } from "shared/experiments";
import type { ExperimentInterface } from "shared/types/experiment";
import type { DataSourceInterface } from "shared/types/datasource";
import { postExperimentSnapshotValidator } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import {
  createExperimentSnapshot,
  createExperimentSnapshotFromPlan,
  planExperimentSnapshot,
  PlannedExperimentSnapshot,
} from "back-end/src/services/experiments";
import { validateSnapshotDimension } from "back-end/src/services/snapshotDimension";
import { toApiExperimentSnapshot } from "back-end/src/api/snapshots/toApiExperimentSnapshot";
import {
  BadRequestError,
  DimensionAlreadyUpToDateError,
  ExperimentIncrementalPipelineRequiresFullRefreshError,
  MetricRefreshOutsideWindowError,
  MetricRefreshUnavailableError,
  MetricsAlreadyUpToDateError,
  NotFoundError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";
import type { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";

const REQUIRES_FULL_REFRESH_RESUBMIT_INSTRUCTIONS =
  'Send "dimension": "" to rebuild Overall Results, wait for that snapshot to finish, then resubmit this request unchanged.';
const DIMENSION_ALREADY_UP_TO_DATE_RESUBMIT_INSTRUCTIONS =
  'Send "dimension": "" to update Overall Results, wait for that snapshot to finish, then resubmit this request.';

/**
 * - "auto": update only the newly added metrics when the last full update is
 *   recent enough, otherwise a normal update.
 * - "missing": update only the newly added metrics, or refuse.
 * - "all": a normal update.
 */
type NewMetricsUpdateMode = "auto" | "missing" | "all";

function getNewMetricsUpdateMode({
  missingMetricsOnly,
  dimension,
  triggeredBy,
  windowMinutes,
}: {
  missingMetricsOnly: boolean | undefined;
  dimension: string | undefined;
  triggeredBy: "manual" | "schedule" | undefined;
  windowMinutes: number;
}): NewMetricsUpdateMode {
  const otherUpdateRequested = !!dimension || triggeredBy === "schedule";
  if (missingMetricsOnly === true) {
    if (otherUpdateRequested) {
      throw new BadRequestError(
        '"missingMetricsOnly" cannot be combined with "dimension" or with "triggeredBy": "schedule".',
      );
    }
    return "missing";
  }
  if (
    missingMetricsOnly === false ||
    otherUpdateRequested ||
    windowMinutes <= 0
  ) {
    return "all";
  }
  return "auto";
}

const isNewMetricsOnlyRefusal = (error: unknown): boolean =>
  error instanceof ExperimentIncrementalPipelineRequiresFullRefreshError ||
  error instanceof MetricRefreshUnavailableError ||
  error instanceof MetricsAlreadyUpToDateError ||
  error instanceof SnapshotInProgressError ||
  error instanceof MetricRefreshOutsideWindowError;

async function updateNewMetricsOnlyIfRecent({
  context,
  experiment,
  datasource,
  phase,
  windowMinutes,
}: {
  context: ApiReqContext;
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  phase: number;
  windowMinutes: number;
}): Promise<Awaited<ReturnType<typeof createExperimentSnapshot>> | null> {
  try {
    return await createExperimentSnapshot({
      context,
      experiment,
      datasource,
      phase,
      dimension: undefined,
      useCache: true,
      missingMetricsOnly: true,
      newMetricsOnlyWindow: { windowMinutes, now: new Date() },
    });
  } catch (error) {
    if (isNewMetricsOnlyRefusal(error)) return null;
    throw error;
  }
}

export const postExperimentSnapshot = createApiRequestHandler(
  postExperimentSnapshotValidator,
)(async (req) => {
  const context = req.context;
  const id = req.params.id;

  const { triggeredBy, dimension, phase } = req.body ?? {};
  const windowMinutes =
    context.org.settings?.newMetricsOnlyUpdateWindowMinutes ??
    DEFAULT_NEW_METRICS_ONLY_UPDATE_WINDOW_MINUTES;
  const mode = getNewMetricsUpdateMode({
    missingMetricsOnly: req.body?.missingMetricsOnly,
    dimension,
    triggeredBy,
    windowMinutes,
  });
  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    throw new NotFoundError("Experiment not found");
  }
  if (!experiment.datasource) {
    throw new Error("No datasource set for experiment");
  }

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    throw new Error(
      `Could not find datasource for this experiment (datasource id: ${experiment.datasource})`,
    );
  }

  if (!req.context.permissions.canCreateExperimentSnapshot(datasource)) {
    req.context.permissions.throwPermissionError();
  }
  // If this endpoint begins to allow new settings, `canCreateExperimentSnapshot`
  // should be updated to check if the user canUpdateExperiment.

  if (experiment.status === "draft") {
    throw new Error(`Experiment is in draft state.`);
  }

  if (!experiment.phases.length) {
    throw new Error(`Experiment has no phases`);
  }

  const phaseIndex = phase ?? experiment.phases.length - 1;
  if (!experiment.phases[phaseIndex]) {
    throw new Error(`Phase ${phaseIndex} not found`);
  }

  if (dimension) {
    await validateSnapshotDimension({
      experiment,
      datasource,
      dimension,
      organization: context.org.id,
      phase: phaseIndex,
    });
  }

  let useCache = true;
  let result: Awaited<ReturnType<typeof createExperimentSnapshot>>;
  const newMetricsOnlyResult =
    mode === "auto"
      ? await updateNewMetricsOnlyIfRecent({
          context,
          experiment,
          datasource,
          phase: phaseIndex,
          windowMinutes,
        })
      : null;

  if (dimension) {
    let plan: PlannedExperimentSnapshot;
    try {
      plan = await planExperimentSnapshot({
        context,
        experiment,
        datasource,
        dimension,
        phase: phaseIndex,
        useCache: true,
        triggeredBy,
        throwIfRequiresFullRefresh: true,
      });
    } catch (error) {
      if (
        error instanceof ExperimentIncrementalPipelineRequiresFullRefreshError
      ) {
        // Rethrow with additional guidance
        throw new ExperimentIncrementalPipelineRequiresFullRefreshError(
          `${error.details.reason} ${REQUIRES_FULL_REFRESH_RESUBMIT_INSTRUCTIONS}`,
        );
      }

      // Otherwise let original error propagate
      throw error;
    }

    // Check if the dimension is already up to date, if it was generated
    // from the latest Overall Results
    const latestDimensionSnapshot = await getLatestSuccessfulSnapshot({
      context,
      experiment: experiment.id,
      phase: phaseIndex,
      dimension,
    });

    if (
      latestDimensionSnapshot &&
      plan.snapshot.sourceSnapshotId &&
      plan.snapshot.sourceSnapshotDateCreated &&
      plan.snapshot.sourceSnapshotId ===
        latestDimensionSnapshot.sourceSnapshotId &&
      plan.snapshot.analyses.every(({ settings }) =>
        latestDimensionSnapshot.analyses?.some(
          (analysis) =>
            analysis.status === "success" &&
            isEqual(analysis.settings, settings),
        ),
      )
    ) {
      const overallResultsAsOf =
        plan.snapshot.sourceSnapshotDateCreated.toISOString();
      throw new DimensionAlreadyUpToDateError(
        `These results were computed from Overall Results as of ${overallResultsAsOf}. ${DIMENSION_ALREADY_UP_TO_DATE_RESUBMIT_INSTRUCTIONS}`,
        overallResultsAsOf,
      );
    }

    result = await createExperimentSnapshotFromPlan({
      plan,
      context,
      experiment,
    });
  } else if (mode === "missing") {
    // No Full Refresh fallback: the caller asked for the cheap path only.
    result = await createExperimentSnapshot({
      context,
      experiment,
      datasource,
      phase: phaseIndex,
      dimension: undefined,
      useCache: true,
      missingMetricsOnly: true,
    });
  } else if (newMetricsOnlyResult) {
    result = newMetricsOnlyResult;
  } else {
    try {
      result = await createExperimentSnapshot({
        context,
        experiment,
        datasource,
        triggeredBy,
        phase: phaseIndex,
        dimension,
        useCache: true,
      });
    } catch (error) {
      if (
        !(
          error instanceof ExperimentIncrementalPipelineRequiresFullRefreshError
        )
      ) {
        throw error;
      }
      // If it requires a full refresh, let's do it automatically.
      logger.info(
        `Experiment ${experiment.id}: ${error.details.reason} Running a Full Refresh automatically.`,
      );
      useCache = false;
      result = await createExperimentSnapshot({
        context,
        experiment,
        datasource,
        triggeredBy,
        phase: phaseIndex,
        dimension,
        useCache: false,
      });
    }
  }
  const { snapshot } = result;

  await req.audit({
    event: "experiment.refresh",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsCreate({
      phase: phaseIndex,
      dimension,
      useCache,
      manual: false,
      ...(getMetricRefresh(snapshot) ? { missingMetricsOnly: true } : {}),
    }),
  });
  return { snapshot: toApiExperimentSnapshot(snapshot) };
});
