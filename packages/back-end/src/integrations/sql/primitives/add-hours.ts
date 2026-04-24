import { SqlDialect } from "shared/types/sql";

export function addHours(
  dialect: SqlDialect,
  col: string,
  hours: number,
): string {
  if (!hours) return col;
  let unit: "hour" | "minute" = "hour";
  const sign = hours > 0 ? "+" : "-";
  hours = Math.abs(hours);

  const roundedHours = Math.round(hours);
  const roundedMinutes = Math.round(hours * 60);

  let amount = roundedHours;

  // If minutes are needed, use them
  if (roundedMinutes % 60 > 0) {
    unit = "minute";
    amount = roundedMinutes;
  }

  if (amount === 0) {
    return col;
  }

  return dialect.addTime(col, unit, sign, amount);
}
