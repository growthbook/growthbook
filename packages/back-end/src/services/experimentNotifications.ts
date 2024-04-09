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

const updateWrapper = async ({
  context,
  experiment,
  type,
  handler,
}: {
  context: Context;
  experiment: ExperimentInterface;
  type: ExperimentNotification;
  handler: () => Promise<void>;
}) => {
  if (experiment.pastNotifications?.includes(type)) return;

  await handler();

  await updateExperiment({
    experiment,
    context,
    changes: {
      pastNotifications: [...(experiment.pastNotifications || []), type],
    },
  });
};

export const notifyFailedAutoUpdate = async ({
  context,
  experimentId,
}: {
  context: Context;
  experimentId: string;
}) => {
  const experiment = await getExperimentById(context, experimentId);

  if (!experiment) throw new Error("Error while fetching experiment!");

  await updateWrapper({
    context,
    experiment,
    type: "auto-update",
    handler: () =>
      dispatchEvent(context, {
        type: "auto-update",
        experimentId,
        experimentName: experiment.name,
      }),
  });
};

export const MINIMUM_MULTIPLE_EXPOSURES_PERCENT = 0.01;

const notifyMultipleExposures = async ({
  context,
  experiment,
  lastResult,
  snapshot,
}: {
  context: Context;
  experiment: ExperimentInterface;
  lastResult: ExperimentReportResultDimension;
  snapshot: ExperimentSnapshotDocument;
}) =>
  updateWrapper({
    context,
    experiment,
    type: "multiple-exposures",
    handler: async () => {
      const totalsUsers = lastResult.variations.reduce(
        (totalUsersCount, { users }) => totalUsersCount + users,
        0
      );
      const percent = snapshot.multipleExposures / totalsUsers;
      const multipleExposureMinPercent =
        context.org.settings?.multipleExposureMinPercent ??
        MINIMUM_MULTIPLE_EXPOSURES_PERCENT;

      if (snapshot.multipleExposures < multipleExposureMinPercent) return;

      await dispatchEvent(context, {
        type: "multiple-exposures",
        experimentId: experiment.id,
        experimentName: experiment.name,
        usersCount: snapshot.multipleExposures,
        percent,
      });
    },
  });

export const DEFAULT_SRM_THRESHOLD = 0.001;

const notifySrm = async ({
  context,
  experiment,
  lastResult,
}: {
  context: Context;
  experiment: ExperimentInterface;
  lastResult: ExperimentReportResultDimension;
}) =>
  updateWrapper({
    context,
    experiment,
    type: "srm",
    handler: async () => {
      const srmThreshold =
        context.org.settings?.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

      if (srmThreshold <= lastResult.srm) return;

      await dispatchEvent(context, {
        type: "srm",
        experimentId: experiment.id,
        experimentName: experiment.name,
        threshold: srmThreshold,
      });
    },
  });

export const notifyMetricsChange = async ({
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
      results: [lastResult],
    },
  ] = snapshot.analyses.sort(
    (a, b) => b.dateCreated.getTime() - a.dateCreated.getTime()
  );

  if (lastResult) {
    await notifyMultipleExposures({
      context,
      experiment,
      lastResult,
      snapshot,
    });
    await notifySrm({ context, experiment, lastResult });
  }
};
