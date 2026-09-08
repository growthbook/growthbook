import { Flex } from "@radix-ui/themes";
import { FactTableDefinition } from "shared/types/fact-table";
import TextField from "@/ui/TextField";
import DataList from "@/ui/DataList";
import ShapeSelect, {
  SHAPE_LABELS,
} from "@/components/FactTables/MetricEditor/ShapeSelect";
import ColumnSelect from "@/components/FactTables/MetricEditor/ColumnSelect";
import {
  columnsForShape,
  columnValueLabel,
  fitColumn,
  shapeFromColumnRef,
  THRESHOLD_SHAPES,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";

export type ThresholdBasisValue = {
  aggregateFilterColumn?: string;
  aggregateFilter?: string;
};

// The ONE row (spec): Shape (count|sum only) + Column (if applicable) +
// comparison text. Shared by the standalone Threshold type and
// RetentionFields' optional threshold - both write the same
// aggregateFilterColumn/aggregateFilter pair.
export function ThresholdBasisRow({
  value,
  onChange,
  factTable,
  canEdit = true,
}: {
  value: ThresholdBasisValue;
  onChange: (value: ThresholdBasisValue) => void;
  factTable: FactTableDefinition | null;
  canEdit?: boolean;
}) {
  const shape =
    shapeFromColumnRef({ column: value.aggregateFilterColumn || "$$count" }) ??
    "count";

  if (!canEdit) {
    const hasColumn = columnsForShape(shape, factTable, false).length > 0;
    return (
      <DataList
        data={[
          { label: "Basis", value: SHAPE_LABELS[shape] },
          ...(hasColumn
            ? [
                {
                  label: "Column",
                  value: columnValueLabel(value.aggregateFilterColumn || ""),
                },
              ]
            : []),
          { label: "Comparison", value: value.aggregateFilter || "—" },
        ]}
      />
    );
  }

  return (
    <Flex gap="2" align="end" wrap="wrap">
      <ShapeSelect
        label="Basis"
        value={shape}
        shapes={THRESHOLD_SHAPES}
        factTable={factTable}
        // THRESHOLD_SHAPES is count/sum only - distinct never appears, so
        // this value never actually gates anything here.
        hasCountDistinctHLL={false}
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
        hasCountDistinctHLL={false}
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
