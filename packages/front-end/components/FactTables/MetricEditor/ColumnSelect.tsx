import { FactTableDefinition } from "shared/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";
import DataList from "@/ui/DataList";
import {
  aggregationForShape,
  columnsForShape,
  columnValueLabel,
  RatioShape,
} from "./metricFormTranslation";

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
  canEdit = true,
}: {
  shape: RatioShape;
  factTable: FactTableDefinition | null;
  hasCountDistinctHLL: boolean;
  value: string;
  onChange: (column: string) => void;
  label?: string;
  canEdit?: boolean;
}) {
  if (!canEdit) {
    const agg = aggregationForShape(shape);
    return (
      <DataList
        maxColumns={1}
        data={[
          { label, value: columnValueLabel(value, factTable) },
          ...(agg
            ? [{ label: "Per-User Aggregation", value: agg.toUpperCase() }]
            : []),
        ]}
      />
    );
  }

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
