import { includeExperimentInPayload } from "shared/util";
import { Context } from "../models/BaseModel";
import { createEvent } from "../models/EventModel";
import { getExperimentById, updateExperiment } from "../models/ExperimentModel";
import {
  ExperimentSnapshotDocument,
  getDefaultAnalysisResults,
} from "../models/ExperimentSnapshotModel";
import {
  ExperimentInterface,
  ExperimentNotification,
} from "../../types/experiment";
import { ExperimentReportResultDimension } from "../../types/report";
import { ExperimentWarningNotificationPayload } from "../types/ExperimentNotification";
import { IfEqual } from "../util/types";
import { getEnvironmentIdsFromOrg } from "./organizations";

// This ensures that the two types remain equal.

// TODO: extend with experiment info
type ExperimentNotificationFromCode = ExperimentWarningNotificationPayload["type"];

type ExperimentWarningNotificationData = IfEqual<
  ExperimentNotificationFromCode,
  ExperimentNotification,
  ExperimentWarningNotificationPayload,
  never
>;

const dispatchEvent = async (
  context: Context,
  experiment: ExperimentInterface,
  data: ExperimentWarningNotificationData
) => {
  const changedEnvs = includeExperimentInPayload(experiment)
    ? getEnvironmentIdsFromOrg(context.org)
    : [];

  await createEvent({
    context,
    event: "warning",
    object: "experiment",
    objectId: experiment.id,
    data: { object: data },
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
      dispatchEvent(context, experiment, {
        type: "auto-update",
        success,
        experimentId: experiment.id,
        experimentName: experiment.name,
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

      await dispatchEvent(context, experiment, {
        type: "multiple-exposures",
        experimentId: experiment.id,
        experimentName: experiment.name,
        usersCount: snapshot.multipleExposures,
        percent,
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

      await dispatchEvent(context, experiment, {
        type: "srm",
        experimentId: experiment.id,
        experimentName: experiment.name,
        threshold: srmThreshold,
      });
    },
  });
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
