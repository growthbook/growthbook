import { Flex } from "@radix-ui/themes";
import { ReactNode } from "react";
import { ColumnRef, FactTableDefinition } from "shared/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import ShapeSelect from "@/components/FactTables/MetricEditor/ShapeSelect";
import ColumnSelect from "@/components/FactTables/MetricEditor/ColumnSelect";
import {
  onFactTableChange,
  onShapeChange,
  RatioShape,
  shapeFromColumnRef,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";

const RATIO_SHAPES: readonly RatioShape[] = [
  "count",
  "sum",
  "max",
  "distinct",
  "days",
  "users",
];

// Denominator's fact table override is a plain always-visible select here,
// not the design's read-only-value-plus-Edit-action treatment - a smaller,
// deliberate simplification for this pass, left for a later visual pass.
//
// `extra` is a single optional slot for the denominator's fact-table
// override, rendered between Shape/Column and Row filters - only the
// denominator caller passes it, so the numerator caller never receives
// props it wouldn't use.
function RatioPart({
  label,
  value,
  onChange,
  factTable,
  hasCountDistinctHLL,
  extra,
}: {
  label: string;
  value: ColumnRef;
  onChange: (value: ColumnRef) => void;
  factTable: FactTableDefinition | null;
  hasCountDistinctHLL: boolean;
  extra?: ReactNode;
}) {
  const shape = shapeFromColumnRef(value) ?? "sum";

  return (
    <Frame p="3" mb="0">
      <Text weight="semibold" size="sm" mb="2" as="div">
        {label}
      </Text>
      <Flex direction="column" gap="2">
        <Flex gap="2" align="end" wrap="wrap">
          <ShapeSelect
            value={shape}
            shapes={RATIO_SHAPES}
            factTable={factTable}
            hasCountDistinctHLL={hasCountDistinctHLL}
            onChange={(newShape) =>
              onChange(
                onShapeChange(value, newShape, factTable, hasCountDistinctHLL),
              )
            }
          />
          <ColumnSelect
            shape={shape}
            factTable={factTable}
            hasCountDistinctHLL={hasCountDistinctHLL}
            value={value.column}
            onChange={(column) => onChange({ ...value, column })}
          />
        </Flex>
        {extra}
        {factTable && (
          <RowFilterInput
            factTable={factTable}
            value={value.rowFilters || []}
            setValue={(rowFilters) => onChange({ ...value, rowFilters })}
          />
        )}
      </Flex>
    </Frame>
  );
}

// Ratio parts (spec): a Box per part, Shape (both sides also offer "Unique
// users") + Column, denominator additionally offers a fact table override
// when its shape isn't "users", and Row filters per part - unlike every
// other type, which shares one Row Filters section after the type block.
export default function RatioFields({
  numerator,
  onNumeratorChange,
  denominator,
  onDenominatorChange,
  factTable,
  availableFactTables,
  getFactTableById,
  hasCountDistinctHLL,
}: {
  numerator: ColumnRef;
  onNumeratorChange: (value: ColumnRef) => void;
  denominator: ColumnRef;
  onDenominatorChange: (value: ColumnRef) => void;
  factTable: FactTableDefinition | null;
  availableFactTables: FactTableDefinition[];
  getFactTableById: (id: string) => FactTableDefinition | null;
  hasCountDistinctHLL: boolean;
}) {
  const denominatorShape = shapeFromColumnRef(denominator) ?? "sum";
  const denominatorFactTable =
    getFactTableById(denominator.factTableId) ?? factTable;

  return (
    <Flex direction="column" gap="3">
      <RatioPart
        label="Numerator"
        value={numerator}
        onChange={onNumeratorChange}
        factTable={factTable}
        hasCountDistinctHLL={hasCountDistinctHLL}
      />
      <RatioPart
        label="Denominator"
        value={denominator}
        onChange={onDenominatorChange}
        factTable={denominatorFactTable}
        hasCountDistinctHLL={hasCountDistinctHLL}
        extra={
          denominatorShape !== "users" ? (
            <Select
              label="Fact table"
              value={denominator.factTableId}
              setValue={(factTableId) =>
                onDenominatorChange(
                  onFactTableChange(
                    denominator,
                    factTableId,
                    getFactTableById(factTableId),
                    hasCountDistinctHLL,
                  ),
                )
              }
            >
              {availableFactTables.map((ft) => (
                <SelectItem key={ft.id} value={ft.id}>
                  {ft.name}
                </SelectItem>
              ))}
            </Select>
          ) : undefined
        }
      />
    </Flex>
  );
}
