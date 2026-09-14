import {
  type ExperimentWarningNotificationPayload,
  srm,
} from "shared/validators";
import { pValueFormatter } from "shared/util";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import type {
  CardTable,
  NotificationCard,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";

type SrmPayload = Extract<
  ExperimentWarningNotificationPayload,
  { type: "srm" }
>;

const LABEL = "Health issue";
const BANNER = "Health Alert - SRM Detected";

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

// Same layout as the Health tab's balance check: actual vs. configured split.
export function buildSrmBalanceTable(data: SrmPayload): CardTable | null {
  const { variations, pValue } = data;
  if (!variations?.length) return null;
  const totalUsers = variations.reduce((sum, v) => sum + v.users, 0);
  const totalWeight = variations.reduce((sum, v) => sum + v.weight, 0);
  const pct = (n: number, d: number) =>
    d > 0 ? percentFormatter.format(n / d) : "-";
  return {
    columns: ["Variation", "Units", "Actual %", "Expected %"],
    rows: variations.map((v) => [
      v.name,
      numberFormatter.format(v.users),
      pct(v.users, totalUsers),
      pct(v.weight, totalWeight),
    ]),
    note: [
      `${numberFormatter.format(totalUsers)} total units`,
      pValue !== undefined ? `p-value = ${pValueFormatter(pValue)}` : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

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
  return {
    data: {
      state: "warning",
      event: "warning",
      name: experimentName,
      key: experimentId,
      banner: BANNER,
      ...(table ? { table } : {}),
    },
    altText: `${experimentName} - ${LABEL}`,
    objectUrl: `${APP_ORIGIN}/experiment/${experimentId}`,
    objectName: experimentName,
    eventLabel: LABEL,
  };
};
