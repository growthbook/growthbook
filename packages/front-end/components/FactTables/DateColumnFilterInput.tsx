import { RowFilter } from "shared/types/fact-table";
import { DateFilterInput } from "./DateFilterInput";
import { DateRangeFilterInput } from "./DateRangeFilterInput";
import { isDateRangeOperator } from "./rowFilterUtils";

/**
 * Value input for a date-column row filter: a range picker for
 * `between`/`not_between`, otherwise a single-value picker. Shared by the Fact
 * Metric row filter (`RowFilterInput`) and the Product Analytics explorer
 * filter (`ExplorerFilterRow`) so their date-column behavior stays in lockstep.
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
  if (isDateRangeOperator(operator)) {
    return (
      <DateRangeFilterInput
        values={values}
        onChange={onChange}
        inputWidth={inputWidth}
      />
    );
  }
  return (
    <DateFilterInput
      value={values?.[0]}
      operator={operator}
      onChange={onChange}
      inputWidth={inputWidth}
    />
  );
}
