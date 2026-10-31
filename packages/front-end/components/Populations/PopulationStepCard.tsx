import { ReactNode, useMemo } from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import type { PopulationStep } from "shared/validators";
import type { FactTableInterface } from "shared/types/fact-table";
import { parseAggregateFilterForEditor } from "shared/populations";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import { radixSize } from "@/ui/sizes";
import SelectField from "@/components/Forms/SelectField";
import { RowFilterEditorRows } from "@/components/FactTables/RowFilterFields";
import {
  emptyColumnRowFilter,
  factTableToColumnSource,
} from "@/components/FactTables/rowFilterUtils";
import useFullFactTable from "@/hooks/useFullFactTable";
import { useDefinitions } from "@/services/DefinitionsContext";
import { capitalizeFirstLetter } from "@/services/utils";
import { POPULATION_AGGREGATE_OPERATORS } from "./populationDraft";

const DEFAULT_AGGREGATE_FILTER = ">=2";

export default function PopulationStepCard({
  step,
  datasource,
  userIdTypes,
  onChange,
}: {
  step: PopulationStep;
  datasource: string;
  userIdTypes: string[];
  onChange: (step: PopulationStep) => void;
}) {
  const { factTables, getFactTableById } = useDefinitions();
  const { factTable } = useFullFactTable(step.source.factTableId || null);
  const selectedFactTable = getFactTableById(step.source.factTableId);
  const unsupportedUserIdTypes = selectedFactTable
    ? userIdTypes.filter((t) => !selectedFactTable.userIdTypes.includes(t))
    : [];

  const factTableOptions = useMemo(
    () =>
      factTables
        .filter(
          (ft) =>
            ft.id === step.source.factTableId ||
            (ft.datasource === datasource &&
              userIdTypes.every((t) => ft.userIdTypes.includes(t))),
        )
        .map((ft) => ({ label: ft.name, value: ft.id })),
    [factTables, datasource, userIdTypes, step.source.factTableId],
  );

  const update = (updates: Partial<PopulationStep>) =>
    onChange({ ...step, ...updates });

  return (
    <Box
      style={{
        border: "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-3)",
      }}
    >
      <Flex
        align="center"
        gap="2"
        wrap="wrap"
        px="3"
        py="2"
        style={{
          background: "var(--gray-a2)",
          borderBottom: "1px solid var(--gray-a5)",
          borderRadius: "var(--radius-3) var(--radius-3) 0 0",
        }}
      >
        <Text size="sm">Has a row in</Text>
        <Box flexGrow="1" minWidth="200px">
          <SelectField
            size="small"
            aria-label="Fact table"
            value={step.source.factTableId}
            onChange={(factTableId) =>
              update({
                source: { type: "factTable", factTableId },
                rowFilters: [],
                aggregateFilter: undefined,
                aggregateFilterColumn: undefined,
              })
            }
            options={factTableOptions}
            placeholder="Choose a fact table..."
            noOptionsMessage={() =>
              "No fact tables in this Data Source support every selected identifier type"
            }
            error={
              selectedFactTable && unsupportedUserIdTypes.length
                ? `${selectedFactTable.name} doesn't support ${unsupportedUserIdTypes.join(", ")}. Choose another fact table or change the identifier types.`
                : undefined
            }
          />
        </Box>
      </Flex>

      <Grid columns="64px 1fr" gapX="3" gapY="3" align="center" p="3">
        {factTable && step.rowFilters.length > 0 && (
          <StepRow label="where" alignTop>
            <Flex direction="column" gap="2">
              <RowFilterEditorRows
                value={step.rowFilters}
                setValue={(rowFilters) => update({ rowFilters })}
                columnSource={factTableToColumnSource(factTable)}
                dateInputWidth={220}
              />
            </Flex>
          </StepRow>
        )}

        {step.aggregateFilterColumn !== undefined && (
          <StepRow label="with">
            <AggregateFilterInput
              factTable={factTable}
              column={step.aggregateFilterColumn}
              filter={step.aggregateFilter ?? ""}
              unit={userIdTypes.join(", ") || "unit"}
              onChange={(aggregateFilterColumn, aggregateFilter) =>
                update({ aggregateFilterColumn, aggregateFilter })
              }
              onRemove={() =>
                update({
                  aggregateFilterColumn: undefined,
                  aggregateFilter: undefined,
                })
              }
            />
          </StepRow>
        )}

        <Box />
        <Flex gap="3">
          <Button
            size="sm"
            variant="ghost"
            icon={<PiPlus size={14} />}
            disabled={!factTable}
            onClick={() =>
              update({
                rowFilters: [...step.rowFilters, emptyColumnRowFilter()],
              })
            }
          >
            Row filter
          </Button>
          {step.aggregateFilterColumn === undefined && (
            <Button
              size="sm"
              variant="ghost"
              icon={<PiPlus size={14} />}
              disabled={!factTable}
              onClick={() =>
                update({
                  aggregateFilterColumn: "$$count",
                  aggregateFilter: DEFAULT_AGGREGATE_FILTER,
                })
              }
            >
              Aggregate filter
            </Button>
          )}
        </Flex>
      </Grid>
    </Box>
  );
}

