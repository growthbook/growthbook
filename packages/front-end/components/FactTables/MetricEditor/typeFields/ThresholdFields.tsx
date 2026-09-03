import { Flex } from "@radix-ui/themes";
import { FactTableDefinition } from "shared/types/fact-table";
import TextField from "@/ui/TextField";
import ShapeSelect from "@/components/FactTables/MetricEditor/ShapeSelect";
import ColumnSelect from "@/components/FactTables/MetricEditor/ColumnSelect";
import {
  fitColumn,
  shapeFromColumnRef,
  THRESHOLD_SHAPES,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";

export type ThresholdBasisValue = {
  aggregateFilterColumn?: string;
  aggregateFilter?: string;
};

// The ONE row (spec): Shape (count|sum only) + Column (if applicable) +
// comparison text. Shared by ThresholdFields and RetentionFields' optional
// threshold - both write the same aggregateFilterColumn/aggregateFilter pair.
export function ThresholdBasisRow({
  value,
  onChange,
  factTable,
}: {
  value: ThresholdBasisValue;
  onChange: (value: ThresholdBasisValue) => void;
  factTable: FactTableDefinition | null;
}) {
  const shape =
    shapeFromColumnRef({ column: value.aggregateFilterColumn || "$$count" }) ??
    "count";

  return (
    <Flex gap="2" align="end" wrap="wrap">
      <ShapeSelect
        label="Basis"
        value={shape}
        shapes={THRESHOLD_SHAPES}
        onChange={(newShape) =>
          onChange({
            ...value,
            aggregateFilterColumn: fitColumn(
              newShape,
              factTable,
              value.aggregateFilterColumn || "",
            ),
          })
        }
      />
      <ColumnSelect
        shape={shape}
        factTable={factTable}
        value={value.aggregateFilterColumn || ""}
        onChange={(column) =>
          onChange({ ...value, aggregateFilterColumn: column })
        }
      />
      <TextField
        label="Comparison"
        placeholder=">= 3"
        value={value.aggregateFilter || ""}
        onChange={(e) =>
          onChange({ ...value, aggregateFilter: e.target.value })
        }
      />
    </Flex>
  );
}

export default ThresholdBasisRow;
