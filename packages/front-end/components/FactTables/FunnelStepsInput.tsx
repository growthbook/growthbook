import { useEffect, useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import {
  ConversionWindow,
  FunnelSettings,
  FunnelStep,
} from "shared/types/fact-table";
import { MAX_FUNNEL_STEPS } from "shared/funnels";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import useFullFactTable from "@/hooks/useFullFactTable";
import { getInitialInlineFilters } from "@/services/metrics";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Avatar from "@/ui/Avatar";
import TextField from "@/ui/TextField";
import {
  RowFilterInput,
  SampleRowsButton,
} from "@/components/FactTables/RowFilterInput";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import { updateFunnelSteps } from "./funnelStepUpdates";
import styles from "./FunnelStepsInput.module.scss";

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
  inheritTable,
  setInheritTable,
  updateStep,
  removeStep,
}: {
  step: FunnelStep;
  index: number;
  factTableOptions: { label: string; value: string }[];
  disableFactTableSelector: boolean;
  inheritTable: boolean;
  setInheritTable: (inherit: boolean) => void;
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
      <Flex justify="between" align="center" gap="3" mb="3">
        <Flex align="center" gap="2" minWidth="0" flexGrow="1">
          <Avatar size="sm">{index + 1}</Avatar>
          <TextField
            aria-label={`Step ${index + 1} name`}
            placeholder={`Step ${index + 1}`}
            value={step.name}
            onChange={(e) => updateStep(index, { name: e.target.value })}
            required
            className={styles.stepName}
            containerClassName={styles.stepNameContainer}
          />
        </Flex>
        <Flex align="center" gap="3" flexShrink="0">
          {fullFactTable && (
            <SampleRowsButton
              factTable={fullFactTable}
              value={step.rowFilters || []}
              setValue={(rowFilters) => updateStep(index, { rowFilters })}
            />
          )}
          <Button
            variant="ghost"
            color="gray"
            aria-label={`Remove step ${index + 1}`}
            onClick={() => removeStep(index)}
          >
            <PiX />
          </Button>
        </Flex>
      </Flex>

      <Flex>
        <Box width="100%">
          {index > 0 && (
            <Box mb="3">
              <Checkbox
                label="Keep fact table from previous step"
                value={inheritTable}
                setValue={(checked) => setInheritTable(checked === true)}
              />
            </Box>
          )}
          {!inheritTable && (
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
                      {label}
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
              placeholder="Select a fact table"
              required
            />
          )}
        </Box>
      </Flex>

      {step.factTableId && (
        <>
          {fullFactTable && (
            <Box mb="3">
              <RowFilterInput
                hideSampleRows
                factTable={fullFactTable}
                value={step.rowFilters || []}
                setValue={(rowFilters) => updateStep(index, { rowFilters })}
              />
            </Box>
          )}

          <details className={styles.behavior}>
            <summary>Step behavior</summary>
            <Box mt="3" mb="3">
              <Checkbox
                label="Optional step"
                description="Users can skip this step without breaking the funnel."
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
          </details>
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
  allowChangingDatasource = false,
}: {
  value: FunnelSettings;
  setValue: (v: FunnelSettings) => void;
  datasource: string;
  project?: string;
  initialFactTable?: string;
  allowChangingDatasource?: boolean;
}) {
  const { factTables, getFactTableById } = useDefinitions();
  const overriddenTables = useRef(
    new Set(
      value.steps.flatMap((step, index) =>
        index > 0 &&
        step.factTableId &&
        step.factTableId !== value.steps[index - 1]?.factTableId
          ? [index]
          : [],
      ),
    ),
  );

  const initializedFilterTables = useRef<string[]>([]);
  useEffect(() => {
    let changed = false;
    const steps = value.steps.map((step, index) => {
      const table = getFactTableById(step.factTableId);
      if (!table || initializedFilterTables.current[index] === table.id)
        return step;
      initializedFilterTables.current[index] = table.id;
      const rowFilters = getInitialInlineFilters(table, step.rowFilters);
      if (rowFilters.length === (step.rowFilters?.length ?? 0)) return step;
      changed = true;
      return { ...step, rowFilters };
    });
    if (changed) setValue({ ...value, steps });
  }, [value, getFactTableById, setValue]);

  // Only callers that synchronize datasource from steps can choose across sources.
  const committedFactTable = value.steps
    .map((s) => getFactTableById(s.factTableId))
    .find((ft) => !!ft);
  const hasCommitted = !!committedFactTable;
  const effectiveDatasource = allowChangingDatasource
    ? (committedFactTable?.datasource ?? datasource)
    : datasource;

  // Clear steps whose fact table no longer belongs to the metric's data source.
  useEffect(() => {
    if (!hasCommitted) return;
    const isStale = (step: FunnelStep) => {
      const factTable = getFactTableById(step.factTableId);
      return !!factTable && factTable.datasource !== effectiveDatasource;
    };
    if (!value.steps.some(isStale)) return;

    setValue({
      ...value,
      steps: value.steps.map((step) =>
        isStale(step) ? { ...step, factTableId: "", rowFilters: [] } : step,
      ),
    });
  }, [effectiveDatasource, hasCommitted, getFactTableById, setValue, value]);

  const factTableOptions = factTables
    .filter(
      (t) =>
        (allowChangingDatasource && !hasCommitted) ||
        t.datasource === effectiveDatasource,
    )
    .filter((t) => isProjectListValidForProject(t.projects, project))
    .map((t) => ({
      label: t.name,
      value: t.id,
    }));

  const initialFilters = (id: string) => {
    const table = getFactTableById(id);
    return table ? getInitialInlineFilters(table) : [];
  };

  const updateStep = (index: number, updates: Partial<FunnelStep>) => {
    const result = updateFunnelSteps(
      value.steps,
      index,
      updates,
      overriddenTables.current,
      initialFilters,
    );
    overriddenTables.current = result.overriddenTables;
    setValue({ ...value, steps: result.steps });
  };

  const removeStep = (index: number) => {
    overriddenTables.current = new Set(
      [...overriddenTables.current]
        .filter((i) => i !== index)
        .map((i) => (i > index ? i - 1 : i)),
    );
    overriddenTables.current.delete(0);
    const steps = value.steps
      .map((step, i) => ({ step, originalIndex: i }))
      .filter(({ originalIndex }) => originalIndex !== index)
      .map(({ step, originalIndex }, i) => ({
        ...step,
        name:
          step.name === `Step ${originalIndex + 1}`
            ? `Step ${i + 1}`
            : step.name,
      }));
    setValue({
      ...value,
      steps: updateFunnelSteps(
        steps,
        0,
        {},
        overriddenTables.current,
        initialFilters,
      ).steps,
    });
  };

  const addStep = () => {
    const previousFactTableId =
      value.steps.at(-1)?.factTableId || initialFactTable || "";
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
          // When created from a fact table, step 1 stays anchored to it.
          disableFactTableSelector={i === 0 && !!initialFactTable}
          inheritTable={i > 0 && !overriddenTables.current.has(i)}
          setInheritTable={(inherit) => {
            if (inherit) overriddenTables.current.delete(i);
            else overriddenTables.current.add(i);
            updateStep(i, {});
          }}
          updateStep={updateStep}
          removeStep={removeStep}
        />
      ))}

      <Box>
        <Button
          variant="ghost"
          disabled={value.steps.length >= MAX_FUNNEL_STEPS}
          onClick={addStep}
        >
          <PiPlus /> Add a step
        </Button>
      </Box>
    </Flex>
  );
}
