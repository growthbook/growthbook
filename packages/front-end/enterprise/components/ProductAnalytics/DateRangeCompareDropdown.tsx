import { ReactNode, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCalendarBlank, PiCaretDown } from "react-icons/pi";
import {
  BlockComparison,
  calculateProductAnalyticsDateRange,
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import type { ExplorationDateRange } from "shared/validators";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { formatCollapsedDateRange } from "@/enterprise/components/ProductAnalytics/comparison-chart";
import DateRangeComparePanel, {
  DateRangeCompareValue,
} from "@/enterprise/components/ProductAnalytics/DateRangeComparePanel";
import {
  COMPARISON_MODE_LABELS,
  formatExplorationDateRange,
} from "@/enterprise/components/ProductAnalytics/dateRangeLabels";
import styles from "./DateRangeCompareDropdown.module.scss";

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
  disabled,
  extraPresets,
  triggerFallbackLabel = "Date Range",
  fullWidth = false,
}: {
  value: DateRangeCompareValue;
  onChange: (next: DateRangeCompareValue) => void;
  showCompare?: boolean;
  /** Show the granularity row inside the panel rather than as a sibling
   * control. Date bucketing only applies to time-series charts. */
  showGranularity?: boolean;
  granularityDisabled?: boolean;
  disabled?: boolean;
  extraPresets?: ReactNode;
  /** Trigger text when a custom range has no bounds set yet. */
  triggerFallbackLabel?: string;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tooltip = triggerTooltip(value.dateRange, value.comparison);
  const suffix = comparisonSuffix(value.dateRange, value.comparison);
  // An explicit range needs roughly twice the room of the "prior" shorthand.
  const maxWidth = suffix?.isExplicitRange ? 400 : 260;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      showArrow={false}
      // The comparison-mode Select and the calendar render in their own Radix
      // poppers; clicking inside one must not dismiss this panel.
      onInteractOutside={(event) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest("[data-radix-popper-content-wrapper]")
        ) {
          event.preventDefault();
        }
      }}
      contentStyle={{ padding: 0, width: 640 }}
      trigger={
        <Button
          className={styles.trigger}
          variant="outline"
          // Neutral, with a surface fill: this sits beside Select-based controls
          // (variant="surface"), and Button's default violet made it read as the
          // odd one out in the toolbar.
          color="gray"
          size="md"
          disabled={disabled}
          icon={<PiCalendarBlank aria-hidden />}
          iconPosition="left"
          style={{
            justifyContent: "space-between",
            backgroundColor: "var(--color-surface)",
            ...(fullWidth ? { width: "100%" } : { maxWidth }),
          }}
        >
          <Flex align="center" gap="2" justify="between" width="100%">
            {/* Tooltip sits inside the Button, not around it — Popover matches on
                `trigger.type === Button` to pass `preventDefault`. */}
            <Tooltip content={tooltip ?? ""} enabled={!!tooltip}>
              <span
                style={{
                  // Absorb the slack so the label hugs the icon; without this
                  // `justify="between"` spreads it toward the middle.
                  flexGrow: 1,
                  minWidth: 0,
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {triggerLabel(value.dateRange, triggerFallbackLabel)}
              </span>
            </Tooltip>
            {suffix && (
              <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                <Text size="sm" color="text-low" weight="regular">
                  vs {suffix.text}
                </Text>
              </span>
            )}
            <PiCaretDown aria-hidden style={{ flexShrink: 0 }} />
          </Flex>
        </Button>
      }
      content={
        <DateRangeComparePanel
          // The panel seeds its draft on mount; remounting per open is what picks
          // up externally-applied changes without clobbering in-progress edits.
          key={open ? "open" : "closed"}
          value={value}
          showCompare={showCompare}
          showGranularity={showGranularity}
          granularityDisabled={granularityDisabled}
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
      }
    />
  );
}
