import {
  includeExperimentInPayload,
  getSnapshotAnalysis,
  ensureAndReturn,
} from "shared/util";
import {
  expandMetricGroups,
  getMetricResultStatus,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
  getLatestPhaseVariations,
} from "shared/experiments";
import cloneDeep from "lodash/cloneDeep";
import {
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
  getExperimentResultStatus,
  getHealthSettings,
} from "shared/enterprise";
import { ExperimentAnalysisSummary } from "shared/validators";
import { StatsEngine } from "shared/types/stats";
import {
  ExperimentHealthSettings,
  ExperimentInterface,
  ExperimentNotification,
  ExperimentResultStatusData,
} from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ResourceEvents } from "shared/types/events/base-types";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { Context } from "back-end/src/models/BaseModel";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { logger } from "back-end/src/util/logger";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentMetricById } from "back-end/src/services/experiments";
import {
  getEnvironmentIdsFromOrg,
  getMetricDefaultsForOrg,
  getSignificanceSettingsForProject,
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

export const notifyExperimentStarted = async ({
  context,
  experiment,
}: {
  context: Context;
  experiment: ExperimentInterface;
}) => {
  const latestPhase = experiment.phases[experiment.phases.length - 1];

  await dispatchEvent({
    context,
    experiment,
    event: "started",
    data: {
      object: {
        type: "started",
        experimentId: experiment.id,
        experimentName: experiment.name,
        phaseName: latestPhase?.name,
        variationCount: experiment.variations.length,
      },
    },
  });
};

export const notifyExperimentStopped = async ({
  context,
  experiment,
  type,
  results,
  enableTemporaryRollout,
  releasedVariationName,
  reason,
}: {
  context: Context;
  experiment: ExperimentInterface;
  type: "shipped" | "rolledback";
  results: NonNullable<ExperimentInterface["results"]>;
  enableTemporaryRollout: boolean;
  releasedVariationName?: string;
  reason?: string;
}) => {
  await dispatchEvent({
    context,
    experiment,
    event: `stopped.${type}`,
    data: {
      object: {
        type,
        experimentId: experiment.id,
        experimentName: experiment.name,
        results,
        releasedVariationName,
        enableTemporaryRollout,
        reason,
      },
    },
  });
};

// Fires on every failed attempt of the scheduled-status-update job (not
// memoized). Each event carries the attempt count and whether another retry
// will follow, so downstream channels can choose to surface only the
// terminal failure (`willRetry: false`) if desired.
export const notifyScheduledStatusUpdateFailed = ({
  context,
  experiment,
  scheduledStatusUpdateType,
  attempts,
  maxAttempts,
  willRetry,
  reason,
}: {
  context: Context;
  experiment: ExperimentInterface;
  scheduledStatusUpdateType: "start" | "stop";
  attempts: number;
  maxAttempts: number;
  willRetry: boolean;
  reason: string;
}) =>
  dispatchEvent({
    context,
    experiment,
    event: "warning",
    data: {
      object: {
        type: "scheduled-status-update-failed",
        experimentId: experiment.id,
        experimentName: experiment.name,
        scheduledStatusUpdateType,
        attempts,
        maxAttempts,
        willRetry,
        reason,
      },
    },
  });

const getSafeDate = (value: Date | string | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysBetweenDates = (start: Date, end: Date): number =>
  Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86400000));

export const notifyExperimentEndingSoon = async ({
  context,
  experiment,
  windowDays = 3,
}: {
  context: Context;
  experiment: ExperimentInterface;
  windowDays?: number;
}) => {
  const latestPhase = experiment.phases[experiment.phases.length - 1];
  const endsAt = getSafeDate(latestPhase?.dateEnded);
  const now = new Date();
  const daysRemaining = endsAt ? daysBetweenDates(now, endsAt) : 0;
  const triggered =
    experiment.status === "running" &&
    !!endsAt &&
    endsAt.getTime() >= now.getTime() &&
    daysRemaining <= windowDays;

  await memoizeNotification({
    context,
    experiment,
    type: "ending-soon",
    triggered,
    dispatch: async () => {
      if (!triggered || !endsAt) return;
      await dispatchEvent({
        context,
        experiment,
        event: "endingSoon",
        data: {
          object: {
            type: "ending-soon",
            experimentId: experiment.id,
            experimentName: experiment.name,
            endsAt: endsAt.toISOString(),
            daysRemaining,
          },
        },
      });
    },
  });
};

