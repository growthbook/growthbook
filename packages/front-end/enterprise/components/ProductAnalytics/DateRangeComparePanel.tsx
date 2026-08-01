import { ReactNode, useState } from "react";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import { format, startOfMonth, subMonths } from "date-fns";
import { DateRange, DayPicker } from "react-day-picker";
import {
  comparisonMode as comparisonModes,
  dateRangePredefined,
  lookbackUnit,
} from "shared/validators";
import type { ComparisonMode, ExplorationDateRange } from "shared/validators";
import {
  BlockComparison,
  calculateProductAnalyticsDateRange,
  getOverlappingComparisonModes,
  getPrimaryUtcDayBounds,
  isPositiveLookbackValue,
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import { getValidDateOffsetByUTC } from "shared/dates";
import Button from "@/ui/Button";
import DatePicker from "@/components/DatePicker";
import Field from "@/components/Forms/Field";
import { Select, SelectItem } from "@/ui/Select";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { formatCollapsedDateRange } from "@/enterprise/components/ProductAnalytics/comparison-chart";
import {
  COMPARISON_MODE_LABELS,
  DATE_RANGE_PREDEFINED_LABELS,
  LOOKBACK_UNIT_LABELS,
} from "@/enterprise/components/ProductAnalytics/dateRangeLabels";

export type DateRangeCompareValue = {
  dateRange: ExplorationDateRange;
  comparison: BlockComparison | null;
};

function toYyyyMmDd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function describeRange(dr: ExplorationDateRange): string {
  const resolved = calculateProductAnalyticsDateRange(dr);
  return formatCollapsedDateRange(resolved.startDate, resolved.endDate);
}

function LabeledRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Grid columns="92px minmax(0, 1fr)" align="center" gapX="2">
      <Text size="small" color="text-low">
        {label}
      </Text>
      {children}
    </Grid>
  );
}

/**
 * GA4-style date range panel: preset rail, two-month calendar, and a compare
 * section that names how the previous period is derived.
 *
 * Edits are staged in local state and only surface via `onApply`, so switching
 * presets or comparison modes doesn't fire a warehouse query per keystroke.
 */
