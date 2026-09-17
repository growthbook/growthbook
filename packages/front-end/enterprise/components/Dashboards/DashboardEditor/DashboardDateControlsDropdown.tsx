import { useState } from "react";
import { dateGranularity } from "shared/validators";
import type { ExplorationDateRange } from "shared/validators";
import {
  BlockComparison,
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import DateRangeTriggerPopover from "@/enterprise/components/ProductAnalytics/DateRangeTriggerPopover";
import DateRangeComparePanel, {
  DateRangeCompareValue,
} from "@/enterprise/components/ProductAnalytics/DateRangeComparePanel";
import { comparisonSuffix } from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import {
  COMPARISON_MODE_LABELS,
  formatExplorationDateRange,
} from "@/enterprise/components/ProductAnalytics/dateRangeLabels";
import styles from "./DashboardControlPill.module.scss";

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
    customDateRangeFallback: "Date range",
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

/** Everything one Apply changes, so the caller can persist it in one write. */
export type DashboardDateControlsValue = {
  /** Null means "Chart Default" — no dashboard-wide range. */
  dateRange: ExplorationDateRange | null;
  granularity: (typeof dateGranularity)[number];
  comparison: BlockComparison | undefined;
};

export default function DashboardDateControlsDropdown({
  value,
  granularity = "auto",
  comparison = null,
  showCompare = false,
  onApply,
  disabled,
}: {
  value: ExplorationDateRange | null;
  granularity?: (typeof dateGranularity)[number];
  comparison?: BlockComparison | null;
  showCompare?: boolean;
  /** One callback for all three fields. Separate per-field callbacks each
   * persisted from the same render-scope state, so the last write undid the
   * others. */
  onApply: (next: DashboardDateControlsValue) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const activeDateRange = value ?? DEFAULT_DATE_RANGE;
  const triggerTooltip = getDisplayTooltip(value, comparison);
  // No suffix on "Chart Default": there is no dashboard-wide window for a
  // comparison to hang off, so "vs prior" would describe nothing.
  const suffix = value ? comparisonSuffix(value, comparison) : null;

  return (
    <DateRangeTriggerPopover
      open={open}
      onOpenChange={setOpen}
      label={getDisplayLabel(value)}
      tooltip={triggerTooltip}
      suffix={suffix}
      disabled={disabled}
      // This trigger leads the dashboard's filter-pill row: it gets the same
      // opaque pill fill as its neighbours, and anchors the panel on its left
      // edge so the panel opens into the row rather than off the left margin.
      align="start"
      triggerClassName={styles.controlPill}
    >
      <DateRangeComparePanel
        key={open ? "open" : "closed"}
        // `dateRange` still seeds the calendar on "Chart Default" so picking a
        // preset starts from something sensible; `cleared` is what says nothing
        // is in effect. The panel owns the rail item and stages it like the rest.
        value={{
          dateRange: activeDateRange,
          comparison,
          granularity,
          cleared: value === null,
        }}
        disabled={disabled}
        showCompare={showCompare}
        showGranularity
        granularityDisabledReason="Pick a dashboard-wide date range to set granularity. On Chart Default, each chart keeps its own."
        clearOption={{
          label: "Chart Default",
          tooltip:
            "Use each chart's own configured date range instead of applying a dashboard-wide date filter.",
        }}
        onCancel={() => setOpen(false)}
        onApply={(next: DateRangeCompareValue) => {
          onApply({
            dateRange: next.cleared ? null : next.dateRange,
            granularity: next.granularity ?? granularity,
            // Freeze the window for `custom` so later primary edits can't move it.
            comparison: next.comparison?.enabled
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
              : undefined,
          });
          setOpen(false);
        }}
      />
    </DateRangeTriggerPopover>
  );
}
