import { ReactNode, useMemo, useState } from "react";
import {
  Box,
  Flex,
  Grid,
  IconButton,
  SegmentedControl,
} from "@radix-ui/themes";
import { PiArrowDown, PiArrowUp, PiPlus, PiTrash, PiX } from "react-icons/pi";
import type { PopulationStep } from "shared/validators";
import type { FactTableInterface } from "shared/types/fact-table";
import {
  getPopulationStepAnchorIndex,
  parseSingleAggregateFilter,
  POPULATION_AGGREGATE_OPERATORS,
} from "shared/populations";
import Badge from "@/ui/Badge";
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

type WindowSettings = PopulationStep["windowSettings"];

const WINDOW_UNITS: { value: WindowSettings["windowUnit"]; label: string }[] = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
];

const DEFAULT_AGGREGATE_FILTER = ">=2";

export default function PopulationStepCard({
  steps,
  index,
  datasource,
  userIdTypes,
  onChange,
  onMove,
  onRemove,
}: {
  steps: PopulationStep[];
  index: number;
  datasource: string;
  userIdTypes: string[];
  onChange: (step: PopulationStep) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const step = steps[index];
  const isFirst = index === 0;
  const { factTables } = useDefinitions();
  const { factTable } = useFullFactTable(step.source.factTableId || null);

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
        <Badge label={`Step ${index + 1}`} color="violet" variant="soft" />
        {isFirst ? (
          <Text size="sm">Has</Text>
        ) : (
          <SegmentedControl.Root
            size={radixSize("sm")}
            value={step.negation ? "doesNotHave" : "has"}
            onValueChange={(v) => update({ negation: v === "doesNotHave" })}
            aria-label={`Step ${index + 1} match type`}
          >
            <SegmentedControl.Item value="has">Has</SegmentedControl.Item>
            <SegmentedControl.Item value="doesNotHave">
              Doesn&apos;t have
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        )}
        <Text size="sm">a row in</Text>
        <Box flexGrow="1" minWidth="200px">
          <SelectField
            size="small"
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
              "No fact tables in this Data Source support the identifier type"
            }
          />
        </Box>
        <Flex gap="1">
          <IconButton
            variant="ghost"
            color="gray"
            size={radixSize("sm")}
            aria-label="Move step up"
            disabled={isFirst}
            onClick={() => onMove(index - 1)}
          >
            <PiArrowUp />
          </IconButton>
          <IconButton
            variant="ghost"
            color="gray"
            size={radixSize("sm")}
            aria-label="Move step down"
            disabled={index === steps.length - 1}
            onClick={() => onMove(index + 1)}
          >
            <PiArrowDown />
          </IconButton>
          <IconButton
            variant="ghost"
            color="gray"
            size={radixSize("sm")}
            aria-label="Delete step"
            disabled={steps.length === 1}
            onClick={onRemove}
          >
            <PiTrash />
          </IconButton>
        </Flex>
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
          <StepRow label="having">
            <AggregateFilterInput
              factTable={factTable}
              column={step.aggregateFilterColumn}
              filter={step.aggregateFilter ?? ""}
              unit={userIdTypes[0] ?? "unit"}
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

        <StepRow label="when">
          <WindowInput
            steps={steps}
            index={index}
            value={step.windowSettings}
            onChange={(windowSettings) => update({ windowSettings })}
          />
        </StepRow>

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
  // Ranges such as ">=3,<10" can't be shown as one operator and value, so
  // they stay editable as the raw filter text.
  const [raw] = useState(
    () => !!filter && parseSingleAggregateFilter(filter) === null,
  );
  const parsed = parseSingleAggregateFilter(filter);
  const [operator, setOperator] = useState(parsed?.operator ?? ">=");
  const [value, setValue] = useState(parsed?.value ?? "");

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
        ? [{ label: column, value: column }]
        : []),
    ],
    [factTable, column],
  );

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Box minWidth="160px">
        <SelectField
          size="small"
          value={column}
          onChange={(v) => onChange(v, filter)}
          options={columnOptions}
          sort={false}
        />
      </Box>
      {raw ? (
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
            value={operator}
            setValue={(op) => {
              setOperator(op);
              onChange(column, `${op}${value}`);
            }}
          >
            {POPULATION_AGGREGATE_OPERATORS.map((o) => (
              <SelectItem key={o.operator} value={o.operator}>
                {o.label}
              </SelectItem>
            ))}
          </Select>
          <TextField
            size="sm"
            type="number"
            min={0}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              onChange(column, `${operator}${e.target.value}`);
            }}
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

function WindowInput({
  steps,
  index,
  value,
  onChange,
}: {
  steps: PopulationStep[];
  index: number;
  value: WindowSettings;
  onChange: (value: WindowSettings) => void;
}) {
  const anchorIndex = getPopulationStepAnchorIndex(steps, index);

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Select
        size="sm"
        value={value.type || "any"}
        setValue={(v) => {
          const type = v === "any" ? "" : (v as WindowSettings["type"]);
          onChange({
            ...value,
            type,
            windowValue: type ? value.windowValue || 7 : 0,
          });
        }}
      >
        <SelectItem value="any">at any time</SelectItem>
        {anchorIndex !== null && (
          <SelectItem value="conversion">within</SelectItem>
        )}
        <SelectItem value="lookback">in the last</SelectItem>
      </Select>
      {value.type && (
        <>
          <TextField
            size="sm"
            type="number"
            min={1}
            value={value.windowValue || ""}
            onChange={(e) =>
              onChange({ ...value, windowValue: Number(e.target.value) })
            }
            aria-label="Window length"
            style={{ width: 72 }}
          />
          <Select
            size="sm"
            value={value.windowUnit}
            setValue={(windowUnit) =>
              onChange({
                ...value,
                windowUnit: windowUnit as WindowSettings["windowUnit"],
              })
            }
          >
            {WINDOW_UNITS.map((u) => (
              <SelectItem key={u.value} value={u.value}>
                {u.label}
              </SelectItem>
            ))}
          </Select>
          {value.type === "conversion" && anchorIndex !== null && (
            <Text size="sm" color="text-mid">
              after step {anchorIndex + 1}
            </Text>
          )}
        </>
      )}
    </Flex>
  );
}