export const notifyExperimentStale = async ({
  context,
  experiment,
  staleAfterDays = 90,
}: {
  context: Context;
  experiment: ExperimentInterface;
  staleAfterDays?: number;
}) => {
  const firstPhase = experiment.phases[0];
  const startedAt = getSafeDate(firstPhase?.dateStarted);
  const daysRunning = startedAt ? daysBetweenDates(startedAt, new Date()) : 0;
  const triggered =
    experiment.status === "running" &&
    !!startedAt &&
    daysRunning >= staleAfterDays;

  await memoizeNotification({
    context,
    experiment,
    type: "stale",
    triggered,
    dispatch: async () => {
      if (!triggered) return;
      await dispatchEvent({
        context,
        experiment,
        event: "stale",
        data: {
          object: {
            type: "stale",
            experimentId: experiment.id,
            experimentName: experiment.name,
            daysRunning,
            reason:
              "This experiment has been running for a long time. Review whether it should ship, roll back, or be extended.",
          },
        },
      });
    },
  });
};

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

const getFailedGuardrailMetrics = async ({
  context,
  experiment,
  analysisSummary,
}: {
  context: Context;
  experiment: ExperimentInterface;
  analysisSummary?: ExperimentAnalysisSummary;
}) => {
  const failedMetrics: {
    id: string;
    name: string;
    variationName: string;
  }[] = [];
  const variations = getLatestPhaseVariations(experiment);

  for (const [variationIndex, variationStatus] of (
    analysisSummary?.resultsStatus?.variations || []
  ).entries()) {
    for (const [metricId, metricStatus] of Object.entries(
      variationStatus.guardrailMetrics || {},
    )) {
      if (metricStatus.status !== "lost") continue;

      const metric = await getExperimentMetricById(context, metricId);
      const variation =
        variations.find((v) => v.id === variationStatus.variationId) ||
        variations[variationIndex];

      failedMetrics.push({
        id: metricId,
        name: metric?.name || metricId,
        variationName: variation?.name || variationStatus.variationId,
      });
    }
  }

  return failedMetrics;
};

export const notifyGuardrailFailed = async ({
  context,
  experiment,
}: {
  context: Context;
  experiment: ExperimentInterface;
}) => {
  const failedMetrics = await getFailedGuardrailMetrics({
    context,
    experiment,
    analysisSummary: experiment.analysisSummary,
  });
  const triggered = experiment.status === "running" && failedMetrics.length > 0;

  await memoizeNotification({
    context,
    experiment,
    type: "guardrail-failed",
    triggered,
    dispatch: async () => {
      if (!triggered) return;

      await dispatchEvent({
        context,
        experiment,
        event: "health.guardrailFailed",
        data: {
          object: {
            type: "guardrail-failed",
            experimentId: experiment.id,
            experimentName: experiment.name,
            failedMetrics,
          },
        },
      });
    },
  });

  return (
    triggered && !experiment.pastNotifications?.includes("guardrail-failed")
  );
};

export const notifyUnderpowered = async ({
  context,
  experiment,
  currentStatus,
}: {
  context: Context;
  experiment: ExperimentInterface;
  currentStatus: ExperimentResultStatusData;
}) => {
  const triggered =
    currentStatus.status === "unhealthy" &&
    !!currentStatus.unhealthyData.lowPowered;

  await memoizeNotification({
    context,
    experiment,
    type: "underpowered",
    triggered,
    dispatch: async () => {
      if (!triggered) return;

      await dispatchEvent({
        context,
        experiment,
        event: "warning",
        data: {
          object: {
            type: "underpowered",
            experimentId: experiment.id,
            experimentName: experiment.name,
          },
        },
      });
    },
  });

  return triggered && !experiment.pastNotifications?.includes("underpowered");
};

