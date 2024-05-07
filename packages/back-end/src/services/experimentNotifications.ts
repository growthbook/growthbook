import { Context } from "../models/BaseModel";
import { createEvent } from "../models/EventModel";
import { getExperimentById, updateExperiment } from "../models/ExperimentModel";
import { EventNotifier } from "../events/notifiers/EventNotifier";
import { ExperimentWarningNotificationEvent } from "../events/notification-events";
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

// This ensures that the two types remain equal.

// TODO: extend with experiment info
type ExperimentNotificationFromCode =
  ExperimentWarningNotificationPayload["type"];

type ExperimentWarningNotificationData = IfEqual<
  ExperimentNotificationFromCode,
  ExperimentNotification,
  ExperimentWarningNotificationPayload,
  never
>;

const dispatchEvent = async (
  context: Context,
  data: ExperimentWarningNotificationData,
) => {
  const payload: ExperimentWarningNotificationEvent = {
    event: "experiment.warning",
    object: "experiment",
    data,
    user: {
      type: "dashboard",
      id: context.userId,
      email: context.email,
      name: context.userName,
    },
  };

  const emittedEvent = await createEvent(context.org.id, payload);

  if (!emittedEvent) throw new Error("Error while creating event!");

  new EventNotifier(emittedEvent.id).perform();
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
      dispatchEvent(context, {
        type: "auto-update",
        success,
        experimentId: experiment.id,
        experimentName: experiment.name,
      }),
  });

export const MINIMUM_MULTIPLE_EXPOSURES_PERCENT = 0.01;

const notifyMultipleExposures = async ({
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
    0,
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

      await dispatchEvent(context, {
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

const notifySrm = async ({
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

      await dispatchEvent(context, {
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
