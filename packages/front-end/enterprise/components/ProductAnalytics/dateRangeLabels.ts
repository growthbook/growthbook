import { dateRangePredefined, lookbackUnit } from "shared/validators";
import type { ComparisonMode, ExplorationDateRange } from "shared/validators";

// Sentence case per .agents/guides/ui-copy-style.md — these are select/radio
// labels, not headings.
export const COMPARISON_MODE_LABELS: Record<ComparisonMode, string> = {
  previousPeriod: "Previous period",
  previousPeriodMatchDayOfWeek: "Previous period (match day of week)",
  previousYear: "Previous year",
  previousYearMatchDayOfWeek: "Previous year (match day of week)",
  custom: "Custom",
};

// Sentence case for the same reason as the map above — and these now sit in the
// same panel as it, the preset rail beside the "Compared to" Select.
export const DATE_RANGE_PREDEFINED_LABELS: Record<
  (typeof dateRangePredefined)[number],
  string
> = {
  today: "Today",
  yesterday: "Yesterday",
  last7Days: "Past 7 days",
  last30Days: "Past 30 days",
  last90Days: "Past 90 days",
  last12Months: "Past 12 months",
  lastCalendarYear: "Last calendar year",
  customLookback: "Custom lookback",
  customDateRange: "Custom date range",
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
    case "yesterday":
    case "last7Days":
    case "last30Days":
    case "last90Days":
    case "last12Months":
    case "lastCalendarYear":
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
