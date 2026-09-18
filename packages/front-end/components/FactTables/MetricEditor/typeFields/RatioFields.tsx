import { Flex } from "@radix-ui/themes";
import { ReactNode } from "react";
import { ColumnRef, FactTableDefinition } from "shared/types/fact-table";
import useFullFactTable from "@/hooks/useFullFactTable";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import DataList from "@/ui/DataList";
import Badge from "@/ui/Badge";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import FactTableLink from "@/components/FactTables/MetricEditor/FactTableLink";
import FilterSummary from "@/components/FactTables/MetricEditor/FilterSummary";
import ShapeSelect from "@/components/FactTables/MetricEditor/ShapeSelect";
import ColumnSelect from "@/components/FactTables/MetricEditor/ColumnSelect";
import {
  aggregationForShape,
  columnValueLabel,
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

function RatioPart({
  label,
  value,
  onChange,
  factTable,
  hasCountDistinctHLL,
  before,
  canEdit = true,
}: {
  label: string;
  value: ColumnRef;
  onChange: (value: ColumnRef) => void;
  factTable: FactTableDefinition | null;
  hasCountDistinctHLL: boolean;
  before?: ReactNode;
  canEdit?: boolean;
}) {
  const shape = shapeFromColumnRef(value) ?? "sum";

  if (!canEdit) {
    const agg = aggregationForShape(shape);
    return (
      <Frame p="4" mb="0">
        <Badge label={label} color="violet" radius="small" mb="4" />
        <DataList
          columns={2}
          mb="4"
          data={[
            {
              label: "Fact table",
              value: <FactTableLink id={value.factTableId} />,
            },
            {
              label: "Value",
              value: (
                <Text size="sm" color="text-mid">
                  {columnValueLabel(value.column, factTable)}
                  {agg ? ` - ${agg.toUpperCase()} per user` : ""}
                </Text>
              ),
            },
          ]}
        />
        <FilterSummary
          rowFilters={value.rowFilters || []}
          factTable={factTable}
        />
      </Frame>
    );
  }

  return (
    <Frame px="3" py="3" mb="0">
      <Text weight="semibold" size="sm" mb="2" as="div">
        {label}
      </Text>
      <Flex direction="column" gap="2">
        {before}
        {factTable && (
          <RowFilterInput
            factTable={factTable}
            value={value.rowFilters || []}
            setValue={(rowFilters) => onChange({ ...value, rowFilters })}
          />
        )}
        <Flex gap="2" align="end" wrap="wrap">
          <ShapeSelect
            label="Aggregation"
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
      </Flex>
    </Frame>
  );
}

// Ratio parts (spec): a Box per part, Shape (both sides also offer "Unique
// users") + Column, denominator additionally offers a fact table override
// when its shape isn't "users", with Row filters directly after each table.
export default function RatioFields({
  numeratorFactTableSelect,
  numerator,
  onNumeratorChange,
  denominator,
  onDenominatorChange,
  factTable,
  availableFactTables,
  getFactTableById,
  hasCountDistinctHLL,
  canEdit = true,
}: {
  numeratorFactTableSelect: ReactNode;
  numerator: ColumnRef;
  onNumeratorChange: (value: ColumnRef) => void;
  denominator: ColumnRef;
  onDenominatorChange: (value: ColumnRef) => void;
  factTable: FactTableDefinition | null;
  availableFactTables: FactTableDefinition[];
  getFactTableById: (id: string) => FactTableDefinition | null;
  hasCountDistinctHLL: boolean;
  canEdit?: boolean;
}) {
  const denominatorShape = shapeFromColumnRef(denominator) ?? "sum";
  // getFactTableById (still used below, for onFactTableChange's own column
  // refit) returns the slim definitions-endpoint shape - fine for that, but
  // this specific value renders the denominator's own column/filter pickers,
  // which need jsonFields the same way the numerator's factTable prop does.
  const { factTable: fullDenominatorFactTable } = useFullFactTable(
    denominator.factTableId || null,
  );
  const denominatorFactTable = fullDenominatorFactTable ?? factTable;

  return (
    <Flex direction="column" gap="3">
      <RatioPart
        label="Numerator"
        before={numeratorFactTableSelect}
        value={numerator}
        onChange={onNumeratorChange}
        factTable={factTable}
        hasCountDistinctHLL={hasCountDistinctHLL}
        canEdit={canEdit}
      />
      <RatioPart
        label="Denominator"
        value={denominator}
        onChange={onDenominatorChange}
        factTable={denominatorFactTable}
        hasCountDistinctHLL={hasCountDistinctHLL}
        canEdit={canEdit}
        before={
          canEdit && denominatorShape !== "users" ? (
            <Flex align="center" gap="2" wrap="wrap">
              <Text color="text-mid">Fact table:</Text>
              <Select
                aria-label="Denominator fact table"
                placeholder="Select a fact table"
                variant="ghost"
                style={{ fontWeight: 600 }}
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
            </Flex>
          ) : undefined
        }
      />
    </Flex>
  );
}
