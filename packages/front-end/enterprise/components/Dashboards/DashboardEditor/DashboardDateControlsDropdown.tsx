import { useEffect, useRef, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { format } from "date-fns";
import { PiCalendarBlank, PiCaretDown } from "react-icons/pi";
import { getValidDateOffsetByUTC } from "shared/dates";
import {
  comparisonMode as comparisonModes,
  dateGranularity,
  lookbackUnit,
} from "shared/validators";
import type { ComparisonMode, ExplorationDateRange } from "shared/validators";
import {
  getInclusiveUtcCalendarDayCount,
  getPrimaryUtcDayBounds,
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import type { BlockComparison } from "shared/enterprise";
import DatePicker from "@/components/DatePicker";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import { Popover } from "@/ui/Popover";
import { Select, SelectItem } from "@/ui/Select";
import RadioGroup from "@/ui/RadioGroup";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { ControlledGranularitySelector } from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/GranularitySelector";
import { useMergedDateRangeUpdates } from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/useMergedDateRangeUpdates";
import { formatCollapsedDateRange } from "@/enterprise/components/ProductAnalytics/comparison-chart";
import {
  COMPARISON_MODE_LABELS,
  DATE_RANGE_PREDEFINED_LABELS,
  LOOKBACK_UNIT_LABELS,
  formatExplorationDateRange,
} from "@/enterprise/components/ProductAnalytics/dateRangeLabels";

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

type PresetDateRangeOption = Exclude<
  DateRangeOption,
  "customLookback" | "customDateRange"
>;

const PRESET_OPTIONS: {
  value: PresetDateRangeOption;
}[] = [
  { value: "chartDefault" },
  { value: "today" },
  { value: "last7Days" },
  { value: "last30Days" },
  { value: "last90Days" },
];

function getDisplayLabel(value: ExplorationDateRange | null): string {
  if (!value) return "Chart Default";
  return formatExplorationDateRange(value, {
    customDateRangeFallback: "Date Range",
  });
}

function getPresetOptionLabel(option: PresetDateRangeOption) {
  if (option === "chartDefault") {
    return (
      <span style={{ whiteSpace: "nowrap" }}>
        Chart Default
        <Tooltip
          body="Use each chart's own configured date range instead of applying a dashboard-wide date filter."
          tipPosition="right"
          className="ml-1"
        />
      </span>
    );
  }

  return DATE_RANGE_PREDEFINED_LABELS[option];
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
  const [localLookbackValue, setLocalLookbackValue] = useState("");
  const committedLookbackValueRef = useRef<number | null>(null);
  const activeDateRange = value ?? DEFAULT_DATE_RANGE;
  const updateCustomDateRange = useMergedDateRangeUpdates(value, (dateRange) =>
    onChange(dateRange),
  );

  useEffect(() => {
    setLocalLookbackValue(value?.lookbackValue?.toString() ?? "");
    committedLookbackValueRef.current = value?.lookbackValue ?? null;
  }, [value?.lookbackValue]);

  const selectDateRangeOption = (option: DateRangeOption) => {
    if (option === "chartDefault") {
      onChange(null);
      setOpen(false);
      return;
    }

    const nextValue = buildDateRange(value, option);
    if (option === "customLookback") {
      setLocalLookbackValue(nextValue.lookbackValue?.toString() ?? "");
    }

    onChange(nextValue);
    if (option !== "customLookback" && option !== "customDateRange") {
      setOpen(false);
    }
  };

  const commitLookbackValue = () => {
    const parsed = localLookbackValue ? parseInt(localLookbackValue, 10) : null;
    const isValid = parsed !== null && parsed >= 1 && !Number.isNaN(parsed);
    if (!isValid) {
      setLocalLookbackValue(activeDateRange.lookbackValue?.toString() ?? "");
      return;
    }
    if (parsed === committedLookbackValueRef.current) return;

    committedLookbackValueRef.current = parsed;
    onChange({
      ...buildDateRange(value, "customLookback"),
      lookbackValue: parsed,
      lookbackUnit: activeDateRange.lookbackUnit || "day",
    });
  };

  const selectedDateRangeOption: DateRangeOption =
    value?.predefined ?? "chartDefault";
  const customLookbackControls = (
    <Box pl="5" mt="-3">
      <Flex direction="row" align="center" gap="2">
        <Field
          type="number"
          min="1"
          disabled={disabled}
          containerClassName="mb-0"
          style={{ height: 32, width: 80 }}
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
          size="small"
          disabled={disabled}
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
    </Box>
  );
  const customDateRangeControls =
    value?.predefined === "customDateRange" ? (
      <Box pl="5" mt="-3" style={{ width: "100%", minWidth: 0 }}>
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
    ) : null;
  const compareEnabled = !!comparison?.enabled;
  const comparisonMode = comparison
    ? resolveComparisonMode(comparison)
    : "previousPeriod";
  const resolvedPrevious = resolveComparisonPreviousTimeFrame(
    activeDateRange,
    comparison ?? {},
  );
  const primaryBounds = getPrimaryUtcDayBounds(activeDateRange);
  const yearModeOverlaps =
    getInclusiveUtcCalendarDayCount(
      primaryBounds.startDate,
      primaryBounds.endDate,
    ) > 366;

  const previousWindowSummary = (
    <Box pl="5" mt="-3">
      <Text size="small" color="text-low">
        {formatCollapsedDateRange(
          getValidDateOffsetByUTC(resolvedPrevious.startDate as string),
          getValidDateOffsetByUTC(resolvedPrevious.endDate as string),
        )}
      </Text>
    </Box>
  );

  const customPreviousControls = (
    <Box pl="5" mt="-3" style={{ width: "100%", minWidth: 0 }}>
      <DatePicker
        containerClassName="mb-0"
        compact
        disabled={disabled}
        inputWidth={260}
        date={getValidDateOffsetByUTC(resolvedPrevious.startDate as string)}
        date2={getValidDateOffsetByUTC(resolvedPrevious.endDate as string)}
        setDate={(date) =>
          onComparisonChange?.({
            enabled: true,
            mode: "custom",
            previousTimeFrame: {
              ...resolvedPrevious,
              startDate: date ? format(date, "yyyy-MM-dd") : null,
            },
          })
        }
        setDate2={(date) =>
          onComparisonChange?.({
            enabled: true,
            mode: "custom",
            previousTimeFrame: {
              ...resolvedPrevious,
              endDate: date ? format(date, "yyyy-MM-dd") : null,
            },
          })
        }
        precision="date"
      />
    </Box>
  );

  const content = (
    <Flex direction="column" gap="1" width="100%">
      <RadioGroup
        disabled={disabled}
        value={selectedDateRangeOption}
        setValue={(option) => selectDateRangeOption(option as DateRangeOption)}
        gap="2"
        labelSize="2"
        width="100%"
        options={[
          ...PRESET_OPTIONS.map((option) => ({
            value: option.value,
            label: getPresetOptionLabel(option.value),
          })),
          {
            value: "customLookback",
            label: "Custom Lookback",
            renderOnSelect: customLookbackControls,
            renderOutsideItem: true,
          },
          {
            value: "customDateRange",
            label: "Date Range",
            renderOnSelect: customDateRangeControls ?? undefined,
            renderOutsideItem: true,
          },
        ]}
      />

      {onComparisonChange && (
        <>
          <Separator size="4" my="2" />

          <Flex direction="column" gap="1" width="100%">
            <Box pl="5">
              <Switch
                label="Compare to a previous period"
                value={compareEnabled}
                disabled={disabled || !value}
                onChange={(checked) =>
                  onComparisonChange(
                    checked
                      ? { enabled: true, mode: "previousPeriod" }
                      : undefined,
                  )
                }
              />
            </Box>
            {compareEnabled && (
              <Box pl="5" mt="1">
                <RadioGroup
                  disabled={disabled}
                  value={comparisonMode}
                  setValue={(mode) =>
                    onComparisonChange({
                      enabled: true,
                      mode: mode as ComparisonMode,
                      ...(mode === "custom"
                        ? { previousTimeFrame: resolvedPrevious }
                        : {}),
                    })
                  }
                  gap="2"
                  labelSize="2"
                  width="100%"
                  options={comparisonModes.map((mode) => ({
                    value: mode,
                    label: COMPARISON_MODE_LABELS[mode],
                    disabled: yearModeOverlaps && mode === "previousYear",
                    disabledReason:
                      "The comparison window would overlap the selected range",
                    renderOnSelect:
                      mode === "custom"
                        ? customPreviousControls
                        : previousWindowSummary,
                    renderOutsideItem: true,
                  }))}
                />
              </Box>
            )}
          </Flex>
        </>
      )}

      <Separator size="4" my="2" />

      <Flex align="center" gap="3" justify="between" pl="5">
        <Text size="medium" weight="medium">
          Granularity
        </Text>
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
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          icon={<PiCalendarBlank aria-hidden />}
          iconPosition="left"
          style={{
            justifyContent: "space-between",
          }}
        >
          <Flex align="center" gap="2" justify="between" width="100%">
            <span>{getDisplayLabel(value)}</span>
            <PiCaretDown aria-hidden />
          </Flex>
        </Button>
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
          return;
        }
        if (selectedDateRangeOption === "customLookback") {
          commitLookbackValue();
        }
      }}
      contentStyle={{ padding: "20px 24px", width: 342 }}
      content={content}
    />
  );
}
