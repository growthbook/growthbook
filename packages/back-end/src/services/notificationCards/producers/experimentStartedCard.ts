import { experimentStartedNotificationPayload } from "shared/validators";
import { getExperimentUrl } from "back-end/src/util/appUrls";
import { EXPERIMENT_EVENT_LABELS } from "back-end/src/services/experimentChanges/experimentEventLabels";
import { getExperimentStartedFields } from "back-end/src/services/experimentChanges/experimentStartedSummary";
import type { NotificationCardProducer } from "back-end/src/services/notificationCards/types";

// Built from the immutable start payload: goal metrics and linked changes as
// labeled fields.
export const buildExperimentStartedCard: NotificationCardProducer = (event) => {
  const parsed = experimentStartedNotificationPayload.safeParse(
    event.data.object,
  );
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    tone: "info",
    icon: "play",
    name: data.experimentName,
    banner: EXPERIMENT_EVENT_LABELS.started,
    url: getExperimentUrl(data.experimentId),
    sections: [{ kind: "fields", fields: getExperimentStartedFields(data) }],
  };
};
