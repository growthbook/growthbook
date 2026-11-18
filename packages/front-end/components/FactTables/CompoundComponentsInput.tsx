import { Fragment, useEffect, useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import {
  CompoundComponent,
  CompoundSettings,
  RowFilter,
} from "shared/types/fact-table";
import { reconcileInlineFilterPrompts } from "shared/experiments";
import { MAX_COMPOUND_COMPONENTS } from "shared/validators";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import useFullFactTable from "@/hooks/useFullFactTable";
import { getInitialInlineFilters } from "@/services/metrics";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import { Select, SelectItem } from "@/ui/Select";
import {
  RowFilterInput,
  SampleRowsButton,
} from "@/components/FactTables/RowFilterInput";
import { OfficialBadge } from "@/components/Metrics/MetricName";

// Components are joined by AND, in any order: the layout says so, so there
// are no step numbers, arrows or drag handles.
export function CompoundAndConnector() {
  return (
    <Flex justify="center">
      <Badge label="AND" color="violet" variant="soft" radius="full" />
    </Flex>
  );
}

function CompoundComponentInput({
  component,
  factTableOptions,
  canRemove,
  update,
  remove,
}: {
  component: CompoundComponent;
  factTableOptions: { label: string; value: string }[];
  canRemove: boolean;
  update: (updates: Partial<CompoundComponent>) => void;
  remove: () => void;
}) {
  const { getFactTableById } = useDefinitions();
  const { factTable } = useFullFactTable(component.factTableId || null);

  const setRowFilters = (rowFilters: RowFilter[]) =>
    update({
      rowFilters: factTable
        ? reconcileInlineFilterPrompts(
            factTable,
            component.rowFilters,
            rowFilters,
          )
        : rowFilters,
    });

  return (
    <Frame mb="0" px="3" py="3" style={{ backgroundColor: "var(--gray-a2)" }}>
      <Flex align="end" gap="3" mb={factTable ? "3" : "0"}>
        <Box flexGrow="1">
          <Select
            label="Fact table"
            size="sm"
            value={component.factTableId}
            placeholder="Select a fact table"
            setValue={(factTableId) => {
              const newFactTable = getFactTableById(factTableId);
              if (!newFactTable) return;
              // Filters reference the old table's columns.
              update({
                factTableId,
                rowFilters: getInitialInlineFilters(newFactTable, []),
              });
            }}
          >
            {factTableOptions.map(({ value: id, label }) => (
              <SelectItem key={id} value={id}>
                {label}
                <OfficialBadge
                  managedBy={getFactTableById(id)?.managedBy}
                  type="fact table"
                  usePortal
                />
              </SelectItem>
            ))}
          </Select>
        </Box>
        <Flex align="center" gap="3" flexShrink="0" pb="1">
          {factTable && (
            <SampleRowsButton
              factTable={factTable}
              value={component.rowFilters}
              setValue={setRowFilters}
            />
          )}
          <Button
            variant="ghost"
            color="gray"
            aria-label="Remove component"
            disabled={!canRemove}
            onClick={remove}
          >
            <PiX />
          </Button>
        </Flex>
      </Flex>
      {factTable && (
        <RowFilterInput
          hideSampleRows
          factTable={factTable}
          value={component.rowFilters}
          setValue={setRowFilters}
        />
      )}
    </Frame>
  );
}

export default function CompoundComponentsInput({
  value,
  setValue,
  datasource,
  project,
}: {
  value: CompoundSettings;
  setValue: (v: CompoundSettings) => void;
  datasource: string;
  project?: string;
}) {
  const { factTables, getFactTableById } = useDefinitions();

  // Seed inline filter prompts once per component table, like the funnel
  // and numerator editors do.
  const initializedFilterTables = useRef<string[]>([]);
  useEffect(() => {
    let changed = false;
    const components = value.components.map((component, i) => {
      const table = getFactTableById(component.factTableId);
      if (!table || initializedFilterTables.current[i] === table.id) {
        return component;
      }
      initializedFilterTables.current[i] = table.id;
      const rowFilters = getInitialInlineFilters(table, component.rowFilters);
      if (rowFilters.length === component.rowFilters.length) return component;
      changed = true;
      return { ...component, rowFilters };
    });
    if (changed) setValue({ components });
  }, [value, getFactTableById, setValue]);

  const factTableOptions = factTables
    .filter((t) => t.datasource === datasource)
    .filter((t) => isProjectListValidForProject(t.projects, project))
    .map((t) => ({ label: t.name, value: t.id }));

  const update = (index: number, updates: Partial<CompoundComponent>) =>
    setValue({
      components: value.components.map((c, i) =>
        i === index ? { ...c, ...updates } : c,
      ),
    });

  const remove = (index: number) => {
    initializedFilterTables.current.splice(index, 1);
    setValue({ components: value.components.filter((_, i) => i !== index) });
  };

  // A new card starts on the previous card's fact table.
  const add = () => {
    const factTableId = value.components.at(-1)?.factTableId ?? "";
    const factTable = getFactTableById(factTableId);
    setValue({
      components: [
        ...value.components,
        {
          factTableId,
          rowFilters: factTable ? getInitialInlineFilters(factTable) : [],
        },
      ],
    });
  };

  return (
    <Flex direction="column" gap="2">
      {value.components.map((component, i) => (
        <Fragment key={i}>
          {i > 0 && <CompoundAndConnector />}
          <CompoundComponentInput
            component={component}
            factTableOptions={factTableOptions}
            canRemove={value.components.length > 2}
            update={(updates) => update(i, updates)}
            remove={() => remove(i)}
          />
        </Fragment>
      ))}
      <Box>
        <Button
          variant="ghost"
          disabled={value.components.length >= MAX_COMPOUND_COMPONENTS}
          onClick={add}
        >
          <PiPlus /> Add component
        </Button>
      </Box>
    </Flex>
  );
}
