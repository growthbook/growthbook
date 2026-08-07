import { Box, Flex } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import { FunnelSettings, FunnelStep } from "shared/types/fact-table";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import useFullFactTable from "@/hooks/useFullFactTable";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import { OfficialBadge } from "@/components/Metrics/MetricName";

export default function FunnelStepsInput({
  value,
  setValue,
  datasource,
  project,
}: {
  value: FunnelSettings;
  setValue: (v: FunnelSettings) => void;
  datasource: string;
  project?: string;
}) {
  const { factTables, getFactTableById } = useDefinitions();

  // v1 constraint: every step reads from one shared fact table.
  const sharedFactTableId = value.steps[0]?.factTableId || "";
  const { factTable: fullFactTable } = useFullFactTable(sharedFactTableId);

  const factTableOptions = factTables
    .filter((t) => t.datasource === datasource)
    .filter((t) => isProjectListValidForProject(t.projects, project))
    .map((t) => ({ label: t.name, value: t.id }));

  const updateStep = (index: number, updates: Partial<FunnelStep>) => {
    setValue({
      ...value,
      steps: value.steps.map((s, i) =>
        i === index ? { ...s, ...updates } : s,
      ),
    });
  };

  return (
    <Flex direction="column" gap="3">
      {value.steps.map((step, i) => (
        <Box key={i} className="appbox" p="3" mb="0">
          <Flex justify="between" align="center" mb="2">
            <Heading as="h4" size="sm" mb="0">
              Step {i + 1}
            </Heading>
            {value.steps.length > 2 && (
              <Button
                variant="ghost"
                color="red"
                onClick={() =>
                  setValue({
                    ...value,
                    steps: value.steps.filter((_, idx) => idx !== i),
                  })
                }
              >
                <PiX />
              </Button>
            )}
          </Flex>

          <Field
            label="Step name"
            value={step.name}
            onChange={(e) => updateStep(i, { name: e.target.value })}
            required
          />

          <SelectField
            label="Fact Table"
            value={step.factTableId}
            disabled={i > 0}
            options={factTableOptions}
            formatOptionLabel={({ value: id, label }) => {
              const factTable = getFactTableById(id);
              if (factTable) {
                return (
                  <>
                    {factTable.name}
                    <OfficialBadge
                      managedBy={factTable.managedBy}
                      type="fact table"
                    />
                  </>
                );
              }
              return label;
            }}
            onChange={(factTableId) =>
              // Changing the shared fact table repoints every step and clears
              // their filters, whose columns no longer apply.
              setValue({
                ...value,
                steps: value.steps.map((s) => ({
                  ...s,
                  factTableId,
                  rowFilters: [],
                })),
              })
            }
            placeholder="Select..."
            required
          />

          {fullFactTable && (
            <Box mt="2">
              <Text as="label" size="sm" weight="semibold">
                Included rows
              </Text>
              <RowFilterInput
                factTable={fullFactTable}
                value={step.rowFilters || []}
                setValue={(rowFilters) => updateStep(i, { rowFilters })}
              />
            </Box>
          )}

          {i > 0 && (
            <Box mt="2">
              <Checkbox
                label="Optional step"
                value={step.optional}
                setValue={(v) => updateStep(i, { optional: v === true })}
              />
            </Box>
          )}
        </Box>
      ))}

      <Box>
        <Button
          variant="ghost"
          onClick={() =>
            setValue({
              ...value,
              steps: [
                ...value.steps,
                {
                  name: `Step ${value.steps.length + 1}`,
                  factTableId: sharedFactTableId,
                  rowFilters: [],
                  optional: false,
                },
              ],
            })
          }
        >
          <PiPlus /> Add a step
        </Button>
      </Box>
    </Flex>
  );
}
