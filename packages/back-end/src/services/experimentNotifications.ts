import { includeExperimentInPayload, getSnapshotAnalysis } from "shared/util";
import { getMetricResultStatus } from "shared/experiments";
import { getMultipleExposureHealthData, getSRMHealthData } from "shared/health";
import {
  DEFAULT_MULTIPLE_EXPOSURES_MINIMUM_COUNT,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
} from "shared/constants";
import { StatsEngine } from "back-end/types/stats";
import { Context } from "back-end/src/models/BaseModel";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getExperimentWatchers } from "back-end/src/models/WatchModel";
import { logger } from "back-end/src/util/logger";
import { ensureAndReturn } from "back-end/src/util/types";
import {
  ExperimentSnapshotDocument,
  getDefaultAnalysisResults,
  getLatestSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  ExperimentInterface,
  ExperimentNotification,
} from "back-end/types/experiment";
import { ExperimentReportResultDimension } from "back-end/types/report";
import { ResourceEvents } from "back-end/src/events/base-types";
import {
  getConfidenceLevelsForOrg,
  getEnvironmentIdsFromOrg,
  getMetricDefaultsForOrg,
  getPValueThresholdForOrg,
} from "./organizations";
import { isEmailEnabled, sendExperimentChangesEmail } from "./email";
import { getExperimentMetricById } from "./experiments";

// This ensures that the two types remain equal.

const dispatchEvent = async <T extends ResourceEvents<"experiment">>({
  context,
  experiment,
  event,
  data,
}: {
  context: Context;
  experiment: ExperimentInterface;
  event: T;
  data: CreateEventData<"experiment", T>;
}) => {
  const changedEnvs = includeExperimentInPayload(experiment)
    ? getEnvironmentIdsFromOrg(context.org)
    : [];

  await createEvent({
    context,
    object: "experiment",
    event,
    data,
    objectId: experiment.id,
    projects: experiment.project ? [experiment.project] : [],
    environments: changedEnvs,
    tags: experiment.tags || [],
    containsSecrets: false,
  });
};

export const memoizeNotification = async ({
  context,
  experiment,
  type,
  triggered,
  dispatch,
}: {
  context: Context;
  experiment: ExperimentInterface;
  type: ExperimentNotification;
  triggered: boolean;
  dispatch: () => Promise<void>;
}) => {
  if (triggered && experiment.pastNotifications?.includes(type)) return;
  if (!triggered && !experiment.pastNotifications?.includes(type)) return;

  await dispatch();

  const pastNotifications = triggered
    ? [...(experiment.pastNotifications || []), type]
    : (experiment.pastNotifications || []).filter((t) => t !== type);

  await updateExperiment({
    experiment,
    context,
    changes: {
      pastNotifications,
    },
  });
};

export const notifyAutoUpdate = ({
  context,
  experiment,
  success,
}: {
  context: Context;
  experiment: ExperimentInterface;
  success: boolean;
}) =>
  memoizeNotification({
    context,
    experiment,
    type: "auto-update",
    triggered: !success,
    dispatch: () =>
      dispatchEvent({
        context,
        experiment,
        event: "warning",
        data: {
          object: {
            type: "auto-update",
            success,
            experimentId: experiment.id,
            experimentName: experiment.name,
          },
        },
      }),
  });

export const notifyMultipleExposures = async ({
  context,
  experiment,
  results,
  snapshot,
}: {
  context: Context;
  experiment: ExperimentInterface;
  results: ExperimentReportResultDimension;
  snapshot: ExperimentSnapshotDocument;
}) => {
  const totalUsers = results.variations.reduce(
    (totalUsersCount, { users }) => totalUsersCount + users,
    0
  );

  const multipleExposureHealth = getMultipleExposureHealthData({
    multipleExposuresCount: snapshot.multipleExposures,
    totalUsersCount: totalUsers,
    minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_MINIMUM_COUNT,
    minPercentThreshold:
      context.org.settings?.multipleExposureMinPercent ??
      DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  });

  const triggered = multipleExposureHealth.status === "unhealthy";

  await memoizeNotification({
    context,
    experiment,
    type: "multiple-exposures",
    triggered,
    dispatch: async () => {
      if (!triggered) return;

      await dispatchEvent({
        context,
        experiment,
        event: "warning",
        data: {
          object: {
            type: "multiple-exposures",
            experimentId: experiment.id,
            experimentName: experiment.name,
            usersCount: snapshot.multipleExposures,
            percent: multipleExposureHealth.rawDecimal,
          },
        },
      });
    },
  });
};

