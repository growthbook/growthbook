import React, { ReactNode, useState, useRef, useEffect } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import { dateRangePredefined, lookbackUnit } from "shared/validators";
import { getValidDateOffsetByUTC } from "shared/dates";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
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

function MicroLabel({ children }: { children: ReactNode }) {
  return (
    <Text size="small" color="text-low" weight="medium">
      {children}
    </Text>
  );
}

/** Preset dropdown ("Custom Date Range" etc.) plus the custom-lookback inputs. */
function DateRangePresetSelect() {
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
    <>
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
    </>
  );
}

/** The "Current" custom date range field (label + range picker). */
function CurrentCustomRangeField({
  shouldWrap = false,
  label,
}: {
  shouldWrap?: boolean;
  /** Micro-label shown before the custom date range field (e.g. "Current"). */
  label?: ReactNode;
}) {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const { dateRange } = draftExploreState;

  if (dateRange.predefined !== "customDateRange") return null;

  return (
    <>
      {label && <MicroLabel>{label}</MicroLabel>}
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
    </>
  );
}

function DefaultDateRangePickerContent({
  shouldWrap = false,
  label,
}: {
  shouldWrap?: boolean;
  /** Micro-label shown before the custom date range field (e.g. "Current"). */
  label?: ReactNode;
}) {
  return (
    <Flex
      align="center"
      gap="2"
      wrap={shouldWrap ? "wrap" : undefined}
      width={shouldWrap ? "100%" : undefined}
      style={shouldWrap ? { minWidth: 0 } : undefined}
    >
      <DateRangePresetSelect />
      <CurrentCustomRangeField shouldWrap={shouldWrap} label={label} />
    </Flex>
  );
}

function ComparisonPreviousRangePicker({
  shouldWrap = false,
  label,
}: {
  shouldWrap?: boolean;
  /** Micro-label shown before the prior date range field (e.g. "Prior"). */
  label?: ReactNode;
}) {
  const { draftExploreState, setDraftExploreState, compareEnabled } =
    useExplorerContext();

  const previousTimeFrame = draftExploreState.previousTimeFrame;
  const dr = draftExploreState.dateRange;

  if (
    !compareEnabled ||
    dr.predefined !== "customDateRange" ||
    !dr.startDate ||
    !dr.endDate ||
    !previousTimeFrame ||
    !previousTimeFrame.startDate ||
    !previousTimeFrame.endDate
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
      {label && <MicroLabel>{label}</MicroLabel>}
      <DatePicker
        containerClassName="mb-0"
        compact
        wrapRangeInputs={shouldWrap}
        date={getValidDateOffsetByUTC(previousTimeFrame.startDate)}
        date2={getValidDateOffsetByUTC(previousTimeFrame.endDate)}
        setDate={(d) => {
          setDraftExploreState((prev) => ({
            ...prev,
            previousTimeFrame: prev.previousTimeFrame
              ? {
                  ...prev.previousTimeFrame,
                  predefined: "customDateRange" as const,
                  startDate: d ? format(d, "yyyy-MM-dd") : null,
                }
              : prev.previousTimeFrame,
          }));
        }}
        setDate2={(d) => {
          setDraftExploreState((prev) => ({
            ...prev,
            previousTimeFrame: prev.previousTimeFrame
              ? {
                  ...prev.previousTimeFrame,
                  predefined: "customDateRange" as const,
                  endDate: d ? format(d, "yyyy-MM-dd") : null,
                }
              : prev.previousTimeFrame,
          }));
        }}
        precision="date"
      />
    </Flex>
  );
}

export interface DateRangePickerProps {
  shouldWrap?: boolean;
  /** Micro-label shown before the date range field (e.g. "Current" / "Prior"). */
  label?: ReactNode;
}

export default function DateRangePicker({
  shouldWrap = false,
  label,
}: DateRangePickerProps = {}) {
  return (
    <DefaultDateRangePickerContent shouldWrap={shouldWrap} label={label} />
  );
}

/**
 * "Current" / "Prior" label that hugs its date field, and drops out entirely on
 * small screens (the "vs" still anchors the two rows) to reclaim horizontal
 * space.
 */
function CompareFieldLabel({ children }: { children: ReactNode }) {
  return (
    <Box display={{ initial: "none", sm: "inline-block" }}>
      <Text size="small" color="text-low" weight="medium">
        {children}
      </Text>
    </Box>
  );
}

/**
 * Compare-on controls for the custom date range. Returns a flat fragment of
 * items (dropdown, Current, vs, Prior, group-by) so they sit directly in the
 * toolbar's right-aligned wrapping row alongside the Compare switch — each label
 * stays paired with its date field so the two never split across a line break.
 */
export function ComparisonDateControls({
  groupBySlot,
}: {
  /** Optional group-by control rendered alongside the prior picker. */
  groupBySlot?: ReactNode;
}) {
  return (
    <>
      <DateRangePresetSelect />
      <Flex align="center" gap="2">
        <CompareFieldLabel>Current</CompareFieldLabel>
        <CurrentCustomRangeField />
      </Flex>
      <Text size="small" color="text-low" weight="medium">
        vs
      </Text>
      <Flex align="center" gap="2">
        <CompareFieldLabel>Prior</CompareFieldLabel>
        <ComparisonPreviousRangePicker />
      </Flex>
      {groupBySlot}
    </>
  );
}
