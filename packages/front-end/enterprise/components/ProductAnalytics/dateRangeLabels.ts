import { dateRangePredefined, lookbackUnit } from "shared/validators";
import type { ExplorationDateRange } from "shared/validators";

export const DATE_RANGE_PREDEFINED_LABELS: Record<
  (typeof dateRangePredefined)[number],
  string
> = {
  today: "Today",
  last7Days: "Past 7 Days",
  last30Days: "Past 30 Days",
  last90Days: "Past 90 Days",
  customLookback: "Custom Lookback",
  customDateRange: "Custom Date Range",
};

export const LOOKBACK_UNIT_LABELS: Record<
  (typeof lookbackUnit)[number],
  string
> = {
  hour: "hour(s)",
  day: "day(s)",
  week: "week(s)",
  month: "month(s)",
};

function formatLookbackUnit(
  unit: (typeof lookbackUnit)[number],
  value: number,
): string {
  return `${unit}${value === 1 ? "" : "s"}`;
}

export function formatExplorationDateRange(
  dateRange: ExplorationDateRange,
  {
    customDateRangeFallback,
    startPlaceholder = "Start",
    endPlaceholder = "End",
  }: {
    customDateRangeFallback?: string;
    startPlaceholder?: string;
    endPlaceholder?: string;
  } = {},
): string {
  switch (dateRange.predefined) {
    case "today":
    case "last7Days":
    case "last30Days":
    case "last90Days":
      return DATE_RANGE_PREDEFINED_LABELS[dateRange.predefined];
    case "customLookback": {
      const lookbackValue = dateRange.lookbackValue ?? 30;
      const unit = dateRange.lookbackUnit ?? "day";
      return `Past ${lookbackValue} ${formatLookbackUnit(unit, lookbackValue)}`;
    }
    case "customDateRange":
      return customDateRangeFallback &&
        (!dateRange.startDate || !dateRange.endDate)
        ? customDateRangeFallback
        : `${dateRange.startDate ?? startPlaceholder} to ${
            dateRange.endDate ?? endPlaceholder
          }`;
    default: {
      const exhaustiveCheck: never = dateRange.predefined;
      return exhaustiveCheck;
    }
  }
}
