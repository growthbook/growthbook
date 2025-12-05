import {
  includeExperimentInPayload,
  getSnapshotAnalysis,
  ensureAndReturn,
} from "shared/util";
import { getMetricResultStatus } from "shared/experiments";
import {
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
  getExperimentResultStatus,
  getHealthSettings,
} from "shared/enterprise";
import { ExperimentAnalysisSummary } from "shared/validators";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
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
  ExperimentHealthSettings,
  ExperimentInterface,
  ExperimentNotification,
  ExperimentResultStatusData,
} from "back-end/types/experiment";
import { ResourceEvents } from "back-end/src/events/base-types";
import { getExperimentMetricById } from "back-end/src/services/experiments";
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
  currentStatus,
}: {
  context: Context;
  experiment: ExperimentInterface;
  currentStatus: ExperimentResultStatusData;
}) => {
  const multipleExposureData =
    currentStatus.status === "unhealthy" &&
    currentStatus.unhealthyData.multipleExposures;
  const triggered = !!multipleExposureData;

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
            usersCount: multipleExposureData.multipleExposedUsers,
            percent: multipleExposureData.rawDecimal,
          },
        },
      });
    },
  });

  return (
    triggered && !experiment.pastNotifications?.includes("multiple-exposures")
  );
};

export const notifySrm = async ({
  context,
  experiment,
  currentStatus,
  healthSettings,
}: {
  context: Context;
  experiment: ExperimentInterface;
  currentStatus: ExperimentResultStatusData;
  healthSettings: ExperimentHealthSettings;
}) => {
  const triggered =
    currentStatus.status === "unhealthy" && !!currentStatus.unhealthyData.srm;

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
            threshold: healthSettings.srmThreshold,
          },
        },
      });
    },
  });

  return triggered && !experiment.pastNotifications?.includes("srm");
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
  experimentChanges: ExperimentSignificanceChange[],
) => {
  const messages = experimentChanges.map(
    ({ metricName, variationName, winning, statsEngine, criticalValue }) => {
      if (statsEngine === "frequentist") {
        return `The metric ${metricName} for variation ${variationName} is
         ${winning ? "beating" : "losing to"} the baseline and has
         reached statistical significance (p-value = ${criticalValue.toFixed(
           3,
         )}).`;
      }
      return `The metric ${metricName} for variation ${variationName} has ${
        winning ? "reached a" : "dropped to a"
      } ${(criticalValue * 100).toFixed(1)} chance to beat the baseline.`;
    },
  );

  try {
    // send an email to any subscribers on this test:
    const watchers = await getExperimentWatchers(
      experiment.id,
      experiment.organization,
    );

    await sendExperimentChangesEmail(
      watchers,
      experiment.id,
      experiment.name,
      messages,
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
        differenceType: currentAnalysis.settings.differenceType,
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
              differenceType: lastAnalysis.settings.differenceType,
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

  if (!experimentChanges.length) return false;
  // no notifications for bandits yet, will add 95% event later
  if (experiment.type === "multi-armed-bandit") return false;

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
      }),
    ),
  );
};

export const notifyDecision = async ({
  context,
  experiment,
  currentStatus,
  lastStatus,
}: {
  context: Context;
  experiment: ExperimentInterface;
  currentStatus: ExperimentResultStatusData;
  lastStatus?: ExperimentResultStatusData;
}) => {
  if (
    currentStatus.status === "ship-now" ||
    currentStatus.status === "rollback-now" ||
    currentStatus.status === "ready-for-review"
  ) {
    const eventType: "ship" | "rollback" | "review" = (() => {
      switch (currentStatus.status) {
        case "ship-now":
          return "ship";
        case "ready-for-review":
          return "review";
        case "rollback-now":
          return "rollback";
      }
    })();

    if (currentStatus.status !== lastStatus?.status) {
      dispatchEvent({
        context,
        experiment,
        event: `decision.${eventType}`,
        data: {
          object: {
            experimentId: experiment.id,
            experimentName: experiment.name,
            decisionDescription: currentStatus.tooltip,
          },
        },
      });

      return true;
    }
  }

  return false;
};

async function getDecisionCriteria(
  context: Context,
  decisionCriteriaId?: string,
) {
  if (!decisionCriteriaId) {
    return PRESET_DECISION_CRITERIA;
  }

  const usedPresetCriteria = PRESET_DECISION_CRITERIAS.find(
    (dc) => dc.id === decisionCriteriaId,
  );
  if (usedPresetCriteria) {
    return usedPresetCriteria;
  }

  const decisionCriteria =
    await context.models.decisionCriteria.getById(decisionCriteriaId);

  if (!decisionCriteria) {
    return PRESET_DECISION_CRITERIA;
  }

  return decisionCriteria;
}

export const notifyExperimentChange = async ({
  context,
  experiment,
  snapshot,
  previousAnalysisSummary,
}: {
  context: Context;
  experiment: ExperimentInterface;
  snapshot: ExperimentSnapshotDocument;
  previousAnalysisSummary?: ExperimentAnalysisSummary;
}) => {
  const notificationsTriggered: string[] = [];

  await notifySignificance({
    context,
    experiment,
    snapshot,
  });

  const healthSettings = getHealthSettings(
    context.org.settings,
    orgHasPremiumFeature(context.org, "decision-framework"),
  );

  const decisionCriteria = await getDecisionCriteria(
    context,
    experiment.decisionFrameworkSettings?.decisionCriteriaId ??
      context.org.settings?.defaultDecisionCriteriaId,
  );

  const currentStatus = getExperimentResultStatus({
    experimentData: experiment,
    healthSettings,
    decisionCriteria,
  });

  if (currentStatus) {
    const triggeredMultipleExposures = await notifyMultipleExposures({
      context,
      experiment,
      currentStatus,
    });
    if (triggeredMultipleExposures) {
      notificationsTriggered.push("multiple-exposures");
    }

    const triggeredSrm = await notifySrm({
      context,
      experiment,
      currentStatus,
      healthSettings,
    });
    if (triggeredSrm) {
      notificationsTriggered.push("srm");
    }

    const lastStatus = getExperimentResultStatus({
      experimentData: {
        ...experiment,
        // use current experiment but the old analysis summary to compute
        // old experiment status
        analysisSummary: previousAnalysisSummary
          ? previousAnalysisSummary
          : undefined,
      },
      healthSettings,
      decisionCriteria,
    });
    const triggeredDecision = await notifyDecision({
      context,
      experiment,
      lastStatus,
      currentStatus,
    });
    if (triggeredDecision) {
      notificationsTriggered.push("decision");
    }
  }

  return notificationsTriggered;
};
