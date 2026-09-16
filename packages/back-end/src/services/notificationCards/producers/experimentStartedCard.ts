import { experimentStartedNotificationPayload } from "shared/validators";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import {
  EXPERIMENT_STARTED_LABEL,
  getExperimentStartedFields,
} from "back-end/src/services/experimentChanges/experimentStartedSummary";
import type {
  NotificationCard,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";

// Built from the immutable start payload: goal metrics and linked changes as
// labeled fields.
export const buildExperimentStartedCard: NotificationCardProducer = (
  event,
): NotificationCard | null => {
  if (event.event !== "experiment.status.started") return null;
  const parsed = experimentStartedNotificationPayload.safeParse(
    event.data.object,
  );
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    data: {
      state: "started",
      name: data.experimentName,
      key: data.experimentId,
      banner: EXPERIMENT_STARTED_LABEL,
      fields: getExperimentStartedFields(data),
    },
    altText: `${data.experimentName} - ${EXPERIMENT_STARTED_LABEL}`,
    objectUrl: `${APP_ORIGIN}/experiment/${data.experimentId}`,
    objectName: data.experimentName,
    eventLabel: EXPERIMENT_STARTED_LABEL,
  };
};
