import { experimentStoppedNotificationPayload } from "shared/validators";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import type {
  NotificationCard,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";

const LABEL = "Experiment stopped";
const BANNER = "Experiment Stopped";

// Built from the immutable stop payload. Reports the recorded result and any
// temporary rollout without claiming an undeployed variation shipped.
export const buildExperimentStoppedCard: NotificationCardProducer = (
  event,
): NotificationCard | null => {
  if (event.event !== "experiment.status.stopped") return null;
  const parsed = experimentStoppedNotificationPayload.safeParse(
    event.data.object,
  );
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    data: {
      state: "stopped",
      event: "stopped",
      name: data.experimentName,
      key: data.experimentId,
      banner: BANNER,
      summary: [
        data.results
          ? `Experiment stopped. Result: ${data.results}.`
          : "Experiment stopped.",
        ...(data.enableTemporaryRollout && data.releasedVariationName
          ? [`Temporary rollout: ${data.releasedVariationName}`]
          : []),
        ...(data.reason ? [data.reason] : []),
      ],
    },
    altText: `${data.experimentName} - ${LABEL}`,
    objectUrl: `${APP_ORIGIN}/experiment/${data.experimentId}`,
    objectName: data.experimentName,
    eventLabel: LABEL,
  };
};
