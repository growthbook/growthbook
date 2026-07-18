import { ReactNode, useEffect } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { format } from "date-fns";
import {
  dateRangePredefined,
  lookbackUnit,
  ExplorationDateRange,
} from "shared/validators";
import { calculateProductAnalyticsDateRange } from "shared/enterprise";
import { getValidDateOffsetByUTC } from "shared/dates";
import { Select, SelectItem } from "@/ui/Select";
import Field from "@/components/Forms/Field";
import Text from "@/ui/Text";
import DatePicker from "@/components/DatePicker";
import { getPreviousWindow } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/completedExperimentsData";

export const PREDEFINED_LABELS: Record<
  (typeof dateRangePredefined)[number],
  string
> = {
  today: "Today",
  last7Days: "Past 7 Days",
  last30Days: "Past 30 Days",
  last90Days: "Past 90 Days",
  customLookback: "Custom Lookback",
  customDateRange: "Custom Date Range",
};

// Format a UTC instant as its UTC calendar day ("yyyy-MM-dd"). These strings
// are parsed back as UTC days everywhere downstream (getValidDateOffsetByUTC,
// calculateProductAnalyticsDateRange), so local-time formatting would shift the
// seeded range by a day for users west of UTC.
function formatUTCDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The equal-length window immediately before the current custom range, used as
// the default "Prior" value until the user overrides it. Mirrors the span-shift
// the data layer applies when no explicit previous window is stored. Because
// getPreviousWindow ends 1ms before the current start (which is 00:00:00 UTC
// for a custom range), the seeded prior end lands on the calendar day before
// the current start day — the two ranges never overlap once the prior end is
// expanded back to end-of-day.
function defaultPriorRange(
  current: ExplorationDateRange,
): ExplorationDateRange {
  const { startDate, endDate } = calculateProductAnalyticsDateRange(current);
  const prev = getPreviousWindow({ startDate, endDate });
  return {
    predefined: "customDateRange",
    startDate: formatUTCDay(prev.startDate),
    endDate: formatUTCDay(prev.endDate),
  };
}

// Combined "yyyy-MM-dd - yyyy-MM-dd" range field bound to an ExplorationDateRange.
function CustomRangeField({
  value,
  onChange,
  disabled,
}: {
  value: ExplorationDateRange;
  onChange: (dr: ExplorationDateRange) => void;
  disabled?: boolean;
}) {
  return (
    <DatePicker
      containerClassName="mb-0"
      compact
      disabled={disabled}
      date={
        value.startDate ? getValidDateOffsetByUTC(value.startDate) : undefined
      }
      date2={value.endDate ? getValidDateOffsetByUTC(value.endDate) : undefined}
      setDate={(d) =>
        onChange({
          ...value,
          predefined: "customDateRange",
          startDate: d ? format(d, "yyyy-MM-dd") : undefined,
        })
      }
      setDate2={(d) =>
        onChange({
          ...value,
          predefined: "customDateRange",
          endDate: d ? format(d, "yyyy-MM-dd") : undefined,
        })
      }
      precision="date"
    />
  );
}

// Fixed-label + field row used by the Prior / Current comparison layout.
function LabeledRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Grid columns="72px minmax(0, 1fr)" align="center" gapX="2">
      <Text size="small" color="text-low">
        {label}
      </Text>
      {children}
    </Grid>
  );
}

/**
 * Context-free date range picker matching the Metric Explorer's
 * (ProductAnalytics DateRangePicker), bound to a value/onChange instead of the
 * ExplorerContext. Used by the "Completed Experiments" dashboard blocks.
 *
 * When comparison is on and the range is a Custom Date Range, it also shows the
 * "Prior / vs / Current" fields, driven by the block's comparison
 * previousTimeFrame.
 */
export default function BlockDateRangePicker({
  value,
  onChange,
  comparisonEnabled = false,
  previousTimeFrame,
  onPreviousTimeFrameChange,
  disabled = false,
}: {
  value: ExplorationDateRange;
  onChange: (dateRange: ExplorationDateRange) => void;
  comparisonEnabled?: boolean;
  previousTimeFrame?: ExplorationDateRange;
  onPreviousTimeFrameChange?: (dr: ExplorationDateRange) => void;
  // Lock all inputs (used when the block follows the dashboard date filter).
  disabled?: boolean;
}) {
  const setPredefined = (predefined: (typeof dateRangePredefined)[number]) => {
    if (predefined === "customDateRange") {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 90);
      onChange({
        predefined,
        startDate: value.startDate ?? format(start, "yyyy-MM-dd"),
        endDate: value.endDate ?? format(end, "yyyy-MM-dd"),
      });
    } else if (predefined === "customLookback") {
      onChange({
        predefined,
        lookbackValue: value.lookbackValue ?? 30,
        lookbackUnit: value.lookbackUnit ?? "day",
      });
    } else {
      onChange({ predefined });
    }
  };

  const presetSelect = (
    <Select
      size="2"
      value={value.predefined}
      placeholder="Select range"
      disabled={disabled}
      setValue={(v) => setPredefined(v as (typeof dateRangePredefined)[number])}
    >
      {dateRangePredefined.map((option) => (
        <SelectItem key={option} value={option}>
          {PREDEFINED_LABELS[option]}
        </SelectItem>
      ))}
    </Select>
  );

  const showCompareCustom =
    comparisonEnabled && value.predefined === "customDateRange";

  // Persist the Prior range we display instead of only showing a generated
  // default, so the data hook reads the same stored value and the displayed and
  // calculated previous windows can't diverge.
  useEffect(() => {
    if (showCompareCustom && !previousTimeFrame && onPreviousTimeFrameChange) {
      onPreviousTimeFrameChange(defaultPriorRange(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showCompareCustom,
    previousTimeFrame,
    value.predefined,
    value.startDate,
    value.endDate,
  ]);

  return (
    <Flex direction="column" gap="2" width="100%">
      {presetSelect}

      {value.predefined === "customLookback" && (
        <Flex gap="2" align="center">
          <Field
            type="number"
            min="1"
            disabled={disabled}
            style={{ width: "70px", height: "32px" }}
            value={value.lookbackValue ?? ""}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              onChange({
                ...value,
                lookbackValue: isNaN(parsed) ? undefined : parsed,
              });
            }}
          />
          <Box style={{ flex: 1 }}>
            <Select
              size="2"
              value={value.lookbackUnit ?? "day"}
              disabled={disabled}
              setValue={(v) =>
                onChange({
                  ...value,
                  lookbackUnit: v as (typeof lookbackUnit)[number],
                })
              }
            >
              {lookbackUnit.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}(s)
                </SelectItem>
              ))}
            </Select>
          </Box>
        </Flex>
      )}

      {value.predefined === "customDateRange" &&
        (showCompareCustom ? (
          <Flex direction="column" gap="1" width="100%">
            <LabeledRow label="Prior">
              <CustomRangeField
                value={previousTimeFrame ?? defaultPriorRange(value)}
                onChange={(dr) => onPreviousTimeFrameChange?.(dr)}
                disabled={disabled}
              />
            </LabeledRow>
            <LabeledRow label="">
              <Text size="small" weight="semibold">
                vs
              </Text>
            </LabeledRow>
            <LabeledRow label="Current">
              <CustomRangeField
                value={value}
                onChange={onChange}
                disabled={disabled}
              />
            </LabeledRow>
          </Flex>
        ) : (
          <CustomRangeField
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
    </Flex>
  );
}
