import { ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { format } from "date-fns";
import {
  comparisonMode as comparisonModes,
  dateRangePredefined,
  lookbackUnit,
  ComparisonMode,
  ExplorationDateRange,
} from "shared/validators";
import {
  calculateProductAnalyticsDateRange,
  getInclusiveUtcCalendarDayCount,
  getPrimaryUtcDayBounds,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import { getValidDateOffsetByUTC } from "shared/dates";
import { Select, SelectItem } from "@/ui/Select";
import Field from "@/components/Forms/Field";
import Text from "@/ui/Text";
import DatePicker from "@/components/DatePicker";
import { formatCollapsedDateRange } from "@/enterprise/components/ProductAnalytics/comparison-chart";
import { COMPARISON_MODE_LABELS } from "@/enterprise/components/ProductAnalytics/dateRangeLabels";

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

// Combined "yyyy-MM-dd - yyyy-MM-dd" range field bound to an ExplorationDateRange.
function CustomRangeField({
  value,
  onChange,
}: {
  value: ExplorationDateRange;
  onChange: (dr: ExplorationDateRange) => void;
}) {
  return (
    <DatePicker
      containerClassName="mb-0"
      compact
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
 * When comparison is on it also shows a "Compare to" mode selector, and for the
 * `custom` mode the "Prior / vs / Current" fields driven by the block's
 * comparison previousTimeFrame.
 */
export default function BlockDateRangePicker({
  value,
  onChange,
  comparisonEnabled = false,
  comparisonMode = "previousPeriod",
  onComparisonModeChange,
  previousTimeFrame,
  onPreviousTimeFrameChange,
}: {
  value: ExplorationDateRange;
  onChange: (dateRange: ExplorationDateRange) => void;
  comparisonEnabled?: boolean;
  comparisonMode?: ComparisonMode;
  onComparisonModeChange?: (mode: ComparisonMode) => void;
  previousTimeFrame?: ExplorationDateRange;
  onPreviousTimeFrameChange?: (dr: ExplorationDateRange) => void;
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
      size="small"
      value={value.predefined}
      placeholder="Select range"
      setValue={(v) => setPredefined(v as (typeof dateRangePredefined)[number])}
    >
      {dateRangePredefined.map((option) => (
        <SelectItem key={option} value={option}>
          {PREDEFINED_LABELS[option]}
        </SelectItem>
      ))}
    </Select>
  );

  const resolvedPrevious = resolveComparisonPreviousTimeFrame(value, {
    mode: comparisonMode,
    previousTimeFrame,
  });
  const showCompareCustom = comparisonEnabled && comparisonMode === "custom";
  const yearModesOverlap =
    getInclusiveUtcCalendarDayCount(
      getPrimaryUtcDayBounds(value).startDate,
      getPrimaryUtcDayBounds(value).endDate,
    ) > 366;

  const modeSelect = (
    <Select
      size="small"
      value={comparisonMode}
      setValue={(v) => onComparisonModeChange?.(v as ComparisonMode)}
    >
      {comparisonModes.map((mode) => (
        <SelectItem
          key={mode}
          value={mode}
          disabled={yearModesOverlap && mode === "previousYear"}
        >
          {COMPARISON_MODE_LABELS[mode]}
        </SelectItem>
      ))}
    </Select>
  );

  return (
    <Flex direction="column" gap="2" width="100%">
      {presetSelect}

      {value.predefined === "customLookback" && (
        <Flex gap="2" align="center">
          <Field
            type="number"
            min="1"
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
              size="small"
              value={value.lookbackUnit ?? "day"}
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

      {comparisonEnabled && (
        <LabeledRow label="Compare to">{modeSelect}</LabeledRow>
      )}

      {showCompareCustom ? (
        <Flex direction="column" gap="1" width="100%">
          <LabeledRow label="Prior">
            <CustomRangeField
              value={resolvedPrevious}
              onChange={(dr) => onPreviousTimeFrameChange?.(dr)}
            />
          </LabeledRow>
          <LabeledRow label="">
            <Text size="small" weight="semibold">
              vs
            </Text>
          </LabeledRow>
          <LabeledRow label="Current">
            {value.predefined === "customDateRange" ? (
              <CustomRangeField value={value} onChange={onChange} />
            ) : (
              <Text size="small" color="text-low">
                {formatCollapsedDateRange(
                  calculateProductAnalyticsDateRange(value).startDate,
                  calculateProductAnalyticsDateRange(value).endDate,
                )}
              </Text>
            )}
          </LabeledRow>
        </Flex>
      ) : (
        <>
          {comparisonEnabled && (
            <LabeledRow label="Prior">
              <Text size="small" color="text-low">
                {formatCollapsedDateRange(
                  getValidDateOffsetByUTC(resolvedPrevious.startDate as string),
                  getValidDateOffsetByUTC(resolvedPrevious.endDate as string),
                )}
              </Text>
            </LabeledRow>
          )}
          {value.predefined === "customDateRange" && (
            <CustomRangeField value={value} onChange={onChange} />
          )}
        </>
      )}
    </Flex>
  );
}
