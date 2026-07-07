import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import { PiCalendarBlank, PiCaretDown, PiCheck } from "react-icons/pi";
import { getValidDateOffsetByUTC } from "shared/dates";
import { dateGranularity, lookbackUnit } from "shared/validators";
import type { ExplorationDateRange } from "shared/validators";
import DatePicker from "@/components/DatePicker";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import { Popover } from "@/ui/Popover";
import { Select, SelectItem } from "@/ui/Select";
import { ControlledGranularitySelector } from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/GranularitySelector";
import { useMergedDateRangeUpdates } from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/useMergedDateRangeUpdates";

const DEFAULT_DATE_RANGE: ExplorationDateRange = {
  predefined: "last30Days",
  lookbackValue: null,
  lookbackUnit: null,
  startDate: null,
  endDate: null,
};

type DateRangeOption =
  | "chartDefault"
  | "today"
  | "last7Days"
  | "last30Days"
  | "last90Days"
  | "customLookback"
  | "customDateRange";

const PRESET_OPTIONS: {
  value: DateRangeOption;
  label: string;
}[] = [
  { value: "chartDefault", label: "Chart Default" },
  { value: "today", label: "Today" },
  { value: "last7Days", label: "Past 7 Days" },
  { value: "last30Days", label: "Past 30 Days" },
  { value: "last90Days", label: "Past 90 Days" },
];

const LOOKBACK_UNIT_LABELS: Record<(typeof lookbackUnit)[number], string> = {
  hour: "hour(s)",
  day: "day(s)",
  week: "week(s)",
  month: "month(s)",
};

function getDisplayLabel(value: ExplorationDateRange | null): string {
  if (!value) return "Chart Default";

  switch (value.predefined) {
    case "today":
      return "Today";
    case "last7Days":
      return "Past 7 Days";
    case "last30Days":
      return "Past 30 Days";
    case "last90Days":
      return "Past 90 Days";
    case "customLookback":
      return `Past ${value.lookbackValue ?? 30} ${value.lookbackUnit ?? "day"}${
        (value.lookbackValue ?? 30) === 1 ? "" : "s"
      }`;
    case "customDateRange":
      return value.startDate && value.endDate
        ? `${value.startDate} to ${value.endDate}`
        : "Date Range";
  }
}

function isOptionSelected(
  value: ExplorationDateRange | null,
  option: DateRangeOption,
): boolean {
  if (option === "chartDefault") return value === null;
  return value?.predefined === option;
}

function buildDateRange(
  currentValue: ExplorationDateRange | null,
  predefined: Exclude<DateRangeOption, "chartDefault">,
): ExplorationDateRange {
  const base = currentValue ?? DEFAULT_DATE_RANGE;
  return {
    ...base,
    predefined,
    ...(predefined === "customLookback"
      ? {
          lookbackValue: base.lookbackValue || 30,
          lookbackUnit: base.lookbackUnit || "day",
        }
      : {}),
    ...(predefined === "customDateRange"
      ? {
          startDate:
            base.predefined === "customDateRange" ? base.startDate : null,
          endDate: base.predefined === "customDateRange" ? base.endDate : null,
        }
      : {}),
  };
}

function OptionRow({
  label,
  tooltip,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  tooltip?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        alignItems: "center",
        background: "transparent",
        border: 0,
        color: disabled ? "var(--gray-9)" : "var(--indigo-12)",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "grid",
        fontSize: 14,
        gridTemplateColumns: "16px 1fr",
        columnGap: "8px",
        padding: "6px 0",
        textAlign: "left",
      }}
    >
      <span>{selected ? <PiCheck size={16} /> : null}</span>
      <span style={{ whiteSpace: "nowrap" }}>
        {label}
        {tooltip ? (
          <Tooltip body={tooltip} tipPosition="right" className="ml-1" />
        ) : null}
      </span>
    </button>
  );
}

