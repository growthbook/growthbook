import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import { dateRangePredefined, lookbackUnit } from "shared/validators";
import {
  buildFixedSpanComparisonOptions,
  getInclusiveUtcCalendarDayCount,
  isUtcYyyyMmDdWithinInclusiveRange,
  type FixedSpanDateBounds,
} from "shared/enterprise";
import { getValidDateOffsetByUTC } from "shared/dates";
import { Select, SelectItem } from "@/ui/Select";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

const PREDEFINED_LABELS: Record<(typeof dateRangePredefined)[number], string> =
  {
    today: "Today",
    last7Days: "Past 7 Days",
    last30Days: "Past 30 Days",
    last90Days: "Past 90 Days",
    customLookback: "Custom Lookback",
    customDateRange: "Custom Date Range",
  };

function boundsToDates(bounds: FixedSpanDateBounds): { from: Date; to: Date } {
  return {
    from: getValidDateOffsetByUTC(bounds.startDate),
    to: getValidDateOffsetByUTC(bounds.endDate),
  };
}

function calendarDayToYyyyMmDd(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

function DefaultDateRangePickerContent({
  shouldWrap = false,
}: {
  shouldWrap?: boolean;
}) {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const { dateRange } = draftExploreState;

  const [localLookbackValue, setLocalLookbackValue] = useState<string | null>(
    null,
  );
  const latestLookbackRef = useRef<string>("");
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (dateRange.predefined !== "customLookback") {
      setLocalLookbackValue(null);
      latestLookbackRef.current = "";
    }
  }, [dateRange.predefined]);

  const commitLookbackValue = (value: string) => {
    const parsed = value ? parseInt(value, 10) : null;
    const isValid = parsed !== null && parsed >= 1 && !isNaN(parsed);

    if (!isValid) {
      setLocalLookbackValue(null);
      latestLookbackRef.current = "";
      return;
    }

    setDraftExploreState((prev) => ({
      ...prev,
      dateRange: { ...prev.dateRange, lookbackValue: parsed },
    }));
    setLocalLookbackValue(null);
    latestLookbackRef.current = "";
  };

  return (
    <Flex
      align="center"
      gap="2"
      wrap={shouldWrap ? "wrap" : undefined}
      width={shouldWrap ? "100%" : undefined}
      style={shouldWrap ? { minWidth: 0 } : undefined}
    >
      <Select
        size="2"
        value={dateRange.predefined}
        placeholder="Select range"
        setValue={(v) => {
          setDraftExploreState((prev) => ({
            ...prev,
            dateRange: {
              ...prev.dateRange,
              predefined: v as (typeof dateRangePredefined)[number],
            },
          }));
        }}
      >
        {dateRangePredefined.map((option) => (
          <SelectItem key={option} value={option}>
            {PREDEFINED_LABELS[option] || option}
          </SelectItem>
        ))}
      </Select>

      {dateRange.predefined === "customLookback" && (
        <>
          <Field
            style={{
              width: "55px",
              paddingTop: "0px",
              paddingBottom: "0px",
              height: "32px",
            }}
            placeholder="#"
            min="1"
            value={
              localLookbackValue !== null
                ? localLookbackValue
                : dateRange.lookbackValue?.toString() || ""
            }
            onFocus={() => {
              latestLookbackRef.current =
                dateRange.lookbackValue?.toString() || "";
            }}
            onChange={(e) => {
              const v = e.target.value;
              latestLookbackRef.current = v;
              setLocalLookbackValue(v);
            }}
            onBlur={() => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
              }
              const toCommit = latestLookbackRef.current;
              commitLookbackValue(toCommit);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const toCommit =
                  latestLookbackRef.current ||
                  dateRange.lookbackValue?.toString() ||
                  "";
                commitLookbackValue(toCommit);
                skipBlurCommitRef.current = true;
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <Select
            size="2"
            value={dateRange.lookbackUnit || "day"}
            setValue={(v) => {
              setDraftExploreState((prev) => ({
                ...prev,
                dateRange: {
                  ...prev.dateRange,
                  lookbackUnit: v as (typeof lookbackUnit)[number],
                },
              }));
            }}
          >
            {lookbackUnit.map((u) => (
              <SelectItem key={u} value={u}>
                {u}(s)
              </SelectItem>
            ))}
          </Select>
        </>
      )}

      {dateRange.predefined === "customDateRange" && (
        <DatePicker
          containerClassName="mb-0"
          compact
          wrapRangeInputs={shouldWrap}
          date={
            dateRange.startDate
              ? getValidDateOffsetByUTC(dateRange.startDate)
              : undefined
          }
          date2={
            dateRange.endDate
              ? getValidDateOffsetByUTC(dateRange.endDate)
              : undefined
          }
          setDate={(d) => {
            setDraftExploreState((prev) => ({
              ...prev,
              dateRange: {
                ...prev.dateRange,
                startDate: d ? format(d, "yyyy-MM-dd") : null,
              },
            }));
          }}
          setDate2={(d) => {
            setDraftExploreState((prev) => ({
              ...prev,
              dateRange: {
                ...prev.dateRange,
                endDate: d ? format(d, "yyyy-MM-dd") : null,
              },
            }));
          }}
          precision="date"
        />
      )}
    </Flex>
  );
}