export const notifySrm = async ({
  context,
  experiment,
  results,
}: {
  context: Context;
  experiment: ExperimentInterface;
  results: ExperimentReportResultDimension;
}) => {
  const srmThreshold =
    context.org.settings?.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const totalUsers = results.variations.reduce(
    (totalUsersCount, { users }) => totalUsersCount + users,
    0
  );

  const srmHealth = getSRMHealthData({
    srm: results.srm,
    srmThreshold,
    totalUsersCount: totalUsers,
    numOfVariations: experiment.variations.length,
    minUsersPerVariation:
      experiment.type === "multi-armed-bandit"
        ? DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION
        : DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  });

  const triggered = srmHealth === "unhealthy";

  await memoizeNotification({
    context,
    experiment,
    type: "srm",
    triggered,
    dispatch: async () => {
      if (!triggered) return;

      await dispatchEvent({
        context,
        experiment,
        event: "warning",
        data: {
          object: {
            type: "srm",
            experimentId: experiment.id,
            experimentName: experiment.name,
            threshold: srmThreshold,
          },
        },
      });
    },
  });
};

type ExperimentSignificanceChange = {
  experimentId: string;
  experimentName: string;
  variationId: string;
  variationName: string;
  metricId: string;
  metricName: string;
  statsEngine: StatsEngine;
  criticalValue: number;
  winning: boolean;
};

const sendSignificanceEmail = async (
  experiment: ExperimentInterface,
  experimentChanges: ExperimentSignificanceChange[]
) => {
  const messages = experimentChanges.map(
    ({ metricName, variationName, winning, statsEngine, criticalValue }) => {
      if (statsEngine === "frequentist") {
        return `The metric ${metricName} for variation ${variationName} is
         ${winning ? "beating" : "losing to"} the baseline and has
         reached statistical significance (p-value = ${criticalValue.toFixed(
           3
         )}).`;
      }
      return `The metric ${metricName} for variation ${variationName} has ${
        winning ? "reached a" : "dropped to a"
      } ${(criticalValue * 100).toFixed(1)} chance to beat the baseline.`;
    }
  );

  try {
    // send an email to any subscribers on this test:
    const watchers = await getExperimentWatchers(
      experiment.id,
      experiment.organization
    );

    await sendExperimentChangesEmail(
      watchers,
      experiment.id,
      experiment.name,
      messages
    );
  } catch (e) {
    logger.error(e, "Failed to send significance email");
  }
};

