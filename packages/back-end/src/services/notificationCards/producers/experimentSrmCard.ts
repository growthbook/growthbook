import { srm } from "shared/validators";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import {
  SRM_LABEL,
  buildSrmBalanceTable,
  getSrmTotalUnits,
} from "back-end/src/services/experimentChanges/experimentSrmSummary";
import type {
  NotificationCard,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";

// Only the SRM subtype of experiment.warning has a card; other warnings stay
// as accurate text notifications.
export const buildExperimentSrmCard: NotificationCardProducer = (
  event,
): NotificationCard | null => {
  if (event.event !== "experiment.warning") return null;
  const parsed = srm.safeParse(event.data.object);
  if (!parsed.success) return null;
  const { experimentId, experimentName } = parsed.data;
  const table = buildSrmBalanceTable(parsed.data);
  const units = getSrmTotalUnits(parsed.data);
  return {
    data: {
      state: "warning",
      name: experimentName,
      key: experimentId,
      banner: SRM_LABEL,
      ...(units !== undefined ? { units } : {}),
      ...(parsed.data.durationDays !== undefined
        ? { durationDays: parsed.data.durationDays }
        : {}),
      ...(table ? { table } : {}),
    },
    altText: `${experimentName} - ${SRM_LABEL}`,
    objectUrl: `${APP_ORIGIN}/experiment/${experimentId}`,
    objectName: experimentName,
    eventLabel: SRM_LABEL,
  };
};
