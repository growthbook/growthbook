import { includeExperimentInPayload, getSnapshotAnalysis } from "shared/util";
import { Context } from "../models/BaseModel";
import { createEvent, CreateEventData } from "../models/EventModel";
import { getExperimentById, updateExperiment } from "../models/ExperimentModel";
import { getExperimentWatchers } from "../models/WatchModel";
import { logger } from "../util/logger";
import { ensureAndReturn } from "../util/types";
import {
  ExperimentSnapshotDocument,
  getDefaultAnalysisResults,
  getLatestSnapshot,
} from "../models/ExperimentSnapshotModel";
import {
  ExperimentInterface,
  ExperimentNotification,
} from "../../types/experiment";
import { ExperimentReportResultDimension } from "../../types/report";
import { ResourceEvents } from "../events/base-types";
import {
  getConfidenceLevelsForOrg,
  getEnvironmentIdsFromOrg,
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

export const MINIMUM_MULTIPLE_EXPOSURES_PERCENT = 0.01;

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
  const totalsUsers = results.variations.reduce(
    (totalUsersCount, { users }) => totalUsersCount + users,
    0
  );
  const percent = snapshot.multipleExposures / totalsUsers;
  const multipleExposureMinPercent =
    context.org.settings?.multipleExposureMinPercent ??
    MINIMUM_MULTIPLE_EXPOSURES_PERCENT;

  const triggered = multipleExposureMinPercent < percent;

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
            percent,
          },
        },
      });
    },
  });
};

export const DEFAULT_SRM_THRESHOLD = 0.001;

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

  const triggered = results.srm < srmThreshold;

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
  chanceToWin: number;
  threshold: number;
};

const sendSignificanceEmail = async (
  experiment: ExperimentInterface,
  experimentChanges: ExperimentSignificanceChange[]
) => {
  const messages = experimentChanges.map(
    ({ metricName, variationName, threshold, chanceToWin }) =>
      `The metric ${metricName} for variation ${variationName} has ${
        chanceToWin < threshold ? "dropped to a" : "reached a"
      } ${(chanceToWin * 100).toFixed(1)} chance to beat the baseline.`
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

export const notifySignificance = async ({
  context,
  experiment,
  snapshot: currentSnapshot,
}: {
  context: Context;
  experiment: ExperimentInterface;
  snapshot: ExperimentSnapshotDocument;
}) => {
  const lastSnapshot = await getLatestSnapshot(
    experiment.id,
    experiment.phases.length - 1
  );

  if (!lastSnapshot) return;

  const currentVariations = getSnapshotAnalysis(currentSnapshot)?.results?.[0]
    ?.variations;
  const lastVariations = getSnapshotAnalysis(lastSnapshot)?.results?.[0]
    ?.variations;

  if (!currentVariations || !lastVariations) {
    return;
  }

  // get the org confidence level settings:
  const { ciUpper, ciLower } = getConfidenceLevelsForOrg(context);

  const experimentChanges: ExperimentSignificanceChange[] = [];

  for (let i = 1; i < currentVariations.length; i++) {
    const curVar = currentVariations[i];
    const lastVar = lastVariations[i];

    for (const m in curVar.metrics) {
      const curMetric = curVar?.metrics?.[m];
      const lastMetric = lastVar?.metrics?.[m];

      // sanity checks:
      if (
        !lastMetric?.chanceToWin ||
        !curMetric?.chanceToWin ||
        curMetric?.value <= 150
      )
        continue;

      const threshold = (() => {
        // checks to see if anything changed:
        if (curMetric.chanceToWin > ciUpper && lastMetric.chanceToWin < ciUpper)
          return ciUpper;

        if (curMetric.chanceToWin < ciLower && lastMetric.chanceToWin > ciLower)
          return ciLower;
      })();

      if (!threshold) continue;

      const { name: metricName } = ensureAndReturn(
        await getExperimentMetricById(context, m)
      );

      const { id: variationId, name: variationName } = experiment.variations[i];

      experimentChanges.push({
        experimentId: experiment.id,
        experimentName: experiment.name,
        variationId,
        variationName,
        metricId: m,
        metricName,
        chanceToWin: curMetric.chanceToWin,
        threshold,
      });
    }
  }

  if (!experimentChanges.length) return;

  // If email is not configured, there's nothing else to do
  if (isEmailEnabled())
    await sendSignificanceEmail(experiment, experimentChanges);

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
