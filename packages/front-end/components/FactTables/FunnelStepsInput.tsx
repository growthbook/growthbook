import { useEffect } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import {
  ConversionWindow,
  FunnelSettings,
  FunnelStep,
} from "shared/types/fact-table";
import { MAX_FACT_METRIC_FUNNEL_STEPS } from "shared/validators";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import useFullFactTable from "@/hooks/useFullFactTable";
import { getInitialInlineFilters } from "@/services/metrics";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import { OfficialBadge } from "@/components/Metrics/MetricName";

const CONVERSION_WINDOW_UNITS: ConversionWindow["unit"][] = [
  "minutes",
  "hours",
  "days",
  "weeks",
];

export default function FunnelStepsInput({
  value,
  setValue,
  datasource,
  project,
  initialFactTable,
}: {
  value: FunnelSettings;
  setValue: (v: FunnelSettings) => void;
  datasource: string;
  project?: string;
  initialFactTable?: string;
}) {
  const { factTables, getFactTableById } = useDefinitions();

  // v1 constraint: every step reads from one shared fact table, chosen once in
  // the top-level selector and written to every step.
  const sharedFactTableId = value.steps[0]?.factTableId || "";
  const sharedFactTable = getFactTableById(sharedFactTableId);
  const { factTable: fullFactTable } = useFullFactTable(sharedFactTableId);

  useEffect(() => {
    if (!sharedFactTable || sharedFactTable.datasource === datasource) return;

    setValue({
      ...value,
      steps: value.steps.map((step) => ({
        ...step,
        factTableId: "",
        rowFilters: [],
      })),
    });
  }, [datasource, setValue, sharedFactTable, value]);

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

  const setConversionWindow = (
    index: number,
    update: Partial<ConversionWindow> | null,
  ) => {
    const step = value.steps[index];
    if (update === null) {
      updateStep(index, { conversionWindow: null });
      return;
    }
    updateStep(index, {
      conversionWindow: {
        unit: update.unit ?? step.conversionWindow?.unit ?? "days",
        value: update.value ?? step.conversionWindow?.value ?? 1,
      },
    });
  };

  return (
    <Flex direction="column" gap="3">
      {value.steps.map((step, i) => (
        <Box
          key={i}
          className="appbox"
          px="3"
          pt="3"
          style={{ backgroundColor: "var(--gray-2)" }}
        >
          <Flex justify="between" align="center" mb="2">
            <Heading as="h4" size="sm" mb="0">
              Step {i + 1}
            </Heading>
            {value.steps.length > 1 && (
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

          {/* v1 constraint: all steps read from one shared fact table. Step 1
              owns the picker; later steps show it disabled and inherit that
              choice. */}
          <Flex>
            <Box>
              <SelectField
                size="small"
                label="Fact Table"
                disabled={i !== 0 || !!initialFactTable}
                value={sharedFactTableId}
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
                onChange={(factTableId) => {
                  const newFactTable = getFactTableById(factTableId);
                  if (!newFactTable) return;

                  // Repointing Step 1's fact table repoints every step and drops
                  // each step's filters, whose columns no longer apply.
                  setValue({
                    ...value,
                    steps: value.steps.map((s) => ({
                      ...s,
                      factTableId,
                      rowFilters: getInitialInlineFilters(newFactTable, []),
                    })),
                  });
                }}
                placeholder="Select..."
                required
              />
            </Box>
          </Flex>

          {sharedFactTableId && (
            <>
              <Field
                size="md"
                label="Step name"
                value={step.name}
                onChange={(e) => updateStep(i, { name: e.target.value })}
                required
              />

              {fullFactTable && (
                <Box mb="3">
                  <RowFilterInput
                    factTable={fullFactTable}
                    value={step.rowFilters || []}
                    setValue={(rowFilters) => updateStep(i, { rowFilters })}
                  />
                </Box>
              )}

              <Box mt="2" mb="3">
                <Checkbox
                  label="Optional step"
                  value={step.optional}
                  setValue={(v) => updateStep(i, { optional: v === true })}
                />
              </Box>

              <Box mb="3">
                <Checkbox
                  label="Conversion window"
                  description={
                    step.conversionWindow
                      ? i === 0
                        ? "Maximum time after exposure to reach this step."
                        : "Must occur within this time of the nearest required prior step."
                      : undefined
                  }
                  value={!!step.conversionWindow}
                  setValue={(v) =>
                    setConversionWindow(
                      i,
                      v === true ? { value: 1, unit: "days" } : null,
                    )
                  }
                />
                {/* pl matches the checkbox width + gap so the fields align
                    with the description text above. */}
                {step.conversionWindow && (
                  <Flex align="center" gap="2" mt="2" pl="5">
                    <Field
                      size="md"
                      type="number"
                      min={1}
                      value={step.conversionWindow.value}
                      onChange={(e) =>
                        setConversionWindow(i, {
                          value: Math.max(
                            1,
                            Number(e.currentTarget.value) || 1,
                          ),
                        })
                      }
                      containerStyle={{ marginBottom: 0, width: 80 }}
                    />
                    <SelectField
                      size="small"
                      value={step.conversionWindow.unit}
                      options={CONVERSION_WINDOW_UNITS.map((u) => ({
                        label: u,
                        value: u,
                      }))}
                      onChange={(unit) =>
                        setConversionWindow(i, {
                          unit: unit as ConversionWindow["unit"],
                        })
                      }
                    />
                  </Flex>
                )}
              </Box>
            </>
          )}
        </Box>
      ))}

      <Box>
        <Button
          variant="ghost"
          disabled={value.steps.length >= MAX_FACT_METRIC_FUNNEL_STEPS}
          onClick={() =>
            setValue({
              ...value,
              steps: [
                ...value.steps,
                {
                  name: `Step ${value.steps.length + 1}`,
                  factTableId: sharedFactTableId,
                  rowFilters: sharedFactTable
                    ? getInitialInlineFilters(sharedFactTable)
                    : [],
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