function StepRow({
  label,
  alignTop = false,
  children,
}: {
  label: string;
  alignTop?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <Box
        style={{ alignSelf: alignTop ? "start" : undefined }}
        pt={alignTop ? "2" : undefined}
      >
        <Text size="sm" color="text-mid">
          {label}
        </Text>
      </Box>
      <Box minWidth="0">{children}</Box>
    </>
  );
}

function AggregateFilterInput({
  factTable,
  column,
  filter,
  unit,
  onChange,
  onRemove,
}: {
  factTable: Omit<FactTableInterface, "sql"> | null;
  column: string;
  filter: string;
  unit: string;
  onChange: (column: string, filter: string) => void;
  onRemove: () => void;
}) {
  const parsedAggregateFilter = parseAggregateFilterForEditor(filter);

  const columnOptions = useMemo(
    () => [
      { label: "Count of rows", value: "$$count" },
      ...(factTable?.columns ?? [])
        .filter(
          (col) =>
            col.datatype === "number" &&
            !col.deleted &&
            col.column !== "timestamp" &&
            !factTable?.userIdTypes.includes(col.column),
        )
        .map((col) => ({ label: `Sum of ${col.name}`, value: col.column })),
      ...(column &&
      column !== "$$count" &&
      !factTable?.columns.some((col) => col.column === column)
        ? [{ label: `Sum of ${column}`, value: column }]
        : []),
    ],
    [factTable, column],
  );

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Box minWidth="160px">
        <SelectField
          size="small"
          aria-label="Aggregate column"
          value={column}
          onChange={(v) => onChange(v, filter)}
          options={columnOptions}
          sort={false}
        />
      </Box>
      {!parsedAggregateFilter ? (
        <TextField
          size="sm"
          value={filter}
          onChange={(e) => onChange(column, e.target.value)}
          placeholder=">=3,<10"
          aria-label="Aggregate filter"
          style={{ width: 120 }}
        />
      ) : (
        <>
          <Select
            size="sm"
            aria-label="Aggregate operator"
            value={parsedAggregateFilter.operator}
            setValue={(op) =>
              onChange(column, `${op}${parsedAggregateFilter.value}`)
            }
          >
            {POPULATION_AGGREGATE_OPERATORS.map((o) => (
              <SelectItem key={o.operator} value={o.operator}>
                {capitalizeFirstLetter(o.label)}
              </SelectItem>
            ))}
          </Select>
          <TextField
            size="sm"
            type="number"
            min={0}
            value={parsedAggregateFilter.value}
            onChange={(e) =>
              onChange(
                column,
                `${parsedAggregateFilter.operator}${e.target.value}`,
              )
            }
            aria-label="Aggregate filter value"
            style={{ width: 80 }}
          />
        </>
      )}
      <Text size="sm" color="text-mid">
        per {unit}
      </Text>
      <IconButton
        variant="ghost"
        color="gray"
        size={radixSize("sm")}
        aria-label="Remove aggregate filter"
        onClick={onRemove}
      >
        <PiX />
      </IconButton>
    </Flex>
  );
}
