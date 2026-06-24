import React, { useState, useRef, useEffect } from "react";
import { Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import {
  dateRangePredefined,
  ExplorationConfig,
  lookbackUnit,
} from "shared/validators";
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

interface DateRangePickerProps {
  value: ExplorationConfig["dateRange"];
  onChange: (dateRange: ExplorationConfig["dateRange"]) => void;
  shouldWrap?: boolean;
  disabled?: boolean;
}

export function DateRangePicker({
  value: dateRange,
  onChange,
  shouldWrap = false,
  disabled = false,
}: DateRangePickerProps) {
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
      // Revert to last valid value - don't update state, just clear local state
      setLocalLookbackValue(null);
      latestLookbackRef.current = "";
      return;
    }

    onChange({ ...dateRange, lookbackValue: parsed });
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
        disabled={disabled}
        setValue={(v) => {
          onChange({
            ...dateRange,
            predefined: v as (typeof dateRangePredefined)[number],
          });
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
            disabled={disabled}
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
            disabled={disabled}
            setValue={(v) => {
              onChange({
                ...dateRange,
                lookbackUnit: v as (typeof lookbackUnit)[number],
              });
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
            onChange({
              ...dateRange,
              startDate: d ? format(d, "yyyy-MM-dd") : null,
            });
          }}
          setDate2={(d) => {
            onChange({
              ...dateRange,
              endDate: d ? format(d, "yyyy-MM-dd") : null,
            });
          }}
          precision="date"
          disabled={disabled}
        />
      )}
    </Flex>
  );
}

export function ExplorerDateRangePicker({
  shouldWrap = false,
}: Pick<DateRangePickerProps, "shouldWrap"> = {}) {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();

  return (
    <DateRangePicker
      value={draftExploreState.dateRange}
      onChange={(dateRange) => {
        setDraftExploreState((prev) => ({
          ...prev,
          dateRange,
        }));
      }}
      shouldWrap={shouldWrap}
    />
  );
}
