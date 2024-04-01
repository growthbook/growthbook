import { Context } from "../models/BaseModel";
import { ExperimentNotificationModel } from "../models/ExperimentNotification";
import { createEvent } from "../models/EventModel";
import { getExperimentById } from "../models/ExperimentModel";
import { EventNotifier } from "../events/notifiers/EventNotifier";
import { ExperimentWarningNotificationEvent } from "../events/notification-events";
import { ExperimentSnapshotDocument } from "../models/ExperimentSnapshotModel";

export const notifyFailedAutoUpdate = async ({
  context,
  experimentId,
}: {
  context: Context;
  experimentId: string;
}) => {
  const experiment = await getExperimentById(context, experimentId);

  if (!experiment) throw new Error("Error while fetching experiment!");

  const payload: ExperimentWarningNotificationEvent = {
    event: "experiment.warning",
    object: "experiment",
    data: {
      type: "auto-update-failed",
      experimentId,
      experimentName: experiment.name,
    },
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

export const MINIMUM_MULTIPLE_EXPOSURES = 10;

const notifyMultipleExposures = async ({
  context,
  snapshot,
}: {
  context: Context;
  snapshot: ExperimentSnapshotDocument;
}) => {
  if (snapshot.multipleExposures < MINIMUM_MULTIPLE_EXPOSURES) return;

  const experiment = await getExperimentById(context, snapshot.experiment);

  if (!experiment) throw new Error("Error while fetching experiment!");

  const payload: ExperimentWarningNotificationEvent = {
    event: "experiment.warning",
    object: "experiment",
    data: {
      type: "multiple-exposures",
      experimentId: experiment.id,
      experimentName: experiment.name,
      usersCount: snapshot.multipleExposures,
    },
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

export const notifyMetricsChange = async ({
  context,
  snapshot,
}: {
  context: Context;
  snapshot: ExperimentSnapshotDocument;
}) => {
  await notifyMultipleExposures({ context, snapshot });

  const experimentNotification = new ExperimentNotificationModel(context);
  const notifications = await experimentNotification.getAllByAttributes({
    trigger: "snapshot",
    experimentId: snapshot.experiment,
  });

  notifications.forEach((n) => experimentNotification.onTrigger(n));
};
