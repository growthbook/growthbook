import { experimentStartedNotificationPayload } from "shared/validators";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { getExperimentStartedFields } from "back-end/src/services/experimentChanges/experimentStartedSummary";
import type {
  NotificationCard,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";

const LABEL = "Experiment started";
const BANNER = "Experiment Started";

// Built from the immutable start payload: goal metrics, linked changes, and
// variation count as labeled fields.
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
      event: "started",
      name: data.experimentName,
      key: data.experimentId,
      banner: BANNER,
      fields: getExperimentStartedFields(data),
    },
    altText: `${data.experimentName} - ${LABEL}`,
    objectUrl: `${APP_ORIGIN}/experiment/${data.experimentId}`,
    objectName: data.experimentName,
    eventLabel: LABEL,
  };
};
