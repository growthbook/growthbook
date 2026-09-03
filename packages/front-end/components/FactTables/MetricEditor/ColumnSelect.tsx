import { FactTableDefinition } from "shared/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";
import { columnsForShape, RatioShape } from "./metricFormTranslation";

// columnsFor(shape, factTable).length === 0 means omit the field, not
// disable it (spec) - the null return is what makes that possible.
// hasCountDistinctHLL is required, not defaulted: forgetting it would
// silently offer "Count distinct" columns on a datasource that can't run it.
export default function ColumnSelect({
  shape,
  factTable,
  hasCountDistinctHLL,
  value,
  onChange,
  label = "Column",
}: {
  shape: RatioShape;
  factTable: FactTableDefinition | null;
  hasCountDistinctHLL: boolean;
  value: string;
  onChange: (column: string) => void;
  label?: string;
}) {
  const columns = columnsForShape(shape, factTable, hasCountDistinctHLL);
  if (columns.length === 0) return null;

  return (
    <Select label={label} value={value} setValue={onChange}>
      {columns.map((column) => {
        const col = factTable?.columns.find((c) => c.column === column);
        return (
          <SelectItem key={column} value={column}>
            {col?.name || column}
          </SelectItem>
        );
      })}
    </Select>
  );
}
