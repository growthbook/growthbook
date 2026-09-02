import { Box, Flex } from "@radix-ui/themes";
import { ColumnRef, FactTableDefinition } from "shared/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
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
function RatioPart({
  label,
  value,
  onChange,
  factTable,
  hasCountDistinctHLL,
  isDenominator,
  availableFactTables,
  getFactTableById,
}: {
  label: string;
  value: ColumnRef;
  onChange: (value: ColumnRef) => void;
  factTable: FactTableDefinition | null;
  hasCountDistinctHLL?: boolean;
  isDenominator?: boolean;
  availableFactTables?: FactTableDefinition[];
  getFactTableById?: (id: string) => FactTableDefinition | null;
}) {
  const shape = shapeFromColumnRef(value) ?? "sum";
  const partFactTable = isDenominator
    ? (getFactTableById?.(value.factTableId) ?? factTable)
    : factTable;

  return (
    <Box className="appbox p-3">
      <Text weight="semibold" size="sm" mb="2" as="div">
        {label}
      </Text>
      <Flex direction="column" gap="2">
        <Flex gap="2" align="end" wrap="wrap">
          <ShapeSelect
            value={shape}
            shapes={RATIO_SHAPES}
            onChange={(newShape) =>
              onChange(
                onShapeChange(
                  value,
                  newShape,
                  partFactTable,
                  hasCountDistinctHLL,
                ),
              )
            }
          />
          <ColumnSelect
            shape={shape}
            factTable={partFactTable}
            hasCountDistinctHLL={hasCountDistinctHLL}
            value={value.column}
            onChange={(column) => onChange({ ...value, column })}
          />
        </Flex>
        {isDenominator && shape !== "users" && availableFactTables && (
          <Select
            label="Fact table"
            value={value.factTableId}
            setValue={(factTableId) =>
              onChange(
                onFactTableChange(
                  value,
                  factTableId,
                  getFactTableById?.(factTableId) ?? null,
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
        )}
        {partFactTable && (
          <RowFilterInput
            factTable={partFactTable}
            value={value.rowFilters || []}
            setValue={(rowFilters) => onChange({ ...value, rowFilters })}
          />
        )}
      </Flex>
    </Box>
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
  availableFactTables?: FactTableDefinition[];
  getFactTableById?: (id: string) => FactTableDefinition | null;
  hasCountDistinctHLL?: boolean;
}) {
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
        factTable={factTable}
        hasCountDistinctHLL={hasCountDistinctHLL}
        isDenominator
        availableFactTables={availableFactTables}
        getFactTableById={getFactTableById}
      />
    </Flex>
  );
}
