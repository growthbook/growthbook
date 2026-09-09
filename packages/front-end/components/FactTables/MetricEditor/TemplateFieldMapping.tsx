import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { canInlineFilterColumn } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  columnsForShape,
  columnValueLabel,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";
import {
  autoFillsColumn,
  FactMetricSeed,
  IncompleteFactMetricSeed,
  mappedColumn,
  mappedRowFilters,
  placeholderColumns,
} from "@/components/FactTables/MetricEditor/templateMetric";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { Select, SelectItem } from "@/ui/Select";

export default function TemplateFieldMapping({
  template,
  onMapped,
}: {
  template: IncompleteFactMetricSeed;
  onMapped: (mapped: FactMetricSeed) => void;
}) {
  const { factTables, getFactTableById } = useDefinitions();
  const { numeric: numericPlaceholders, string: stringPlaceholders } =
    placeholderColumns(template);

  const [factTableId, setFactTableId] = useState("");
  const [columnMap, setColumnMap] = useState<Record<string, string>>(
    Object.fromEntries(
      [...numericPlaceholders, ...stringPlaceholders].map((c) => [c, ""]),
    ),
  );

  const factTable = getFactTableById(factTableId);
  const numericOptions = factTable ? columnsForShape("sum", factTable) : [];
  const stringOptions = factTable
    ? factTable.columns
        .filter(
          (c) =>
            !c.deleted &&
            c.datatype === "string" &&
            canInlineFilterColumn(factTable, c.column),
        )
        .map((c) => c.column)
    : [];

  function changeFactTable(newFactTableId: string) {
    setFactTableId(newFactTableId);
    const newFactTable = getFactTableById(newFactTableId);
    // Rebuild every mapping from scratch against the new fact table - never
    // carry forward a value picked against a different table, which could
    // silently reference a column that doesn't exist here.
    setColumnMap((prev) =>
      Object.fromEntries(
        Object.keys(prev).map((k) => [
          k,
          newFactTable &&
          autoFillsColumn(k, numericPlaceholders.has(k), newFactTable)
            ? k
            : "",
        ]),
      ),
    );
  }

  const canContinue = !!factTableId && Object.values(columnMap).every(Boolean);

  function placeholderSelect(placeholder: string, options: string[]) {
    return (
      <Select
        key={placeholder}
        label={`Column: ${placeholder}`}
        value={columnMap[placeholder] || ""}
        setValue={(v) => setColumnMap({ ...columnMap, [placeholder]: v })}
        disabled={!factTable || !options.length}
        placeholder="Select..."
      >
        {options.map((col) => (
          <SelectItem key={col} value={col}>
            {columnValueLabel(col, factTable)}
          </SelectItem>
        ))}
      </Select>
    );
  }

  function handleContinue() {
    if (!canContinue) return;
    const { numerator, denominator } = template;
    onMapped({
      ...template,
      datasource: factTable?.datasource ?? "",
      numerator: {
        ...numerator,
        factTableId,
        column: mappedColumn(numerator.column, columnMap) ?? numerator.column,
        aggregateFilterColumn: mappedColumn(
          numerator.aggregateFilterColumn,
          columnMap,
        ),
        rowFilters: mappedRowFilters(numerator.rowFilters, columnMap),
      },
      denominator: denominator
        ? {
            ...denominator,
            factTableId,
            column:
              mappedColumn(denominator.column, columnMap) ?? denominator.column,
            rowFilters: mappedRowFilters(denominator.rowFilters, columnMap),
          }
        : undefined,
    });
  }

  return (
    <Frame>
      <Heading as="h4" size="sm">
        Map template fields to your fact table
      </Heading>
      <Text color="text-mid" as="div" mb="3">
        <strong>{template.name || "New metric"}</strong>
        {template.description ? ` — ${template.description}` : ""}
      </Text>
      <Flex direction="column" gap="3">
        <Select
          label="Fact table"
          value={factTableId}
          setValue={changeFactTable}
          placeholder="Select..."
        >
          {factTables.map((ft) => (
            <SelectItem key={ft.id} value={ft.id}>
              {ft.name}
            </SelectItem>
          ))}
        </Select>
        {factTable &&
          (numericPlaceholders.size > 0 || stringPlaceholders.size > 0) && (
            <Text color="text-mid" as="div">
              This metric template references the columns below. Select how to
              map them to columns in your fact table.
            </Text>
          )}
        {factTable &&
          numericPlaceholders.size > 0 &&
          !numericOptions.length && (
            <Callout status="error">
              This fact table has no numeric columns. Select a different fact
              table.
            </Callout>
          )}
        {factTable && stringPlaceholders.size > 0 && !stringOptions.length && (
          <Callout status="error">
            This fact table has no string columns to filter on. Select a
            different fact table.
          </Callout>
        )}
        {[...numericPlaceholders].map((placeholder) =>
          placeholderSelect(placeholder, numericOptions),
        )}
        {[...stringPlaceholders].map((placeholder) =>
          placeholderSelect(placeholder, stringOptions),
        )}
        <Flex>
          <Button onClick={handleContinue} disabled={!canContinue}>
            Continue
          </Button>
        </Flex>
      </Flex>
    </Frame>
  );
}