export const notifyNoData = async ({
  context,
  experiment,
  snapshot,
}: {
  context: Context;
  experiment: ExperimentInterface;
  snapshot: ExperimentSnapshotInterface;
}) => {
  // Mirror the front-end "No data yet" check: the snapshot ran successfully but
  // the default analysis returned no variation rows.
  const analysis = getSnapshotAnalysis(snapshot);
  const triggered =
    snapshot.status === "success" &&
    (analysis?.results?.[0]?.variations?.length ?? 0) === 0;

  await memoizeNotification({
    context,
    experiment,
    type: "no-data",
    triggered,
    dispatch: async () => {
      if (!triggered) return;

      await dispatchEvent({
        context,
        experiment,
        event: "health.noData",
        data: {
          object: {
            type: "no-data",
            experimentId: experiment.id,
            experimentName: experiment.name,
          },
        },
      });
    },
  });

  return triggered && !experiment.pastNotifications?.includes("no-data");
};

export const notifyExperimentQueryFailed = async ({
  context,
  experiment,
  errorMessage,
  triggered = true,
}: {
  context: Context;
  experiment: ExperimentInterface;
  errorMessage?: string;
  triggered?: boolean;
}) => {
  await memoizeNotification({
    context,
    experiment,
    type: "query-failed",
    triggered: experiment.status === "running" && triggered,
    dispatch: async () => {
      if (!triggered || experiment.status !== "running") return;

      await dispatchEvent({
        context,
        experiment,
        event: "health.queryFailed",
        data: {
          object: {
            type: "query-failed",
            experimentId: experiment.id,
            experimentName: experiment.name,
            errorMessage,
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
  metricRole?: "goal" | "secondary" | "guardrail";
  statsEngine: StatsEngine;
  criticalValue: number;
  winning: boolean;
  uplift?: number;
  ci?: [number, number];
};

const sendSignificanceEmail = async (
  context: Context,
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
    const watchers = await context.models.watch.getExperimentWatchers(
      experiment.id,
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
  snapshot: ExperimentSnapshotInterface;
}): Promise<ExperimentSignificanceChange[]> => {
  const currentAnalysis = getSnapshotAnalysis(currentSnapshot);
  if (!currentAnalysis?.results?.[0]?.variations) {
    return [];
  }

  const lastSnapshot = await getLatestSuccessfulSnapshot({
    context,
    experiment: experiment.id,
    phase: experiment.phases.length - 1,
    beforeSnapshot: currentSnapshot,
  });
  const lastAnalysis = lastSnapshot
    ? getSnapshotAnalysis(lastSnapshot)
    : undefined;

  // TODO refactor to only do once per update
  // get the org level settings for significance:
  const statsEngine = currentAnalysis.settings.statsEngine;
  const projectId = experiment.project;
  const { ciUpper, ciLower, pValueCorrection, pValueThreshold } =
    await getSignificanceSettingsForProject(context, projectId);
  const metricDefaults = getMetricDefaultsForOrg(context);

  // Apply p-value correction to match what the UI and analysisSummary use,
  // so notifications don't fire for metrics that appear non-significant to users
  const metricGroups = await context.models.metricGroups.getAll();
  const expandedGoalMetrics = expandMetricGroups(
    experiment.goalMetrics,
    metricGroups,
  );
  const expandedSecondaryMetrics = expandMetricGroups(
    experiment.secondaryMetrics || [],
    metricGroups,
  );
  const expandedGuardrailMetrics = expandMetricGroups(
    experiment.guardrailMetrics || [],
    metricGroups,
  );
  const getMetricRole = (
    metricId: string,
  ): ExperimentSignificanceChange["metricRole"] => {
    if (expandedGoalMetrics.includes(metricId)) return "goal";
    if (expandedGuardrailMetrics.includes(metricId)) return "guardrail";
    if (expandedSecondaryMetrics.includes(metricId)) return "secondary";
    return undefined;
  };

  const currentResults = cloneDeep(currentAnalysis.results);
  setAdjustedPValuesOnResults(
    currentResults,
    expandedGoalMetrics,
    pValueCorrection,
  );
  setAdjustedCIs(currentResults, pValueThreshold);
  const currentVariations = currentResults[0]?.variations;

  let lastVariations = lastAnalysis?.results?.[0]?.variations;
  if (lastAnalysis) {
    const lastResults = cloneDeep(lastAnalysis.results);
    setAdjustedPValuesOnResults(
      lastResults,
      expandedGoalMetrics,
      pValueCorrection,
    );
    setAdjustedCIs(lastResults, pValueThreshold);
    lastVariations = lastResults[0]?.variations;
  }

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

      const { id: variationId, name: variationName } = getLatestPhaseVariations(
        experiment,
      )?.[i] || { id: i + "", name: "" };

      experimentChanges.push({
        experimentId: experiment.id,
        experimentName: experiment.name,
        variationId,
        variationName,
        metricId: m,
        metricName: metric.name,
        metricRole: getMetricRole(m),
        statsEngine,
        criticalValue,
        winning,
        uplift: curMetric.uplift?.mean,
        ci: curMetric.ciAdjusted || curMetric.ci,
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
  snapshot: ExperimentSnapshotInterface;
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
    await sendSignificanceEmail(context, experiment, experimentChanges);
  }

  await Promise.all(
    experimentChanges.flatMap((change) => {
      const events = [
        dispatchEvent({
          context,
          experiment,
          event: "info.significance",
          data: {
            object: change,
          },
        }),
      ];

      if (!change.winning) {
        events.push(
          dispatchEvent({
            context,
            experiment,
            event: "metric.regression",
            data: {
              object: {
                type: "metric-regression",
                experimentId: change.experimentId,
                experimentName: change.experimentName,
                metricId: change.metricId,
                metricName: change.metricName,
                variationName: change.variationName,
                metricRole: change.metricRole,
                uplift: change.uplift,
                ci: change.ci,
              },
            },
          }),
        );
      }

      return events;
    }),
  );
};

export const notifyBanditWeightsChanged = async ({
  context,
  experiment,
  currentWeights,
  updatedWeights,
}: {
  context: Context;
  experiment: ExperimentInterface;
  currentWeights: number[];
  updatedWeights: number[];
}) => {
  if (!currentWeights.length || !updatedWeights.length) return;
  const maxDelta = Math.max(
    ...updatedWeights.map((weight, i) => Math.abs(weight - currentWeights[i])),
  );
  if (maxDelta < 0.05) return;

  await dispatchEvent({
    context,
    experiment,
    event: "bandit.weightsChanged",
    data: {
      object: {
        type: "bandit-weights-changed",
        experimentId: experiment.id,
        experimentName: experiment.name,
        currentWeights,
        updatedWeights,
      },
    },
  });
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
  snapshot: ExperimentSnapshotInterface;
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

  await notifyExperimentQueryFailed({
    context,
    experiment,
    triggered: false,
  });

  const triggeredNoData = await notifyNoData({
    context,
    experiment,
    snapshot,
  });
  if (triggeredNoData) {
    notificationsTriggered.push("no-data");
  }

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

    const triggeredGuardrailFailure = await notifyGuardrailFailed({
      context,
      experiment,
    });
    if (triggeredGuardrailFailure) {
      notificationsTriggered.push("guardrail-failed");
    }

    const triggeredUnderpowered = await notifyUnderpowered({
      context,
      experiment,
      currentStatus,
    });
    if (triggeredUnderpowered) {
      notificationsTriggered.push("underpowered");
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
