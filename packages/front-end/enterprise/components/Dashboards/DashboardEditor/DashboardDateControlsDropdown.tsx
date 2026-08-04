import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { dateGranularity } from "shared/validators";
import type { ExplorationDateRange } from "shared/validators";
import {
  BlockComparison,
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import Tooltip from "@/components/Tooltip/Tooltip";
import DateRangeTriggerPopover from "@/enterprise/components/ProductAnalytics/DateRangeTriggerPopover";
import DateRangeComparePanel, {
  DateRangeCompareValue,
} from "@/enterprise/components/ProductAnalytics/DateRangeComparePanel";
import { comparisonSuffix } from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import {
  COMPARISON_MODE_LABELS,
  formatExplorationDateRange,
} from "@/enterprise/components/ProductAnalytics/dateRangeLabels";

const DEFAULT_DATE_RANGE: ExplorationDateRange = {
  predefined: "last30Days",
  lookbackValue: null,
  lookbackUnit: null,
  startDate: null,
  endDate: null,
};

function getDisplayLabel(value: ExplorationDateRange | null): string {
  if (!value) return "Chart Default";
  return formatExplorationDateRange(value, {
    customDateRangeFallback: "Date Range",
  });
}

/** Full comparison detail on hover, so the trigger itself stays short. */
function getDisplayTooltip(
  value: ExplorationDateRange | null,
  comparison: BlockComparison | null,
): string | undefined {
  if (!value || !comparison?.enabled) return undefined;
  return `Compared to ${COMPARISON_MODE_LABELS[resolveComparisonMode(comparison)]}`;
}

export default function DashboardDateControlsDropdown({
  value,
  granularity = "auto",
  onChange,
  onGranularityChange,
  comparison = null,
  onComparisonChange,
  disabled,
}: {
  value: ExplorationDateRange | null;
  granularity?: (typeof dateGranularity)[number];
  onChange: (dateRange: ExplorationDateRange | null) => void;
  onGranularityChange: (granularity: (typeof dateGranularity)[number]) => void;
  comparison?: BlockComparison | null;
  onComparisonChange?: (comparison: BlockComparison | undefined) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const activeDateRange = value ?? DEFAULT_DATE_RANGE;
  const triggerTooltip = getDisplayTooltip(value, comparison);
  // No suffix on "Chart Default": there is no dashboard-wide window for a
  // comparison to hang off, so "vs prior" would describe nothing.
  const suffix = value ? comparisonSuffix(value, comparison) : null;

  const chartDefaultOption = (
    <Box
      role="button"
      // Matches the preset rail below it: selection is otherwise conveyed by
      // background and weight alone, which assistive tech can't read.
      aria-pressed={value === null}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (disabled) return;
        onChange(null);
        setOpen(false);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onChange(null);
          setOpen(false);
        }
      }}
      style={{
        padding: "6px 8px",
        borderRadius: "var(--radius-2)",
        cursor: disabled ? "default" : "pointer",
        background: value === null ? "var(--violet-a4)" : undefined,
        color: value === null ? "var(--violet-11)" : "var(--gray-11)",
        fontWeight: value === null ? 500 : 400,
        fontSize: "var(--font-size-2)",
        whiteSpace: "nowrap",
      }}
    >
      Chart Default
      <Tooltip
        body="Use each chart's own configured date range instead of applying a dashboard-wide date filter."
        tipPosition="right"
        className="ml-1"
      />
    </Box>
  );

  return (
    <DateRangeTriggerPopover
      open={open}
      onOpenChange={setOpen}
      label={getDisplayLabel(value)}
      tooltip={triggerTooltip}
      suffix={suffix}
      disabled={disabled}
    >
      <DateRangeComparePanel
        key={open ? "open" : "closed"}
        value={{ dateRange: activeDateRange, comparison, granularity }}
        disabled={disabled}
        showCompare={!!onComparisonChange}
        showGranularity
        // "Chart Default" means each block keeps its own range, so there is
        // no dashboard-wide series for a granularity to bucket.
        granularityDisabled={!value}
        granularityDisabledReason="Pick a dashboard-wide date range to set granularity. On Chart Default, each chart keeps its own."
        extraPresets={chartDefaultOption}
        onCancel={() => setOpen(false)}
        onApply={(next: DateRangeCompareValue) => {
          onChange(next.dateRange);
          if (next.granularity && next.granularity !== granularity) {
            onGranularityChange(next.granularity);
          }
          if (onComparisonChange) {
            const nextComparison = next.comparison?.enabled
              ? {
                  ...next.comparison,
                  ...(resolveComparisonMode(next.comparison) === "custom"
                    ? {
                        previousTimeFrame: resolveComparisonPreviousTimeFrame(
                          next.dateRange,
                          next.comparison,
                        ),
                      }
                    : {}),
                }
              : undefined;
            onComparisonChange(nextComparison);
          }
          setOpen(false);
        }}
      />
    </DateRangeTriggerPopover>
  );
}
