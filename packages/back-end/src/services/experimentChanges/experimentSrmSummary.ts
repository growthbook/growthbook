import type { ExperimentWarningNotificationPayload } from "shared/validators";
import { formatInteger, pValueFormatter } from "shared/util";
import { escapeInlineMarkdown } from "back-end/src/services/notificationCards/markdown";
import type { CardTable } from "back-end/src/services/notificationCards/types";

export type SrmPayload = Extract<
  ExperimentWarningNotificationPayload,
  { type: "srm" }
>;

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
    units: formatInteger(v.users),
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

// Label/value pairs for the text message, mirroring the card's balance table:
// the test result, then one line per variation. Values are card markdown.
export function getSrmFields(
  data: SrmPayload,
): { label: string; value: string }[] {
  const evidence = [
    data.pValue !== undefined
      ? `p-value ${pValueFormatter(data.pValue)}`
      : undefined,
    `threshold ${data.threshold}`,
  ]
    .filter(Boolean)
    .join(", ");
  const balance = balanceRows(data)
    .map(
      (r) =>
        `${escapeInlineMarkdown(r.name)}: ${r.units} units (${r.actual}, expected ${r.expected})`,
    )
    .join("\n");
  return [
    {
      label: "Traffic split",
      value: `Traffic isn't splitting as configured (${evidence}).`,
    },
    ...(balance ? [{ label: "Variations", value: balance }] : []),
  ];
}