export default function DateRangeComparePanel({
  value,
  onApply,
  onCancel,
  showCompare = false,
  disabled,
  extraPresets,
  extraSections,
}: {
  value: DateRangeCompareValue;
  onApply: (next: DateRangeCompareValue) => void;
  onCancel?: () => void;
  /** Opt in to the compare section; off by default so surfaces that can't
   * render a previous period show no trace of it. */
  showCompare?: boolean;
  disabled?: boolean;
  /** Rendered above the presets — e.g. the dashboard's "Chart Default" option. */
  extraPresets?: ReactNode;
  /** Rendered between the compare section and the footer — e.g. granularity. */
  extraSections?: ReactNode;
}) {
  // Seeded once per mount. The parent rebuilds `value` on every render, so
  // syncing to it in an effect would revert staged edits as fast as they're made
  // — callers remount this panel (e.g. on popover open) to pick up new values.
  const [draft, setDraft] = useState<DateRangeCompareValue>(value);

  const { dateRange, comparison } = draft;
  const compareEnabled = !!comparison?.enabled;
  const mode = comparison
    ? resolveComparisonMode(comparison)
    : "previousPeriod";

  const isCustomRange = dateRange.predefined === "customDateRange";
  // `customLookback` resolves relative to now, so a non-positive value would
  // either silently fall back to the 30-day default or invert the window.
  const isInvalidLookback =
    dateRange.predefined === "customLookback" &&
    !isPositiveLookbackValue(dateRange.lookbackValue);
  // Range mode reports `{ from, to: undefined }` after the first click. Resolving
  // that would silently fall back to "now" for the missing end, so hold off on
  // every derived value until both ends exist.
  const isPartialRange =
    isCustomRange && (!dateRange.startDate || !dateRange.endDate);

  // Presets carry no explicit bounds, so read the window they resolve to — that
  // way the calendar always highlights whatever the rail has selected.
  const primaryBounds = getPrimaryUtcDayBounds(dateRange);
  const calendarFrom = dateRange.startDate
    ? getValidDateOffsetByUTC(dateRange.startDate)
    : isPartialRange
      ? undefined
      : getValidDateOffsetByUTC(primaryBounds.startDate);
  const calendarTo = isPartialRange
    ? undefined
    : getValidDateOffsetByUTC(
        isCustomRange ? (dateRange.endDate as string) : primaryBounds.endDate,
      );

  const resolvedPrevious = resolveComparisonPreviousTimeFrame(
    dateRange,
    comparison ?? {},
  );
  // Every mode whose window would double-count days shared with the primary.
  // Both year modes can land here — `previousYear` past a calendar year, and
  // `previousYearMatchDayOfWeek` past its fixed 364-day shift.
  const overlappingModes = getOverlappingComparisonModes(dateRange);

  // Left-hand month; the range end lands in the right-hand month.
  const monthForBounds = (endDate: string) =>
    subMonths(startOfMonth(getValidDateOffsetByUTC(endDate)), 1);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    monthForBounds(primaryBounds.endDate),
  );

  const setDateRange = (next: ExplorationDateRange) =>
    setDraft((prev) => ({ ...prev, dateRange: next }));

  /**
   * Patches one end of the custom comparison window. The range picker sets both
   * ends in the same tick, so the base window is read from `prev` inside the
   * updater — reading it from render scope would let the second call overwrite
   * the first.
   */
  const setCustomPrevious = (patch: {
    startDate?: Date | undefined;
    endDate?: Date | undefined;
  }) =>
    setDraft((prev) => {
      const base = resolveComparisonPreviousTimeFrame(
        prev.dateRange,
        prev.comparison ?? {},
      );
      return {
        ...prev,
        comparison: {
          enabled: true,
          mode: "custom",
          previousTimeFrame: {
            ...base,
            predefined: "customDateRange",
            ...("startDate" in patch
              ? {
                  startDate: patch.startDate
                    ? toYyyyMmDd(patch.startDate)
                    : null,
                }
              : {}),
            ...("endDate" in patch
              ? { endDate: patch.endDate ? toYyyyMmDd(patch.endDate) : null }
              : {}),
          },
        },
      };
    });

  const selectPreset = (predefined: (typeof dateRangePredefined)[number]) => {
    let next: ExplorationDateRange;
    if (predefined === "customDateRange") {
      // Open the custom range on the window currently displayed rather than any
      // stale bounds left over from an earlier custom selection.
      next = {
        ...dateRange,
        predefined,
        startDate: primaryBounds.startDate,
        endDate: primaryBounds.endDate,
      };
    } else if (predefined === "customLookback") {
      next = {
        ...dateRange,
        predefined,
        lookbackValue: dateRange.lookbackValue ?? 30,
        lookbackUnit: dateRange.lookbackUnit ?? "day",
        startDate: null,
        endDate: null,
      };
    } else {
      next = { ...dateRange, predefined, startDate: null, endDate: null };
    }
    setDateRange(next);
    setCalendarMonth(monthForBounds(getPrimaryUtcDayBounds(next).endDate));
  };

  return (
    <Flex direction="column" style={{ minWidth: 0 }}>
      <Flex align="stretch" style={{ minWidth: 0 }}>
        <Box
          role="group"
          aria-label="Date range presets"
          style={{
            width: 168,
            flexShrink: 0,
            borderRight: "1px solid var(--gray-a5)",
            padding: "var(--space-2)",
          }}
        >
          {extraPresets}
          {dateRangePredefined.map((option) => {
            const active = dateRange.predefined === option;
            return (
              <Box
                key={option}
                role="button"
                // The selected preset is otherwise conveyed by background and
                // weight alone, which assistive tech can't read (WCAG 4.1.2).
                aria-pressed={active}
                aria-disabled={disabled || undefined}
                tabIndex={disabled ? -1 : 0}
                onClick={() => !disabled && selectPreset(option)}
                onKeyDown={(e) => {
                  if (disabled) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectPreset(option);
                  }
                }}
                style={{
                  padding: "6px 8px",
                  borderRadius: "var(--radius-2)",
                  cursor: disabled ? "default" : "pointer",
                  background: active ? "var(--violet-a4)" : undefined,
                  color: active ? "var(--violet-11)" : "var(--gray-11)",
                  fontWeight: active ? 500 : 400,
                  fontSize: "var(--font-size-2)",
                }}
              >
                {DATE_RANGE_PREDEFINED_LABELS[option]}
              </Box>
            );
          })}
        </Box>

        <Box style={{ flex: 1, minWidth: 0, padding: "var(--space-3)" }}>
          {dateRange.predefined === "customLookback" ? (
            <Flex align="start" gap="2" mb="3">
              <Field
                type="number"
                min="1"
                step="1"
                containerClassName="mb-0"
                style={{ width: 80, height: 32 }}
                disabled={disabled}
                error={isInvalidLookback ? "Must be 1 or more" : undefined}
                value={dateRange.lookbackValue ?? ""}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  setDateRange({
                    ...dateRange,
                    lookbackValue: Number.isNaN(parsed) ? null : parsed,
                  });
                }}
              />
              <Select
                size="small"
                style={{ width: 120 }}
                disabled={disabled}
                value={dateRange.lookbackUnit ?? "day"}
                setValue={(unit) =>
                  setDateRange({
                    ...dateRange,
                    lookbackUnit: unit as (typeof lookbackUnit)[number],
                  })
                }
              >
                {lookbackUnit.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {LOOKBACK_UNIT_LABELS[unit]}
                  </SelectItem>
                ))}
              </Select>
            </Flex>
          ) : null}

          <DayPicker
            mode="range"
            numberOfMonths={2}
            showOutsideDays
            selected={{ from: calendarFrom, to: calendarTo }}
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            disabled={disabled}
            onSelect={(range: DateRange | undefined) => {
              if (!range) return;
              // Any manual pick is a custom range, so the rail follows the calendar.
              setDateRange({
                ...dateRange,
                predefined: "customDateRange",
                startDate: range.from ? toYyyyMmDd(range.from) : null,
                endDate: range.to ? toYyyyMmDd(range.to) : null,
              });
            }}
          />

          <Text size="small" color="text-low">
            {isPartialRange
              ? "Pick an end date to finish the range"
              : isInvalidLookback
                ? "Enter a lookback of 1 or more to see a date range"
                : describeRange(dateRange)}
          </Text>
        </Box>
      </Flex>

      {showCompare && (
        <>
          <Separator size="4" />
          <Box p="3">
            <Switch
              label="Compare"
              value={compareEnabled}
              disabled={disabled}
              onChange={(checked) =>
                setDraft((prev) => ({
                  ...prev,
                  comparison: checked
                    ? { enabled: true, mode: "previousPeriod" }
                    : null,
                }))
              }
            />

            {compareEnabled && !isPartialRange && (
              <Flex direction="column" gap="2" mt="3" style={{ minWidth: 0 }}>
                <LabeledRow label="Date range">
                  <Text size="small">{describeRange(dateRange)}</Text>
                </LabeledRow>

                <LabeledRow label="Compared to">
                  <Select
                    size="small"
                    style={{ width: "100%" }}
                    disabled={disabled}
                    value={mode}
                    setValue={(next) =>
                      setDraft((prev) => ({
                        ...prev,
                        comparison: {
                          enabled: true,
                          mode: next as ComparisonMode,
                          ...(next === "custom"
                            ? { previousTimeFrame: resolvedPrevious }
                            : {}),
                        },
                      }))
                    }
                  >
                    {comparisonModes.map((m) => (
                      <SelectItem
                        key={m}
                        value={m}
                        disabled={overlappingModes.includes(m)}
                      >
                        {COMPARISON_MODE_LABELS[m]}
                      </SelectItem>
                    ))}
                  </Select>
                </LabeledRow>

                {overlappingModes.length > 0 && (
                  <LabeledRow label="">
                    <Text size="small" color="text-low">
                      {`${overlappingModes
                        .map((m) => COMPARISON_MODE_LABELS[m])
                        .join(" and ")} ${
                        overlappingModes.length > 1 ? "are" : "is"
                      } unavailable because the window would overlap this date range`}
                    </Text>
                  </LabeledRow>
                )}

                <LabeledRow label="">
                  {mode === "custom" ? (
                    <DatePicker
                      containerClassName="mb-0"
                      compact
                      disabled={disabled}
                      precision="date"
                      date={
                        resolvedPrevious.startDate
                          ? getValidDateOffsetByUTC(resolvedPrevious.startDate)
                          : undefined
                      }
                      date2={
                        resolvedPrevious.endDate
                          ? getValidDateOffsetByUTC(resolvedPrevious.endDate)
                          : undefined
                      }
                      setDate={(d) => setCustomPrevious({ startDate: d })}
                      setDate2={(d) => setCustomPrevious({ endDate: d })}
                    />
                  ) : (
                    <Text size="small" color="text-low">
                      {describeRange(resolvedPrevious)}
                    </Text>
                  )}
                </LabeledRow>
              </Flex>
            )}
          </Box>
        </>
      )}

      {extraSections && (
        <>
          <Separator size="4" />
          <Box p="3">{extraSections}</Box>
        </>
      )}

      <Separator size="4" />
      <Flex justify="end" gap="2" p="3">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          disabled={disabled || isPartialRange || isInvalidLookback}
          onClick={() => onApply(draft)}
        >
          Apply
        </Button>
      </Flex>
    </Flex>
  );
}
