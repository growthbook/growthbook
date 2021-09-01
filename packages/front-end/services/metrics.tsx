import { MetricType } from "back-end/types/metric";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

export const defaultWinRiskThreshold = 0.0025;
export const defaultLoseRiskThreshold = 0.0125;
export const defaultVarianceThreshold = 0.50;
export const defaultMinConversionThresholdSignificance = 150;

export function getMetricConversionTitle(type: MetricType): string {
  // TODO: support more metric types
  if (type === "count") {
    return "Count per User";
  }
  if (type === "duration") {
    return "Duration";
  }
  if (type === "revenue") {
    return "Revenue";
  }
  return "Conversion Rate";
}
export function formatConversionRate(type: MetricType, value: number): string {
  value = value || 0;
  if (type === "count") {
    return value.toFixed(2);
  }
  if (type === "duration") {
    // milliseconds
    if (value < 1) {
      return Math.round(value * 1000) + "ms";
    }
    // seconds
    if (value < 60) {
      return Math.round(value * 1000) / 1000 + "s";
    }

    // time string (00:00.00)
    const trimmed = Math.round(value * 10) / 10;
    const dec = (Math.round((trimmed % 1) * 10) + "").replace(/0$/, "");
    const s = "" + (Math.floor(trimmed) % 60);
    const m = "" + (Math.floor(trimmed / 60) % 60);
    const h = "" + (Math.floor(trimmed / 3600) % 24);
    const d = Math.floor(trimmed / (3600 * 24));

    const f =
      (d > 0 ? d + " days " : "") +
      (trimmed > 1800 ? h.padStart(2, "0") + ":" : "") +
      m.padStart(2, "0") +
      ":" +
      s.padStart(2, "0") +
      (trimmed < 300 && dec ? "." + dec : "");

    return f;
  }
  if (type === "revenue") {
    return currencyFormatter.format(value);
  }

  return percentFormatter.format(value);
}
