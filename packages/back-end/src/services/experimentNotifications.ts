import { includeExperimentInPayload, getSnapshotAnalysis } from "shared/util";
import {
  getDecisionFrameworkStatus,
  getMetricResultStatus,
} from "shared/experiments";
import { getMultipleExposureHealthData, getSRMHealthData } from "shared/health";
import {
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
} from "shared/constants";
import { StatsEngine } from "back-end/types/stats";
import { Context } from "back-end/src/models/BaseModel";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { getExperimentWatchers } from "back-end/src/models/WatchModel";
import { logger } from "back-end/src/util/logger";
import {
  ExperimentSnapshotDocument,
  getLatestSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  ExperimentInterface,
  ExperimentNotification,
} from "back-end/types/experiment";
import { ResourceEvents } from "back-end/src/events/base-types";
import { ensureAndReturn } from "back-end/src/util/types";
import { getExperimentMetricById } from "back-end/src/services/experiments";
import {
  ExperimentAnalysisSummary,
  ExperimentAnalysisSummaryHealth,
} from "back-end/src/validators/experiments";
import {
  getConfidenceLevelsForOrg,
  getEnvironmentIdsFromOrg,
  getMetricDefaultsForOrg,
  getPValueThresholdForOrg,
} from "./organizations";
import { isEmailEnabled, sendExperimentChangesEmail } from "./email";

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
  healthSummary,
}: {
  context: Context;
  experiment: ExperimentInterface;
  healthSummary: ExperimentAnalysisSummaryHealth;
}) => {
  const multipleExposureHealth = getMultipleExposureHealthData({
    multipleExposuresCount: healthSummary.multipleExposures,
    totalUsersCount: healthSummary.totalUsers,
    minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
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
            usersCount: healthSummary.multipleExposures,
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
  healthSummary,
}: {
  context: Context;
  experiment: ExperimentInterface;
  healthSummary: ExperimentAnalysisSummaryHealth;
}) => {
  const srmThreshold =
    context.org.settings?.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const srmHealth = getSRMHealthData({
    srm: healthSummary.srm,
    srmThreshold,
    totalUsersCount: healthSummary.totalUsers,
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

  // TODO refactor to only do once per update
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

export const notifyDecision = async ({
  context,
  experiment,
  lastAnalysisSummary,
}: {
  context: Context;
  experiment: ExperimentInterface;
  lastAnalysisSummary?: ExperimentAnalysisSummary;
}) => {
  const resultsStatus = experiment.analysisSummary?.resultsStatus;
  const healthSummary = experiment.analysisSummary?.health;
  const daysNeeded =
    healthSummary?.power?.type === "success"
      ? healthSummary.power.additionalDaysNeeded
      : undefined;

  if (!resultsStatus) {
    return;
  }

  const currentDecision = getDecisionFrameworkStatus({
    resultsStatus,
    goalMetrics: experiment.goalMetrics,
    guardrailMetrics: experiment.guardrailMetrics,
    daysNeeded,
  });

  const lastResultsStatus = lastAnalysisSummary?.resultsStatus;
  const lastDaysNeeded =
    lastAnalysisSummary?.health?.power?.type === "success"
      ? lastAnalysisSummary.health.power.additionalDaysNeeded
      : undefined;

  const lastDecision = lastResultsStatus
    ? getDecisionFrameworkStatus({
        resultsStatus: lastResultsStatus,
        goalMetrics: experiment.goalMetrics,
        guardrailMetrics: experiment.guardrailMetrics,
        daysNeeded: lastDaysNeeded,
      })
    : undefined;

  if (!currentDecision) {
    return;
  }

  if (
    currentDecision.status === "ship-now" ||
    currentDecision.status === "rollback-now" ||
    currentDecision.status === "ready-for-review"
  ) {
    const eventType: "ship" | "rollback" | "review" = (() => {
      switch (currentDecision.status) {
        case "ship-now":
          return "ship";
        case "ready-for-review":
          return "review";
        case "rollback-now":
          return "rollback";
      }
    })();

    if (currentDecision.status !== lastDecision?.status) {
      dispatchEvent({
        context,
        experiment,
        event: `decision.${eventType}`,
        data: {
          object: {
            experimentId: experiment.id,
            experimentName: experiment.name,
            decisionDescription: currentDecision.tooltip,
          },
        },
      });
    }
  }
};

export const notifyExperimentChange = async ({
  context,
  experiment,
  snapshot,
  lastAnalysisSummary,
}: {
  context: Context;
  experiment: ExperimentInterface;
  snapshot: ExperimentSnapshotDocument;
  lastAnalysisSummary?: ExperimentAnalysisSummary;
}) => {
  await notifySignificance({ context, experiment, snapshot });

  const healthSummary = experiment.analysisSummary?.health;

  if (healthSummary) {
    await notifyMultipleExposures({
      context,
      experiment,
      healthSummary,
    });

    await notifySrm({ context, experiment, healthSummary });
  }

  await notifyDecision({ context, experiment, lastAnalysisSummary });
};
