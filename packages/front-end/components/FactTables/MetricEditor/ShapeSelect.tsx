import { Select, SelectItem } from "@/ui/Select";
import { RatioShape } from "./metricFormTranslation";

const SHAPE_LABELS: Record<RatioShape, string> = {
  count: "Row count",
  sum: "Column sum",
  max: "Column max",
  distinct: "Count distinct",
  days: "Active days",
  users: "Unique users",
};

export default function ShapeSelect({
  value,
  onChange,
  shapes,
  label = "Shape",
}: {
  value: RatioShape;
  onChange: (shape: RatioShape) => void;
  shapes: readonly RatioShape[];
  label?: string;
}) {
  return (
    <Select
      label={label}
      value={value}
      setValue={(v) => onChange(v as RatioShape)}
    >
      {shapes.map((shape) => (
        <SelectItem key={shape} value={shape}>
          {SHAPE_LABELS[shape]}
        </SelectItem>
      ))}
    </Select>
  );
}
