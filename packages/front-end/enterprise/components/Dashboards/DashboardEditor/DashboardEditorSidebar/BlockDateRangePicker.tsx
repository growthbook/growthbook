import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import {
  dateRangePredefined,
  lookbackUnit,
  ExplorationDateRange,
} from "shared/validators";
import { getValidDateOffsetByUTC } from "shared/dates";
import { Select, SelectItem } from "@/ui/Select";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import { DATE_RANGE_PREDEFINED_LABELS } from "@/enterprise/components/ProductAnalytics/dateRangeLabels";

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

/**
 * Context-free date range picker bound to a value/onChange instead of the
 * ExplorerContext. Used by the Metric Experiments block, which configures two
 * independent ranges and has no comparison of its own.
 */
export default function BlockDateRangePicker({
  value,
  onChange,
}: {
  value: ExplorationDateRange;
  onChange: (dateRange: ExplorationDateRange) => void;
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
          {DATE_RANGE_PREDEFINED_LABELS[option]}
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

      {value.predefined === "customDateRange" && (
        <CustomRangeField value={value} onChange={onChange} />
      )}
    </Flex>
  );
}
