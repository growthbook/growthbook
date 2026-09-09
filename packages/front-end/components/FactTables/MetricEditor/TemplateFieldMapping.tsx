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
  // Separate maps, not one keyed by placeholder name - a placeholder name is
  // just a label a template author chose, and the same name can appear in
  // both sets (e.g. a numeric aggregation column here, a string row-filter
  // column there); one shared map would let picking one silently overwrite
  // the other.
  const [numericMap, setNumericMap] = useState<Record<string, string>>(
    Object.fromEntries([...numericPlaceholders].map((c) => [c, ""])),
  );
  const [stringMap, setStringMap] = useState<Record<string, string>>(
    Object.fromEntries([...stringPlaceholders].map((c) => [c, ""])),
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
    const rebuild = (prev: Record<string, string>, isNumeric: boolean) =>
      Object.fromEntries(
        Object.keys(prev).map((k) => [
          k,
          newFactTable && autoFillsColumn(k, isNumeric, newFactTable) ? k : "",
        ]),
      );
    setNumericMap((prev) => rebuild(prev, true));
    setStringMap((prev) => rebuild(prev, false));
  }

  const canContinue =
    !!factTableId &&
    Object.values(numericMap).every(Boolean) &&
    Object.values(stringMap).every(Boolean);

  function placeholderSelect(
    placeholder: string,
    options: string[],
    map: Record<string, string>,
    setMap: (
      updater: (prev: Record<string, string>) => Record<string, string>,
    ) => void,
  ) {
    return (
      <Select
        key={placeholder}
        label={`Column: ${placeholder}`}
        value={map[placeholder] || ""}
        setValue={(v) => setMap((prev) => ({ ...prev, [placeholder]: v }))}
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
        column:
          mappedColumn(
            numerator.column,
            numerator.aggregation === "count distinct" ? stringMap : numericMap,
          ) ?? numerator.column,
        aggregateFilterColumn: mappedColumn(
          numerator.aggregateFilterColumn,
          numericMap,
        ),
        rowFilters: mappedRowFilters(numerator.rowFilters, stringMap),
      },
      denominator: denominator
        ? {
            ...denominator,
            factTableId,
            column:
              mappedColumn(
                denominator.column,
                denominator.aggregation === "count distinct"
                  ? stringMap
                  : numericMap,
              ) ?? denominator.column,
            rowFilters: mappedRowFilters(denominator.rowFilters, stringMap),
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
          placeholderSelect(
            placeholder,
            numericOptions,
            numericMap,
            setNumericMap,
          ),
        )}
        {[...stringPlaceholders].map((placeholder) =>
          placeholderSelect(
            placeholder,
            stringOptions,
            stringMap,
            setStringMap,
          ),
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
