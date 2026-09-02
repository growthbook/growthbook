import { FactTableDefinition } from "shared/types/fact-table";
import ColumnSelect from "@/components/FactTables/MetricEditor/ColumnSelect";
import { Shape } from "@/components/FactTables/MetricEditor/metricFormTranslation";

// Value-group types (rowCount/colSum/colMax/countDist/activeDays): the type
// choice already pins the shape 1:1, so only Column renders - no ShapeSelect
// (spec: hide it, since showing one that must always agree with the type
// picker is pure surface area for a bug).
export default function ValueFields({
  shape,
  factTable,
  hasCountDistinctHLL,
  value,
  onChange,
}: {
  shape: Shape;
  factTable: FactTableDefinition | null;
  hasCountDistinctHLL?: boolean;
  value: string;
  onChange: (column: string) => void;
}) {
  return (
    <ColumnSelect
      shape={shape}
      factTable={factTable}
      hasCountDistinctHLL={hasCountDistinctHLL}
      value={value}
      onChange={onChange}
    />
  );
}
