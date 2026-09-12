import type { NotificationEvent } from "shared/types/events/notification-events";
import {
  type ExperimentWarningNotificationPayload,
  srm,
} from "shared/validators";
import type { CardTable, EventCardData } from "./cardImages";

type SrmPayload = Extract<
  ExperimentWarningNotificationPayload,
  { type: "srm" }
>;

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

// Cards are built from the event payload alone
export function buildEventSnapshotCard(
  event: NotificationEvent,
): EventCardData | null {
  if (
    event.event === "experiment.warning" &&
    event.data.object.type === "srm"
  ) {
    const parsed = srm.safeParse(event.data.object);
    if (!parsed.success) return null;
    const table = buildSrmBalanceTable(parsed.data);
    return {
      state: "warning",
      event: "warning",
      name: parsed.data.experimentName,
      key: parsed.data.experimentId,
      summary: ["Sample ratio mismatch detected."],
      ...(table ? { table } : {}),
    };
  }
  return null;
}
