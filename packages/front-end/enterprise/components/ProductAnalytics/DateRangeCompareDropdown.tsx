import { ReactNode, useState } from "react";
import {
  BlockComparison,
  calculateProductAnalyticsDateRange,
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import type { ExplorationDateRange } from "shared/validators";
import DateRangeTriggerPopover from "@/enterprise/components/ProductAnalytics/DateRangeTriggerPopover";
import { formatCollapsedDateRange } from "@/enterprise/components/ProductAnalytics/comparison-chart";
import DateRangeComparePanel, {
  DateRangeCompareValue,
} from "@/enterprise/components/ProductAnalytics/DateRangeComparePanel";
import {
  COMPARISON_MODE_LABELS,
  formatExplorationDateRange,
} from "@/enterprise/components/ProductAnalytics/dateRangeLabels";

/**
 * Collapsed primary window only — the comparison detail lives in the panel and
 * the trigger's tooltip. Naming the mode here made the button wide enough to
 * push the rest of the toolbar around.
 */
function triggerLabel(
  dateRange: ExplorationDateRange,
  fallback: string,
): string {
  if (dateRange.predefined !== "customDateRange") {
    return formatExplorationDateRange(dateRange);
  }
  if (!dateRange.startDate || !dateRange.endDate) return fallback;
  const resolved = calculateProductAnalyticsDateRange(dateRange);
  return formatCollapsedDateRange(resolved.startDate, resolved.endDate);
}

/**
 * What follows "vs" on the trigger. A derived mode is summarised as "prior" —
 * its window is implied by the primary — but a hand-picked one has no such
 * relationship, so it has to show its actual dates.
 */
export function comparisonSuffix(
  dateRange: ExplorationDateRange,
  comparison: BlockComparison | null,
): { text: string; isExplicitRange: boolean } | null {
  if (!comparison?.enabled) return null;
  if (resolveComparisonMode(comparison) !== "custom") {
    return { text: "prior", isExplicitRange: false };
  }
  const previous = resolveComparisonPreviousTimeFrame(dateRange, comparison);
  const resolved = calculateProductAnalyticsDateRange(previous);
  return {
    text: formatCollapsedDateRange(resolved.startDate, resolved.endDate),
    isExplicitRange: true,
  };
}

/** Full primary + comparison detail, shown on hover. */
function triggerTooltip(
  dateRange: ExplorationDateRange,
  comparison: BlockComparison | null,
): string | undefined {
  if (!comparison?.enabled) return undefined;
  const previous = resolveComparisonPreviousTimeFrame(dateRange, comparison);
  const primaryResolved = calculateProductAnalyticsDateRange(dateRange);
  const previousResolved = calculateProductAnalyticsDateRange(previous);
  const mode = resolveComparisonMode(comparison);
  return `${formatCollapsedDateRange(
    primaryResolved.startDate,
    primaryResolved.endDate,
  )} vs ${formatCollapsedDateRange(
    previousResolved.startDate,
    previousResolved.endDate,
  )} — ${COMPARISON_MODE_LABELS[mode]}`;
}

/**
 * Trigger + popover wrapper around {@link DateRangeComparePanel}. Staged edits
 * only reach `onChange` when the user hits Apply, which also closes the popover.
 */
export default function DateRangeCompareDropdown({
  value,
  onChange,
  showCompare = false,
  showGranularity = false,
  granularityDisabled = false,
  granularityDisabledReason,
  disabled,
  extraPresets,
  triggerFallbackLabel = "Date range",
  fullWidth = false,
}: {
  value: DateRangeCompareValue;
  onChange: (next: DateRangeCompareValue) => void;
  showCompare?: boolean;
  /** Show the granularity row inside the panel rather than as a sibling
   * control. Date bucketing only applies to time-series charts. */
  showGranularity?: boolean;
  granularityDisabled?: boolean;
  /** Why granularity is inert, surfaced under the disabled control. */
  granularityDisabledReason?: string;
  disabled?: boolean;
  extraPresets?: ReactNode;
  /** Trigger text when a custom range has no bounds set yet. */
  triggerFallbackLabel?: string;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tooltip = triggerTooltip(value.dateRange, value.comparison);
  const suffix = comparisonSuffix(value.dateRange, value.comparison);

  return (
    <DateRangeTriggerPopover
      open={open}
      onOpenChange={setOpen}
      label={triggerLabel(value.dateRange, triggerFallbackLabel)}
      tooltip={tooltip}
      suffix={suffix}
      disabled={disabled}
      fullWidth={fullWidth}
    >
      <DateRangeComparePanel
        // The panel seeds its draft on mount; remounting per open is what picks
        // up externally-applied changes without clobbering in-progress edits.
        key={open ? "open" : "closed"}
        value={value}
        showCompare={showCompare}
        showGranularity={showGranularity}
        granularityDisabled={granularityDisabled}
        granularityDisabledReason={granularityDisabledReason}
        disabled={disabled}
        extraPresets={extraPresets}
        onCancel={() => setOpen(false)}
        onApply={(next) => {
          // Freeze the window for `custom` so later primary edits can't move it.
          const comparison = next.comparison?.enabled
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
            : null;
          onChange({ ...next, comparison });
          setOpen(false);
        }}
      />
    </DateRangeTriggerPopover>
  );
}
