import { experimentStartedNotificationPayload } from "shared/validators";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import {
  getExperimentStartedGoalMetricsLine,
  getExperimentStartedSummary,
} from "back-end/src/services/experimentChanges/experimentStartedSummary";
import type {
  NotificationCard,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";

const LABEL = "Experiment started";
const BANNER = "Experiment Started";

// Built from the immutable start payload: what launched and in which phase.
export const buildExperimentStartedCard: NotificationCardProducer = (
  event,
): NotificationCard | null => {
  if (event.event !== "experiment.status.started") return null;
  const parsed = experimentStartedNotificationPayload.safeParse(
    event.data.object,
  );
  if (!parsed.success) return null;
  const data = parsed.data;
  const goalMetrics = getExperimentStartedGoalMetricsLine(data);
  return {
    data: {
      state: "started",
      event: "started",
      name: data.experimentName,
      key: data.experimentId,
      banner: BANNER,
      summary: [
        getExperimentStartedSummary(data),
        ...(goalMetrics ? [goalMetrics] : []),
      ],
    },
    altText: `${data.experimentName} - ${LABEL}`,
    objectUrl: `${APP_ORIGIN}/experiment/${data.experimentId}`,
    objectName: data.experimentName,
    eventLabel: LABEL,
  };
};
