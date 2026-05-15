import React, { useState, useRef, useEffect, useCallback } from "react";
import { Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import { dateRangePredefined, lookbackUnit } from "shared/validators";
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

type PendingPair = {
  setStart: boolean;
  setEnd: boolean;
  start: Date | undefined;
  end: Date | undefined;
};

function ComparisonPreviousRangePicker({
  shouldWrap = false,
}: {
  shouldWrap?: boolean;
}) {
  const { draftExploreState, setDraftExploreState, compareEnabled } =
    useExplorerContext();

  const previousTimeFrame = draftExploreState.previousTimeFrame;

  const previousTimeFrameRef = useRef(previousTimeFrame);
  previousTimeFrameRef.current = previousTimeFrame;

  const dr = draftExploreState.dateRange;
  const primaryStart = dr.startDate;
  const primaryEnd = dr.endDate;

  const pendingRef = useRef<PendingPair>({
    setStart: false,
    setEnd: false,
    start: undefined,
    end: undefined,
  });
  const flushScheduledRef = useRef(false);

  const flushPending = useCallback(() => {
    flushScheduledRef.current = false;
    const p = pendingRef.current;
    pendingRef.current = {
      setStart: false,
      setEnd: false,
      start: undefined,
      end: undefined,
    };

    const base = previousTimeFrameRef.current;
    if (!base) return;

    const next = {
      ...base,
      predefined: "customDateRange" as const,
    };
    if (p.setStart) {
      next.startDate = p.start ? format(p.start, "yyyy-MM-dd") : null;
    }
    if (p.setEnd) {
      next.endDate = p.end ? format(p.end, "yyyy-MM-dd") : null;
    }
    setDraftExploreState((prev) => ({
      ...prev,
      previousTimeFrame: next,
    }));
  }, [setDraftExploreState]);

  const queueSetStart = useCallback(
    (d: Date | undefined) => {
      pendingRef.current.setStart = true;
      pendingRef.current.start = d;
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        queueMicrotask(flushPending);
      }
    },
    [flushPending],
  );

  const queueSetEnd = useCallback(
    (d: Date | undefined) => {
      pendingRef.current.setEnd = true;
      pendingRef.current.end = d;
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        queueMicrotask(flushPending);
      }
    },
    [flushPending],
  );

  if (
    !compareEnabled ||
    dr.predefined !== "customDateRange" ||
    !primaryStart ||
    !primaryEnd ||
    !previousTimeFrame
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
        date={
          previousTimeFrame.startDate
            ? getValidDateOffsetByUTC(previousTimeFrame.startDate)
            : undefined
        }
        date2={
          previousTimeFrame.endDate
            ? getValidDateOffsetByUTC(previousTimeFrame.endDate)
            : undefined
        }
        setDate={queueSetStart}
        setDate2={queueSetEnd}
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
