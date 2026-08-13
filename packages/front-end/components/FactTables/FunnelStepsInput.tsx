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

function FunnelStepInput({
  step,
  index,
  factTableOptions,
  disableFactTableSelector,
  canRemove,
  updateStep,
  removeStep,
}: {
  step: FunnelStep;
  index: number;
  factTableOptions: { label: string; value: string }[];
  disableFactTableSelector: boolean;
  canRemove: boolean;
  updateStep: (index: number, updates: Partial<FunnelStep>) => void;
  removeStep: (index: number) => void;
}) {
  const { getFactTableById } = useDefinitions();
  const { factTable: fullFactTable } = useFullFactTable(step.factTableId);

  const setConversionWindow = (update: Partial<ConversionWindow> | null) => {
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
    <Box
      className="appbox"
      px="3"
      pt="3"
      style={{ backgroundColor: "var(--gray-a2)" }}
    >
      <Flex justify="between" align="center" mb="2">
        <Heading as="h4" size="sm" mb="0">
          Step {index + 1}
        </Heading>
        {canRemove && (
          <Button variant="ghost" color="red" onClick={() => removeStep(index)}>
            <PiX />
          </Button>
        )}
      </Flex>

      <Flex>
        <Box>
          <SelectField
            size="small"
            label="Fact Table"
            disabled={disableFactTableSelector}
            value={step.factTableId}
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

              // Repointing a step drops its filters, whose columns no longer
              // apply to the new table.
              updateStep(index, {
                factTableId,
                rowFilters: getInitialInlineFilters(newFactTable, []),
              });
            }}
            placeholder="Select..."
            required
          />
        </Box>
      </Flex>

      {step.factTableId && (
        <>
          <Field
            size="md"
            label="Step name"
            value={step.name}
            onChange={(e) => updateStep(index, { name: e.target.value })}
            required
          />

          {fullFactTable && (
            <Box mb="3">
              <RowFilterInput
                factTable={fullFactTable}
                value={step.rowFilters || []}
                setValue={(rowFilters) => updateStep(index, { rowFilters })}
              />
            </Box>
          )}

          <Box mt="2" mb="3">
            <Checkbox
              label="Optional step"
              value={step.optional}
              setValue={(v) => updateStep(index, { optional: v === true })}
            />
          </Box>

          <Box mb="3">
            <Checkbox
              label="Conversion window"
              description={
                step.conversionWindow
                  ? index === 0
                    ? "Maximum time after exposure to reach this step."
                    : "Must occur within this time of the nearest required prior step."
                  : undefined
              }
              value={!!step.conversionWindow}
              setValue={(v) =>
                setConversionWindow(
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
                    setConversionWindow({
                      value: Math.max(1, Number(e.currentTarget.value) || 1),
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
                    setConversionWindow({
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
  );
}

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

  // Steps can each read from a different fact table, but every one of them has
  // to belong to the metric's data source. Clear the ones that no longer do.
  useEffect(() => {
    const isStale = (step: FunnelStep) => {
      const factTable = getFactTableById(step.factTableId);
      return !!factTable && factTable.datasource !== datasource;
    };
    if (!value.steps.some(isStale)) return;

    setValue({
      ...value,
      steps: value.steps.map((step) =>
        isStale(step) ? { ...step, factTableId: "", rowFilters: [] } : step,
      ),
    });
  }, [datasource, getFactTableById, setValue, value]);

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

  const removeStep = (index: number) => {
    setValue({
      ...value,
      steps: value.steps.filter((_, i) => i !== index),
    });
  };

  const addStep = () => {
    // New steps continue from where the funnel left off, which is right far
    // more often than not, and can be repointed per step.
    const previousFactTableId =
      value.steps[value.steps.length - 1]?.factTableId || "";
    const previousFactTable = getFactTableById(previousFactTableId);

    setValue({
      ...value,
      steps: [
        ...value.steps,
        {
          name: `Step ${value.steps.length + 1}`,
          factTableId: previousFactTableId,
          rowFilters: previousFactTable
            ? getInitialInlineFilters(previousFactTable)
            : [],
          optional: false,
        },
      ],
    });
  };

  return (
    <Flex direction="column" gap="3">
      {value.steps.map((step, i) => (
        <FunnelStepInput
          key={i}
          step={step}
          index={i}
          factTableOptions={factTableOptions}
          // The metric is anchored to the fact table it was created from, so
          // only later steps can be repointed.
          disableFactTableSelector={i === 0 && !!initialFactTable}
          canRemove={value.steps.length > 1}
          updateStep={updateStep}
          removeStep={removeStep}
        />
      ))}

      <Box>
        <Button
          variant="ghost"
          disabled={value.steps.length >= MAX_FACT_METRIC_FUNNEL_STEPS}
          onClick={addStep}
        >
          <PiPlus /> Add a step
        </Button>
      </Box>
    </Flex>
  );
}