export const computeExperimentChanges = async ({
  context,
  experiment,
  snapshot: currentSnapshot,
}: {
  context: Context;
  experiment: ExperimentInterface;
  snapshot: ExperimentSnapshotDocument;
}): Promise<ExperimentSignificanceChange[]> => {
  const currentAnalysis = getSnapshotAnalysis(currentSnapshot);
  const currentVariations = currentAnalysis?.results?.[0]?.variations;
  if (!currentAnalysis || !currentVariations) {
    return [];
  }

  const lastSnapshot = await getLatestSnapshot({
    experiment: experiment.id,
    phase: experiment.phases.length - 1,
    beforeSnapshot: currentSnapshot,
  });
  const lastAnalysis = lastSnapshot
    ? getSnapshotAnalysis(lastSnapshot)
    : undefined;
  const lastVariations = lastAnalysis?.results?.[0]?.variations;

  // get the org level settings for significance:
  const statsEngine = currentAnalysis.settings.statsEngine;
  const { ciUpper, ciLower } = getConfidenceLevelsForOrg(context);
  const metricDefaults = getMetricDefaultsForOrg(context);
  const pValueThreshold = getPValueThresholdForOrg(context);

  const experimentChanges: ExperimentSignificanceChange[] = [];

  const currentBaselineVariation = currentVariations[0];
  const lastBaselineVariation = lastVariations?.[0];
  for (let i = 1; i < currentVariations.length; i++) {
    const curVar = currentVariations[i];
    const lastVar = lastVariations?.[i];

    for (const m in curVar.metrics) {
      const lastBaselineMetric = lastBaselineVariation?.metrics?.[m];
      const curBaselineMetric = currentBaselineVariation?.metrics?.[m];
      const curMetric = curVar?.metrics?.[m];
      const lastMetric = lastVar?.metrics?.[m];

      if (!curBaselineMetric || !curMetric) continue;

      const criticalValue =
        statsEngine === "frequentist"
          ? curMetric.pValue
          : curMetric.chanceToWin;
      if (criticalValue === undefined) continue;

      const metric = ensureAndReturn(await getExperimentMetricById(context, m));

      const { resultsStatus: curResultsStatus } = getMetricResultStatus({
        metric,
        metricDefaults,
        baseline: curBaselineMetric,
        stats: curMetric,
        ciLower,
        ciUpper,
        pValueThreshold,
        statsEngine: statsEngine,
      });

      const { resultsStatus: lastResultsStatus } =
        lastBaselineMetric && lastMetric && lastAnalysis
          ? getMetricResultStatus({
              metric,
              metricDefaults,
              baseline: lastBaselineMetric,
              stats: lastMetric,
              ciLower,
              ciUpper,
              pValueThreshold,
              statsEngine: lastAnalysis.settings.statsEngine,
            })
          : { resultsStatus: "" };

      const winning = (() => {
        // checks to see if anything changed:
        if (curResultsStatus === "won" && lastResultsStatus !== "won")
          return true;

        if (curResultsStatus === "lost" && lastResultsStatus !== "lost")
          return false;

        return null;
      })();

      if (winning === null) continue;

      const { id: variationId, name: variationName } = experiment.variations[i];

      experimentChanges.push({
        experimentId: experiment.id,
        experimentName: experiment.name,
        variationId,
        variationName,
        metricId: m,
        metricName: metric.name,
        statsEngine,
        criticalValue,
        winning,
      });
    }
  }

  return experimentChanges;
};

export const notifySignificance = async ({
  context,
  experiment,
  snapshot,
}: {
  context: Context;
  experiment: ExperimentInterface;
  snapshot: ExperimentSnapshotDocument;
}) => {
  const experimentChanges = await computeExperimentChanges({
    context,
    experiment,
    snapshot,
  });

  if (!experimentChanges.length) return;
  // no notifications for bandits yet, will add 95% event later
  if (experiment.type === "multi-armed-bandit") return;

  // send email if enabled and the snapshot is scheduled standard analysis
  if (
    isEmailEnabled() &&
    snapshot.triggeredBy === "schedule" &&
    snapshot.type === "standard"
  ) {
    await sendSignificanceEmail(experiment, experimentChanges);
  }

  await Promise.all(
    experimentChanges.map((change) =>
      dispatchEvent({
        context,
        experiment,
        event: "info.significance",
        data: {
          object: change,
        },
      })
    )
  );
};

export const notifyExperimentChange = async ({
  context,
  snapshot,
}: {
  context: Context;
  snapshot: ExperimentSnapshotDocument;
}) => {
  const experiment = await getExperimentById(context, snapshot.experiment);
  if (!experiment) throw new Error("Error while fetching experiment!");

  // do not fire significance or error events for exploratory analyses
  if (snapshot.type === "exploratory") return;
  // do not fire significance or error events for reports
  if (snapshot.type === "report") return;
  // do not fire significance events for old snapshots that have no type
  if (snapshot.type === undefined) return;
  // do not fire for snapshots where statistics are manually entered in the UI
  if (snapshot.manual) return;

  await notifySignificance({ context, experiment, snapshot });

  const results = getDefaultAnalysisResults(snapshot);

  if (results) {
    await notifyMultipleExposures({
      context,
      experiment,
      results,
      snapshot,
    });

    await notifySrm({ context, experiment, results });
  }
};
