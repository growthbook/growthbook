import type { ExperimentWarningNotificationPayload } from "shared/validators";
import { pValueFormatter } from "shared/util";
import type { CardTable } from "back-end/src/services/notificationCards/types";

export type SrmPayload = Extract<
  ExperimentWarningNotificationPayload,
  { type: "srm" }
>;

export const SRM_LABEL = "Health Alert - SRM Detected";

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

export const getSrmTotalUnits = (data: SrmPayload): number | undefined =>
  data.variations?.length
    ? data.variations.reduce((sum, v) => sum + v.users, 0)
    : undefined;

// Per-variation actual vs. expected split, as rows of formatted strings.
function balanceRows(data: SrmPayload) {
  const { variations } = data;
  if (!variations?.length) return [];
  const totalUsers = variations.reduce((sum, v) => sum + v.users, 0);
  const totalWeight = variations.reduce((sum, v) => sum + v.weight, 0);
  const pct = (n: number, d: number) =>
    d > 0 ? percentFormatter.format(n / d) : "-";
  return variations.map((v) => ({
    name: v.name,
    units: numberFormatter.format(v.users),
    actual: pct(v.users, totalUsers),
    expected: pct(v.weight, totalWeight),
  }));
}

// Same layout as the Health tab's balance check: actual vs. configured split.
export function buildSrmBalanceTable(data: SrmPayload): CardTable | null {
  const rows = balanceRows(data);
  if (!rows.length) return null;
  return {
    columns: ["Variation", "Units", "Actual %", "Expected %"],
    rows: rows.map((r) => [r.name, r.units, r.actual, r.expected]),
    // Units live in the standard footer; the note carries the test result.
    ...(data.pValue !== undefined
      ? { note: `p-value: ${pValueFormatter(data.pValue)}` }
      : {}),
  };
}

// "Health Alert - SRM Detected. Traffic isn't splitting as configured
// (p-value: <0.001, threshold 0.001). Control: 6,213 units (62.1%, expected
// 50%); One-page checkout: 3,787 units (37.9%, expected 50%)."
export function getSrmText(data: SrmPayload): string {
  const evidence = [
    data.pValue !== undefined
      ? `p-value: ${pValueFormatter(data.pValue)}`
      : undefined,
    `threshold ${data.threshold}`,
  ]
    .filter(Boolean)
    .join(", ");
  const balance = balanceRows(data)
    .map(
      (r) =>
        `${r.name}: ${r.units} units (${r.actual}, expected ${r.expected})`,
    )
    .join("; ");
  return [
    `${SRM_LABEL}.`,
    `Traffic isn't splitting as configured (${evidence}).`,
    balance ? `${balance}.` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}
