import { RowFilter } from "shared/types/fact-table";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { DateFilterInput } from "./DateFilterInput";
import { DateRangeFilterInput } from "./DateRangeFilterInput";
import { isDateRangeOperator } from "./rowFilterUtils";

/**
 * Value input for a date-column row filter: a range picker for
 * `between`/`not_between`, otherwise a single-value picker. Shared by the Fact
 * Metric row filter (`RowFilterInput`) and the Product Analytics explorer
 * filter (`ExplorerFilterRow`) so their date-column behavior stays in lockstep.
 *
 * The picker edits the value as UTC — both the time of day and the calendar-day
 * boundaries a range uses. The value is compared exactly as entered, matching the
 * other date fields that feed a warehouse query (experiment analysis windows, the
 * explorer's own date range). Without saying so the same filter would read as two
 * different instants to two teammates in different timezones, so it carries a
 * `UTC` marker — inline, rather than the `(UTC)` label suffix those fields use,
 * since a filter row has no field label to append to.
 *
 * Only handles the single-value and range operators. The multi-value operators
 * (`in` / `not_in`) aren't offered for date columns in the UI but are accepted
 * by the REST API, and this renders one value — so call sites must keep routing
 * those to the regular multi-value input, which round-trips the whole list
 * instead of discarding all but the first entry on edit.
 */
export function DateColumnFilterInput({
  operator,
  values,
  onChange,
  inputWidth,
}: {
  operator: RowFilter["operator"];
  values: string[] | undefined;
  onChange: (values: string[]) => void;
  inputWidth?: number;
}) {
  return (
    <Flex align="center" gap="2">
      {/* Fills the row when the caller doesn't fix a width (the explorer
          sidebar), and shrinks to `inputWidth` when it does. */}
      <Box flexGrow="1" minWidth="0">
        {isDateRangeOperator(operator) ? (
          <DateRangeFilterInput
            values={values}
            onChange={onChange}
            inputWidth={inputWidth}
          />
        ) : (
          <DateFilterInput
            value={values?.[0]}
            operator={operator}
            onChange={onChange}
            inputWidth={inputWidth}
          />
        )}
      </Box>
      <Text size="sm" color="text-low" whiteSpace="nowrap">
        UTC
      </Text>
    </Flex>
  );
}
