import { useState } from "react";
import { z } from "zod";
import dJSON from "dirty-json";
import {
  columnRefValidator,
  metricTypeValidator,
  quantileSettingsValidator,
  windowSettingsValidator,
} from "shared/validators";
import { RowFilter } from "shared/types/fact-table";
import { canInlineFilterColumn } from "shared/experiments";
import { Flex } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  columnsForShape,
  columnValueLabel,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { Select, SelectItem } from "@/ui/Select";

export const templateMetricValidator = z.object({
  metricType: metricTypeValidator.exclude(["funnel"]),
  name: z.string(),
  numerator: columnRefValidator,
  denominator: columnRefValidator.optional(),
  inverse: z.boolean().optional(),
  description: z.string().optional(),
  quantileSettings: quantileSettingsValidator.optional(),
  windowSettings: windowSettingsValidator.optional(),
});
export type TemplateMetric = z.infer<typeof templateMetricValidator>;
export type MappedTemplateMetric = TemplateMetric & { datasource: string };

// A template's numerator/denominator arrive with placeholder column names
// and no fact table - blank those fields (they get filled in by
// TemplateFieldMapping) before validating. Throws on malformed JSON or a
// shape templateMetricValidator rejects.
export function parseMetricTemplate(raw: string): TemplateMetric {
  const json = dJSON.parse(raw);
  if (json.numerator) {
    json.numerator.factTableId = "";
    json.numerator.rowFilters = json.numerator.rowFilters || [];
    json.numerator.column =
      json.metricType === "proportion" || json.metricType === "retention"
        ? "$$distinctUsers"
        : json.numerator.column || "";
  }
  if (json.denominator) {
    json.denominator.factTableId = "";
    json.denominator.rowFilters = json.denominator.rowFilters || [];
    json.denominator.column = json.denominator.column || "";
  }
  return templateMetricValidator.parse(json);
}

// A template's numerator/denominator carry placeholder column names, not
// real ones - collect them split by which kind of real column can fill each
// slot (matches FactMetricModal's own FieldMappingModal exactly: a count-
// distinct aggregation column and a row-filter column both resolve against
// the same inline-filterable string-column list, not two different ones).
function placeholderColumns(template: TemplateMetric) {
  const numeric = new Set<string>();
  const string = new Set<string>();
  const add = (set: Set<string>, column?: string) => {
    if (column && !column.startsWith("$$")) set.add(column);
  };
  const { numerator, denominator } = template;
  add(
    numerator.aggregation === "count distinct" ? string : numeric,
    numerator.column,
  );
  if (denominator) {
    add(
      denominator.aggregation === "count distinct" ? string : numeric,
      denominator.column,
    );
  }
  add(numeric, numerator.aggregateFilterColumn);
  numerator.rowFilters?.forEach((f) => add(string, f.column));
  denominator?.rowFilters?.forEach((f) => add(string, f.column));
  return { numeric, string };
}

function mappedColumn(
  column: string | undefined,
  numericMap: Record<string, string>,
  stringMap: Record<string, string>,
): string | undefined {
  if (!column) return column;
  if (column in numericMap) return numericMap[column] || column;
  if (column in stringMap) return stringMap[column] || column;
  return column;
}

function mappedRowFilters(
  filters: RowFilter[] | undefined,
  stringMap: Record<string, string>,
): RowFilter[] | undefined {
  return filters?.map((f) => ({
    ...f,
    column: (f.column && stringMap[f.column]) || f.column,
  }));
}

export default function TemplateFieldMapping({
  template,
  onMapped,
}: {
  template: TemplateMetric;
  onMapped: (mapped: MappedTemplateMetric) => void;
}) {
  const { factTables, getFactTableById } = useDefinitions();
  const { numeric: numericPlaceholders, string: stringPlaceholders } =
    placeholderColumns(template);

  const [factTableId, setFactTableId] = useState("");
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
    if (!newFactTable) return;
    // Auto-fill any mapping whose placeholder name exactly matches a real
    // column of the right kind, same convenience FieldMappingModal has.
    setNumericMap((prev) =>
      Object.fromEntries(
        Object.keys(prev).map((k) => [
          k,
          newFactTable.columns.some(
            (c) => c.column === k && !c.deleted && c.datatype === "number",
          )
            ? k
            : prev[k],
        ]),
      ),
    );
    setStringMap((prev) =>
      Object.fromEntries(
        Object.keys(prev).map((k) => [
          k,
          canInlineFilterColumn(newFactTable, k) ? k : prev[k],
        ]),
      ),
    );
  }

  const canContinue =
    !!factTableId &&
    Object.values(numericMap).every(Boolean) &&
    Object.values(stringMap).every(Boolean);

  function handleContinue() {
    const { numerator, denominator } = template;
    onMapped({
      ...template,
      datasource: factTable?.datasource ?? "",
      numerator: {
        ...numerator,
        factTableId,
        column:
          mappedColumn(numerator.column, numericMap, stringMap) ??
          numerator.column,
        aggregateFilterColumn: mappedColumn(
          numerator.aggregateFilterColumn,
          numericMap,
          stringMap,
        ),
        rowFilters: mappedRowFilters(numerator.rowFilters, stringMap),
      },
      denominator: denominator
        ? {
            ...denominator,
            factTableId,
            column:
              mappedColumn(denominator.column, numericMap, stringMap) ??
              denominator.column,
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
        <strong>{template.name}</strong>
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
        {[...numericPlaceholders].map((placeholder) => (
          <Select
            key={placeholder}
            label={`Column: ${placeholder}`}
            value={numericMap[placeholder] || ""}
            setValue={(v) => setNumericMap({ ...numericMap, [placeholder]: v })}
            disabled={!factTable || !numericOptions.length}
            placeholder="Select..."
          >
            {numericOptions.map((col) => (
              <SelectItem key={col} value={col}>
                {columnValueLabel(col, factTable)}
              </SelectItem>
            ))}
          </Select>
        ))}
        {[...stringPlaceholders].map((placeholder) => (
          <Select
            key={placeholder}
            label={`Column: ${placeholder}`}
            value={stringMap[placeholder] || ""}
            setValue={(v) => setStringMap({ ...stringMap, [placeholder]: v })}
            disabled={!factTable || !stringOptions.length}
            placeholder="Select..."
          >
            {stringOptions.map((col) => (
              <SelectItem key={col} value={col}>
                {columnValueLabel(col, factTable)}
              </SelectItem>
            ))}
          </Select>
        ))}
        <Flex>
          <Button onClick={handleContinue} disabled={!canContinue}>
            Continue
          </Button>
        </Flex>
      </Flex>
    </Frame>
  );
}
