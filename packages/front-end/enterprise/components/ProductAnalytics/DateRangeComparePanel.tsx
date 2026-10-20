import { CSSProperties, ReactNode, useId, useState } from "react";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import { format, startOfMonth, subMonths } from "date-fns";
import { DateRange, DayPicker } from "react-day-picker";
import {
  comparisonMode as comparisonModes,
  dateRangePredefined,
  lookbackUnit,
} from "shared/validators";
import type {
  ComparisonMode,
  dateGranularity,
  ExplorationDateRange,
} from "shared/validators";
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
import HelperText from "@/ui/HelperText";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import { formatCollapsedDateRange } from "@/enterprise/components/ProductAnalytics/comparison-chart";
import { ControlledGranularitySelector } from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/GranularitySelector";
import {
  COMPARISON_MODE_LABELS,
  DATE_RANGE_PREDEFINED_LABELS,
  LOOKBACK_UNIT_LABELS,
} from "@/enterprise/components/ProductAnalytics/dateRangeLabels";

export type DateRangeCompareValue = {
  dateRange: ExplorationDateRange;
  comparison: BlockComparison | null;
  /** Only meaningful when the surface opts in with `showGranularity`. */
  granularity?: (typeof dateGranularity)[number];
  /** Staged "no date range at all" (see `clearOption`). `dateRange` stays
   * populated for derived values, so read this rather than a null range. */
  cleared?: boolean;
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
      <Text size="sm" color="text-low">
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
  showGranularity = false,
  granularityDisabled = false,
  granularityDisabledReason,
  disabled,
  clearOption,
  extraSections,
}: {
  value: DateRangeCompareValue;
  onApply: (next: DateRangeCompareValue) => void;
  onCancel?: () => void;
  /** Opt in to the compare section; off by default so surfaces that can't
   * render a previous period show no trace of it. */
  showCompare?: boolean;
  /** Opt in to the granularity row. Bucketing only means something for a time
   * series, so surfaces without a date dimension leave it off. */
  showGranularity?: boolean;
  /** Granularity is inert but still worth showing — e.g. a block inheriting the
   * dashboard date filter. */
  granularityDisabled?: boolean;
  /** Why granularity is inert. A greyed-out control with no explanation reads as
   * broken, so surfaces that disable it should say what would re-enable it. */
  granularityDisabledReason?: string;
  disabled?: boolean;
  /** Adds a first rail item staging "no date range" (the dashboard's "Chart
   * Default"), mutually exclusive with the presets. Read back as `cleared`. */
  clearOption?: { label: string; tooltip?: string };
  /** Rendered between the granularity section and the footer. */
  extraSections?: ReactNode;
}) {
  // Seeded once per mount. The parent rebuilds `value` on every render, so
  // syncing to it in an effect would revert staged edits as fast as they're made
  // — callers remount this panel (e.g. on popover open) to pick up new values.
  const [draft, setDraft] = useState<DateRangeCompareValue>(value);
  // Unique per instance so the two comparison inputs keep their label
  // association even if a second panel is mounted.
  const customComparisonId = useId();

  const { dateRange, comparison } = draft;
  // Guarded so a stale `cleared` on a surface without `clearOption` can't blank
  // the rail. No range staged means no series left for granularity to bucket.
  const cleared = !!clearOption && !!draft.cleared;
  const granularityInert = granularityDisabled || cleared;
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
  // A mode picked while it was safe stays selected as the primary widens under
  // it, so the selection itself can go stale. Disabling the option only stops
  // re-picking it; Apply has to refuse the stale selection too.
  const selectedModeOverlaps =
    compareEnabled && overlappingModes.includes(mode);
  // Named by the Select's own error instead, so don't repeat it in the list.
  const unavailableModes = overlappingModes.filter((m) => m !== mode);
  // Half-picked custom window: resolving it falls back to a date the user never
  // chose, so Apply refuses it the way it refuses a partial primary.
  const isPartialCustomComparison =
    compareEnabled &&
    mode === "custom" &&
    (!resolvedPrevious.startDate || !resolvedPrevious.endDate);

  // Left-hand month; the range end lands in the right-hand month.
  const monthForBounds = (endDate: string) =>
    subMonths(startOfMonth(getValidDateOffsetByUTC(endDate)), 1);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    monthForBounds(primaryBounds.endDate),
  );

  // Every edit to the primary window — preset, calendar, lookback — is also an
  // exit from the cleared state. Otherwise the rail would show both selected.
  const setDateRange = (next: ExplorationDateRange) =>
    setDraft((prev) => ({ ...prev, dateRange: next, cleared: false }));

  // `dateRange` is left as-is: it seeds the calendar and the resolved-range text
  // again the moment the user picks a preset, and callers read `cleared` instead.
  const stageCleared = () => setDraft((prev) => ({ ...prev, cleared: true }));

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

  const railItemStyle = (active: boolean): CSSProperties => ({
    padding: "6px 8px",
    borderRadius: "var(--radius-2)",
    cursor: disabled ? "default" : "pointer",
    background: active ? "var(--violet-a4)" : undefined,
    color: active ? "var(--violet-11)" : "var(--gray-11)",
    fontWeight: active ? 500 : 400,
    fontSize: "var(--font-size-2)",
    whiteSpace: "nowrap",
  });

  return (
    // The popover caps its height against the viewport; everything above the
    // footer absorbs that instead of pushing Apply off-screen.
    <Flex
      direction="column"
      style={{ minWidth: 0, minHeight: 0, flex: "1 1 auto" }}
    >
      <Box style={{ overflowY: "auto", minHeight: 0 }}>
        <Flex align="stretch" style={{ minWidth: 0 }}>
          <Box
            style={{
              width: 168,
              flexShrink: 0,
              borderRight: "1px solid var(--gray-a5)",
              padding: "var(--space-2)",
            }}
          >
            <Box role="group" aria-label="Date range presets">
              {clearOption ? (
                <Box
                  role="button"
                  aria-pressed={cleared}
                  aria-disabled={disabled || undefined}
                  tabIndex={disabled ? -1 : 0}
                  onClick={() => !disabled && stageCleared()}
                  onKeyDown={(e) => {
                    if (disabled) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      stageCleared();
                    }
                  }}
                  style={railItemStyle(cleared)}
                >
                  {clearOption.label}
                  {clearOption.tooltip ? (
                    <Tooltip
                      body={clearOption.tooltip}
                      tipPosition="right"
                      className="ml-1"
                    />
                  ) : null}
                </Box>
              ) : null}
              {dateRangePredefined.map((option) => {
                // Never both: the cleared state means no preset is in effect.
                const active = !cleared && dateRange.predefined === option;
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
                    style={railItemStyle(active)}
                  >
                    {DATE_RANGE_PREDEFINED_LABELS[option]}
                  </Box>
                );
              })}
            </Box>
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
                  size="md"
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
              // Off: side-by-side months render the same date twice, so a range
              // boundary on a duplicate reads as two different days.
              showOutsideDays={false}
              // Nothing shaded while cleared: there is no window in effect, and
              // shading one would contradict the rail.
              selected={
                cleared ? undefined : { from: calendarFrom, to: calendarTo }
              }
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

            <Text size="sm" color="text-low">
              {cleared
                ? "Each chart keeps its own date range"
                : isPartialRange
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
                  <LabeledRow label="Compared to">
                    <Select
                      size="md"
                      style={{ width: "100%" }}
                      disabled={disabled}
                      error={
                        selectedModeOverlaps
                          ? `${COMPARISON_MODE_LABELS[mode]} would overlap this date range. Pick another comparison.`
                          : undefined
                      }
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

                  {unavailableModes.length > 0 && (
                    <LabeledRow label="">
                      <Text size="sm" color="text-low">
                        {`${unavailableModes
                          .map((m) => COMPARISON_MODE_LABELS[m])
                          .join(" and ")} ${
                          unavailableModes.length > 1 ? "are" : "is"
                        } unavailable because the window would overlap this date range`}
                      </Text>
                    </LabeledRow>
                  )}

                  <LabeledRow label="">
                    {mode === "custom" ? (
                      // Two single-date fields: `DatePicker` in range mode puts
                      // both ends in one text input, awkward to edit.
                      <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                        <Flex align="end" gap="2" style={{ minWidth: 0 }}>
                          <DatePicker
                            id={`${customComparisonId}-start`}
                            label="From"
                            containerClassName="mb-0"
                            compact
                            disabled={disabled}
                            precision="date"
                            inputWidth={140}
                            date={
                              resolvedPrevious.startDate
                                ? getValidDateOffsetByUTC(
                                    resolvedPrevious.startDate,
                                  )
                                : undefined
                            }
                            setDate={(d) => setCustomPrevious({ startDate: d })}
                          />
                          <DatePicker
                            id={`${customComparisonId}-end`}
                            label="To"
                            containerClassName="mb-0"
                            compact
                            disabled={disabled}
                            precision="date"
                            inputWidth={140}
                            date={
                              resolvedPrevious.endDate
                                ? getValidDateOffsetByUTC(
                                    resolvedPrevious.endDate,
                                  )
                                : undefined
                            }
                            setDate={(d) => setCustomPrevious({ endDate: d })}
                          />
                        </Flex>
                        {isPartialCustomComparison && (
                          <HelperText status="error">
                            Pick both ends of the comparison range
                          </HelperText>
                        )}
                      </Flex>
                    ) : (
                      <Text size="sm" color="text-low">
                        {describeRange(resolvedPrevious)}
                      </Text>
                    )}
                  </LabeledRow>
                </Flex>
              )}
            </Box>
          </>
        )}

        {showGranularity && (
          <>
            <Separator size="4" />
            <Box p="3">
              <Flex align="center" gap="3" justify="between">
                <Text size="md" weight="medium">
                  Granularity
                </Text>
                <ControlledGranularitySelector
                  // Reads the staged range, not the applied one, so the option
                  // list matches the window the user is about to apply.
                  dateRange={dateRange}
                  granularity={draft.granularity ?? "auto"}
                  onChange={(granularity) =>
                    setDraft((prev) => ({ ...prev, granularity }))
                  }
                  disabled={disabled || granularityInert}
                  width={170}
                />
              </Flex>
              {granularityInert && granularityDisabledReason && (
                <HelperText status="info" mt="2">
                  {granularityDisabledReason}
                </HelperText>
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
      </Box>

      <Separator size="4" />
      <Flex justify="end" gap="2" p="3" style={{ flexShrink: 0 }}>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          disabled={
            disabled ||
            isPartialRange ||
            isInvalidLookback ||
            selectedModeOverlaps ||
            isPartialCustomComparison
          }
          onClick={() => onApply(draft)}
        >
          Apply
        </Button>
      </Flex>
    </Flex>
  );
}
