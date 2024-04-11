import { Context } from "../models/BaseModel";
import { createEvent } from "../models/EventModel";
import { getExperimentById, updateExperiment } from "../models/ExperimentModel";
import { EventNotifier } from "../events/notifiers/EventNotifier";
import { ExperimentWarningNotificationEvent } from "../events/notification-events";
import { ExperimentSnapshotDocument } from "../models/ExperimentSnapshotModel";
import {
  ExperimentInterface,
  ExperimentNotification,
} from "../../types/experiment";
import { ExperimentReportResultDimension } from "../../types/report";
import { ExperimentWarningNotificationPayload } from "../types/ExperimentNotification";
import { IfEqual } from "../util/types";

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
  data: ExperimentWarningNotificationData
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

const memoizeNotification = async ({
  context,
  experiment,
  type,
  handler,
}: {
  context: Context;
  experiment: ExperimentInterface;
  type: ExperimentNotification;
  handler: () => Promise<boolean>;
}) => {
  if (experiment.pastNotifications?.includes(type)) return;

  const pastNotifications = (await handler())
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
    handler: async () => {
      await dispatchEvent(context, {
        type: "auto-update",
        success,
        experimentId: experiment.id,
        experimentName: experiment.name,
      });
      return success;
    },
  });

export const MINIMUM_MULTIPLE_EXPOSURES_PERCENT = 0.01;

const notifyMultipleExposures = async ({
  context,
  experiment,
  firstResult,
  snapshot,
}: {
  context: Context;
  experiment: ExperimentInterface;
  firstResult: ExperimentReportResultDimension;
  snapshot: ExperimentSnapshotDocument;
}) =>
  memoizeNotification({
    context,
    experiment,
    type: "multiple-exposures",
    handler: async () => {
      const totalsUsers = firstResult.variations.reduce(
        (totalUsersCount, { users }) => totalUsersCount + users,
        0
      );
      const percent = snapshot.multipleExposures / totalsUsers;
      const multipleExposureMinPercent =
        context.org.settings?.multipleExposureMinPercent ??
        MINIMUM_MULTIPLE_EXPOSURES_PERCENT;

      if (snapshot.multipleExposures < multipleExposureMinPercent) return false;

      await dispatchEvent(context, {
        type: "multiple-exposures",
        experimentId: experiment.id,
        experimentName: experiment.name,
        usersCount: snapshot.multipleExposures,
        percent,
      });

      return true;
    },
  });

export const DEFAULT_SRM_THRESHOLD = 0.001;

const notifySrm = async ({
  context,
  experiment,
  firstResult,
}: {
  context: Context;
  experiment: ExperimentInterface;
  firstResult: ExperimentReportResultDimension;
}) =>
  memoizeNotification({
    context,
    experiment,
    type: "srm",
    handler: async () => {
      const srmThreshold =
        context.org.settings?.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

      if (srmThreshold <= firstResult.srm) return false;

      await dispatchEvent(context, {
        type: "srm",
        experimentId: experiment.id,
        experimentName: experiment.name,
        threshold: srmThreshold,
      });

      return true;
    },
  });

export const notifyExperimentChange = async ({
  context,
  snapshot,
}: {
  context: Context;
  snapshot: ExperimentSnapshotDocument;
}) => {
  const experiment = await getExperimentById(context, snapshot.experiment);
  if (!experiment) throw new Error("Error while fetching experiment!");

  const [
    {
      results: [firstResult],
    },
  ] = snapshot.analyses.sort(
    (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()
  );

  if (firstResult) {
    await notifyMultipleExposures({
      context,
      experiment,
      firstResult,
      snapshot,
    });
    await notifySrm({ context, experiment, firstResult });
  }
};
