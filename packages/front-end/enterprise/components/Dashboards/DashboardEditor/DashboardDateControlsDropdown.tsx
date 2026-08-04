import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCalendarBlank, PiCaretDown } from "react-icons/pi";
import { dateGranularity } from "shared/validators";
import type { ExplorationDateRange } from "shared/validators";
import {
  BlockComparison,
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import Tooltip from "@/components/Tooltip/Tooltip";
import UiTooltip from "@/ui/Tooltip";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import DateRangeComparePanel, {
  DateRangeCompareValue,
} from "@/enterprise/components/ProductAnalytics/DateRangeComparePanel";
import { comparisonSuffix } from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import styles from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown.module.scss";
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
  const suffix = value ? comparisonSuffix(value, comparison) : null;
  // An explicit range needs roughly twice the room of the "prior" shorthand.
  const maxWidth = suffix?.isExplicitRange ? 400 : 260;

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
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      showArrow={false}
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
          color="gray"
          size="sm"
          disabled={disabled}
          icon={<PiCalendarBlank aria-hidden />}
          iconPosition="left"
          style={{
            justifyContent: "space-between",
            backgroundColor: "var(--color-surface)",
            maxWidth,
          }}
        >
          <Flex align="center" gap="2" justify="between" width="100%">
            {/* Inside the Button, not around it — Popover matches on
                `trigger.type === Button` to pass `preventDefault`. */}
            <UiTooltip
              content={triggerTooltip ?? ""}
              enabled={!!triggerTooltip}
            >
              <span
                style={{
                  flexGrow: 1,
                  minWidth: 0,
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {getDisplayLabel(value)}
              </span>
            </UiTooltip>
            {suffix && (
              <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                <Text size="small" color="text-low" weight="regular">
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
          key={open ? "open" : "closed"}
          value={{ dateRange: activeDateRange, comparison, granularity }}
          disabled={disabled}
          showCompare={!!onComparisonChange}
          showGranularity
          // "Chart Default" means each block keeps its own range, so there is
          // no dashboard-wide series for a granularity to bucket.
          granularityDisabled={!value}
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
      }
    />
  );
}