export default function DashboardDateControlsDropdown({
  value,
  granularity = "auto",
  onChange,
  onGranularityChange,
  disabled,
}: {
  value: ExplorationDateRange | null;
  granularity?: (typeof dateGranularity)[number];
  onChange: (dateRange: ExplorationDateRange | null) => void;
  onGranularityChange: (granularity: (typeof dateGranularity)[number]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [localLookbackValue, setLocalLookbackValue] = useState("");
  const activeDateRange = value ?? DEFAULT_DATE_RANGE;
  const updateCustomDateRange = useMergedDateRangeUpdates(value, (dateRange) =>
    onChange(dateRange),
  );

  useEffect(() => {
    setLocalLookbackValue(value?.lookbackValue?.toString() ?? "");
  }, [value?.lookbackValue]);

  const selectPreset = (option: DateRangeOption) => {
    if (option === "chartDefault") {
      onChange(null);
      setOpen(false);
      return;
    }

    onChange(buildDateRange(value, option));
    setOpen(false);
  };

  const selectCustomLookback = () => {
    const nextValue = buildDateRange(value, "customLookback");
    setLocalLookbackValue(nextValue.lookbackValue?.toString() ?? "");
    onChange(nextValue);
  };

  const commitLookbackValue = () => {
    const parsed = localLookbackValue ? parseInt(localLookbackValue, 10) : null;
    const isValid = parsed !== null && parsed >= 1 && !Number.isNaN(parsed);
    if (!isValid) {
      setLocalLookbackValue(activeDateRange.lookbackValue?.toString() ?? "");
      return;
    }

    onChange({
      ...buildDateRange(value, "customLookback"),
      lookbackValue: parsed,
      lookbackUnit: activeDateRange.lookbackUnit || "day",
    });
  };

  const content = (
    <Flex direction="column" gap="1" width="100%">
      {PRESET_OPTIONS.map((option) => (
        <OptionRow
          key={option.value}
          label={option.label}
          tooltip={
            option.value === "chartDefault"
              ? "Use each chart's own configured date range instead of applying a dashboard-wide date range."
              : undefined
          }
          selected={isOptionSelected(value, option.value)}
          disabled={disabled}
          onClick={() => selectPreset(option.value)}
        />
      ))}

      <Flex direction="row" align="center" gap="3">
        <OptionRow
          label="Last"
          selected={value?.predefined === "customLookback"}
          disabled={disabled}
          onClick={selectCustomLookback}
        />
        <Field
          type="number"
          min="1"
          disabled={disabled || value?.predefined !== "customLookback"}
          containerClassName="mb-0"
          style={{ height: 32, width: 80, padding: "0 8px" }}
          value={localLookbackValue}
          onChange={(e) => setLocalLookbackValue(e.target.value)}
          onBlur={commitLookbackValue}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitLookbackValue();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <Select
          size="2"
          disabled={disabled || value?.predefined !== "customLookback"}
          style={{ width: 112 }}
          value={activeDateRange.lookbackUnit || "day"}
          setValue={(unit) =>
            onChange({
              ...buildDateRange(value, "customLookback"),
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

      <OptionRow
        label="Date Range"
        selected={value?.predefined === "customDateRange"}
        disabled={disabled}
        onClick={() => onChange(buildDateRange(value, "customDateRange"))}
      />
      {value?.predefined === "customDateRange" ? (
        <Box pl="5" style={{ width: "100%", minWidth: 0 }}>
          <DatePicker
            containerClassName="mb-0"
            compact
            disabled={disabled}
            inputWidth={260}
            date={
              value.startDate
                ? getValidDateOffsetByUTC(value.startDate)
                : undefined
            }
            date2={
              value.endDate ? getValidDateOffsetByUTC(value.endDate) : undefined
            }
            setDate={(date) =>
              updateCustomDateRange({
                startDate: date ? format(date, "yyyy-MM-dd") : null,
              })
            }
            setDate2={(date) =>
              updateCustomDateRange({
                endDate: date ? format(date, "yyyy-MM-dd") : null,
              })
            }
            precision="date"
          />
        </Box>
      ) : null}

      <Box
        my="2"
        style={{
          borderTop: "1px solid var(--gray-a5)",
          width: "100%",
        }}
      />

      <Flex align="center" gap="3" justify="between" pl="5">
        <Box style={{ fontSize: 14, color: "var(--indigo-12)" }}>
          Granularity
        </Box>
        <ControlledGranularitySelector
          dateRange={activeDateRange}
          granularity={granularity}
          onChange={onGranularityChange}
          disabled={disabled || !value}
          width={170}
        />
      </Flex>
    </Flex>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          disabled={disabled}
          style={{
            alignItems: "center",
            background: "var(--color-panel)",
            border: "1px solid var(--gray-a7)",
            borderRadius: "var(--radius-2)",
            color: disabled ? "var(--gray-9)" : "var(--gray-12)",
            cursor: disabled ? "not-allowed" : "pointer",
            display: "flex",
            fontSize: 14,
            fontWeight: 500,
            height: 32,
            justifyContent: "space-between",
            minWidth: 180,
            padding: "0 10px",
          }}
        >
          <Flex align="center" gap="2" width="100%" justify="between">
            <Flex align="center" gap="2">
              <PiCalendarBlank aria-hidden />
              <span>{getDisplayLabel(value)}</span>
            </Flex>
            <PiCaretDown aria-hidden />
          </Flex>
        </button>
      }
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
      contentStyle={{ padding: "20px 24px", width: 342 }}
      content={content}
    />
  );
}
