import {
  type ExperimentWarningNotificationPayload,
  srm,
} from "shared/validators";
import { getExperimentUrlAndNameFormatted } from "back-end/src/events/handlers/utils";
import type { CardTable } from "back-end/src/services/notificationCards/cardImages";
import type {
  NotificationCard,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";

type SrmPayload = Extract<
  ExperimentWarningNotificationPayload,
  { type: "srm" }
>;

const LABEL = "Health issue";

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

// Mirrors the front-end pValueFormatter.
const formatPValue = (p: number, digits = 3) =>
  p < Math.pow(10, -digits)
    ? `<0.${"0".repeat(digits - 1)}1`
    : p.toFixed(digits);

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
      pValue !== undefined ? `p-value = ${formatPValue(pValue)}` : undefined,
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
      summary: ["Sample ratio mismatch detected."],
      ...(table ? { table } : {}),
    },
    altText: `${experimentName} - ${LABEL}`,
    caption: `${getExperimentUrlAndNameFormatted(experimentId, experimentName)} - ${LABEL}`,
  };
};
