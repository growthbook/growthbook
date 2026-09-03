import { FactTableDefinition } from "shared/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";
import { availableShapes, RatioShape } from "./metricFormTranslation";

const SHAPE_LABELS: Record<RatioShape, string> = {
  count: "Row count",
  sum: "Column sum",
  max: "Column max",
  distinct: "Count distinct",
  days: "Active days",
  users: "Unique users",
};

// hasCountDistinctHLL is required, not defaulted: forgetting it would
// silently offer "Count distinct" on a datasource that can't run it.
export default function ShapeSelect({
  value,
  onChange,
  shapes,
  factTable,
  hasCountDistinctHLL,
  label = "Shape",
}: {
  value: RatioShape;
  onChange: (shape: RatioShape) => void;
  shapes: readonly RatioShape[];
  factTable: FactTableDefinition | null;
  hasCountDistinctHLL: boolean;
  label?: string;
}) {
  const options = availableShapes(shapes, factTable, hasCountDistinctHLL);

  return (
    <Select
      label={label}
      value={value}
      setValue={(v) => onChange(v as RatioShape)}
    >
      {options.map((shape) => (
        <SelectItem key={shape} value={shape}>
          {SHAPE_LABELS[shape]}
        </SelectItem>
      ))}
    </Select>
  );
}