type ChoosingState = {
  anchorYyyyMmDd: string;
  before: FixedSpanDateBounds;
  after: FixedSpanDateBounds;
};

function ComparisonPreviousRangePicker({
  shouldWrap = false,
}: {
  shouldWrap?: boolean;
}) {
  const { draftExploreState, setDraftExploreState, compareEnabled } =
    useExplorerContext();

  const previousTimeFrame = draftExploreState.previousTimeFrame;

  const dr = draftExploreState.dateRange;
  const primaryStart = dr.startDate;
  const primaryEnd = dr.endDate;

  const primaryBoundsKey =
    primaryStart && primaryEnd ? `${primaryStart}|${primaryEnd}` : null;

  const [choosing, setChoosing] = useState<ChoosingState | null>(null);

  useEffect(() => {
    setChoosing(null);
  }, [primaryBoundsKey]);

  const spanDays = useMemo(() => {
    if (!primaryStart || !primaryEnd) return 0;
    return getInclusiveUtcCalendarDayCount(primaryStart, primaryEnd);
  }, [primaryStart, primaryEnd]);

  const commitBounds = useCallback(
    (bounds: FixedSpanDateBounds) => {
      if (!previousTimeFrame) return;
      setDraftExploreState((prev) => ({
        ...prev,
        previousTimeFrame: {
          ...previousTimeFrame,
          predefined: "customDateRange" as const,
          startDate: bounds.startDate,
          endDate: bounds.endDate,
        },
      }));
      setChoosing(null);
    },
    [previousTimeFrame, setDraftExploreState],
  );

  const handleDayPick = useCallback(
    (day: Date) => {
      if (!primaryStart || !primaryEnd || spanDays < 1 || !previousTimeFrame) {
        return;
      }

      const dayStr = calendarDayToYyyyMmDd(day);
      const currentStart = previousTimeFrame.startDate;
      const currentEnd = previousTimeFrame.endDate;

      if (!choosing) {
        if (
          currentStart &&
          currentEnd &&
          isUtcYyyyMmDdWithinInclusiveRange(dayStr, currentStart, currentEnd)
        ) {
          return;
        }
        const options = buildFixedSpanComparisonOptions(dayStr, spanDays);
        setChoosing({
          anchorYyyyMmDd: dayStr,
          before: options.before,
          after: options.after,
        });
        return;
      }

      const { before, after } = choosing;
      const inBefore = isUtcYyyyMmDdWithinInclusiveRange(
        dayStr,
        before.startDate,
        before.endDate,
      );
      const inAfter = isUtcYyyyMmDdWithinInclusiveRange(
        dayStr,
        after.startDate,
        after.endDate,
      );

      if (inAfter) {
        commitBounds(after);
      } else if (inBefore) {
        commitBounds(before);
      } else {
        const options = buildFixedSpanComparisonOptions(dayStr, spanDays);
        setChoosing({
          anchorYyyyMmDd: dayStr,
          before: options.before,
          after: options.after,
        });
      }
    },
    [
      choosing,
      commitBounds,
      previousTimeFrame,
      primaryEnd,
      primaryStart,
      spanDays,
    ],
  );

  const fixedSpanMode = useMemo(() => {
    if (!previousTimeFrame?.startDate || !previousTimeFrame.endDate) {
      return undefined;
    }

    if (choosing) {
      return {
        phase: "choosing" as const,
        anchorDate: getValidDateOffsetByUTC(choosing.anchorYyyyMmDd),
        candidateRanges: [
          boundsToDates(choosing.before),
          boundsToDates(choosing.after),
        ],
        onDayPick: handleDayPick,
      };
    }

    return {
      phase: "committed" as const,
      onDayPick: handleDayPick,
    };
  }, [choosing, handleDayPick, previousTimeFrame]);

  if (
    !compareEnabled ||
    dr.predefined !== "customDateRange" ||
    !primaryStart ||
    !primaryEnd ||
    !previousTimeFrame ||
    !previousTimeFrame.startDate ||
    !previousTimeFrame.endDate ||
    spanDays < 1
  ) {
    return null;
  }

  return (
    <Flex
      align="center"
      gap="2"
      wrap={shouldWrap ? "wrap" : undefined}
      width={shouldWrap ? "100%" : undefined}
      style={{ minWidth: 0 }}
    >
      <DatePicker
        containerClassName="mb-0"
        compact
        wrapRangeInputs={shouldWrap}
        date={getValidDateOffsetByUTC(previousTimeFrame.startDate)}
        date2={getValidDateOffsetByUTC(previousTimeFrame.endDate)}
        setDate={() => {}}
        setDate2={() => {}}
        fixedSpanMode={fixedSpanMode}
        precision="date"
      />
    </Flex>
  );
}

export interface DateRangePickerProps {
  shouldWrap?: boolean;
  /** Comparison window (no preset dropdown); dates are free-form. */
  variant?: "default" | "comparison";
}

export default function DateRangePicker({
  shouldWrap = false,
  variant = "default",
}: DateRangePickerProps = {}) {
  if (variant === "comparison") {
    return <ComparisonPreviousRangePicker shouldWrap={shouldWrap} />;
  }
  return <DefaultDateRangePickerContent shouldWrap={shouldWrap} />;
}
