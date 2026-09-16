import { srm } from "shared/validators";
import {
  SRM_LABEL,
  buildSrmBalanceTable,
  getSrmTotalUnits,
} from "back-end/src/services/experimentChanges/experimentSrmSummary";
import type { NotificationCardProducer } from "back-end/src/services/notificationCards/types";

// Only the SRM subtype of experiment.warning has a card; other warnings stay
// as accurate text notifications.
export const buildExperimentSrmCard: NotificationCardProducer = (event) => {
  const parsed = srm.safeParse(event.data.object);
  if (!parsed.success) return null;
  const { experimentId, experimentName } = parsed.data;
  const table = buildSrmBalanceTable(parsed.data);
  const units = getSrmTotalUnits(parsed.data);
  return {
    state: "warning",
    name: experimentName,
    key: experimentId,
    banner: SRM_LABEL,
    ...(units !== undefined ? { units } : {}),
    ...(parsed.data.durationDays !== undefined
      ? { durationDays: parsed.data.durationDays }
      : {}),
    ...(table ? { table } : {}),
  };
};
