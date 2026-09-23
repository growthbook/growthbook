import { FactTableDefinition } from "shared/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";
import DataList from "@/ui/DataList";
import Callout from "@/ui/Callout";
import {
  aggregationForShape,
  columnsForShape,
  columnValueLabel,
  RatioShape,
} from "./metricFormTranslation";

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

  const columns = columnsForShape(shape, factTable, {
    hasCountDistinctHLL: () => hasCountDistinctHLL,
  });
  if (columns.length === 0) {
    if (
      !factTable ||
      shape === "count" ||
      shape === "days" ||
      shape === "users"
    ) {
      return null;
    }
    return (
      <Callout status="warning" size="sm">
        {shape === "distinct" && !hasCountDistinctHLL
          ? "Count distinct is not supported by this Data Source. Choose a different metric type or a fact table from a supported Data Source."
          : shape === "distinct"
            ? "No eligible string columns in this fact table. Count distinct requires a string column. Choose a different fact table or metric type."
            : "No eligible numeric columns in this fact table. This aggregation requires a numeric column. Choose a different fact table or metric type."}
      </Callout>
    );
  }

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
