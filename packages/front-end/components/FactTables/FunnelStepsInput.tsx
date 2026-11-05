import { useEffect, useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiDotsSixVertical, PiPlus } from "react-icons/pi";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ConversionWindow,
  FunnelSettings,
  FunnelStep,
  RowFilter,
} from "shared/types/fact-table";
import { reconcileInlineFilterPrompts } from "shared/experiments";
import { MAX_FUNNEL_STEPS } from "shared/funnels";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import useFullFactTable from "@/hooks/useFullFactTable";
import { getInitialInlineFilters } from "@/services/metrics";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import Switch from "@/ui/Switch";
import Button from "@/ui/Button";
import Avatar from "@/ui/Avatar";
import Frame from "@/ui/Frame";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import {
  RowFilterInput,
  SampleRowsButton,
} from "@/components/FactTables/RowFilterInput";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import useSortableItem from "@/hooks/useSortableItem";
import FunnelStepActionsMenu from "./FunnelStepActionsMenu";
import {
  insertFunnelStep,
  moveFunnelStep,
  updateFunnelSteps,
} from "./funnelStepUpdates";
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
  insertStep,
  canAddStep,
  sortableId,
}: {
  sortableId: string;
  insertStep: (atIndex: number) => void;
  canAddStep: boolean;
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
  const { setNodeRef, style, handle, transform } = useSortableItem(sortableId);
  // Step 1 is pinned: it's the metric's primary fact table.
  const pinned = index === 0;

  const setRowFilters = (rowFilters: RowFilter[]) => {
    updateStep(index, {
      rowFilters: fullFactTable
        ? reconcileInlineFilterPrompts(
            fullFactTable,
            step.rowFilters || [],
            rowFilters,
          )
        : rowFilters,
    });
  };

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
      ref={pinned ? undefined : setNodeRef}
      // Translate only: the default transform also scales to the hovered step,
      // which stretches/squishes steps of different heights.
      style={
        pinned
          ? undefined
          : { ...style, transform: CSS.Translate.toString(transform) }
      }
    >
      <Frame
        mb="0"
        px="3"
        py="0"
        pt="3"
        style={{ backgroundColor: "var(--gray-a2)" }}
      >
        <Flex justify="between" align="center" gap="3" mb="3">
          <Flex align="center" gap="2" minWidth="0" flexGrow="1">
            {/* Same-size spacer on the pinned step keeps the numbers aligned. */}
            {pinned ? (
              <Box aria-hidden style={{ width: 14, flexShrink: 0 }} />
            ) : (
              <Box
                {...handle}
                title="Drag to reorder"
                aria-label={`Drag to reorder ${step.name || `step ${index + 1}`}`}
                style={{ flexShrink: 0, cursor: "grab", display: "flex" }}
              >
                <PiDotsSixVertical size={14} color="var(--gray-a9)" />
              </Box>
            )}
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
                setValue={setRowFilters}
              />
            )}
            <FunnelStepActionsMenu
              rowFilters={step.rowFilters || []}
              // Step 1 is pinned (the metric's primary fact table): nothing above it.
              canInsertAbove={canAddStep && !pinned}
              canInsertBelow={canAddStep}
              canDelete
              onInsertAbove={() => insertStep(index)}
              onInsertBelow={() => insertStep(index + 1)}
              onDelete={() => removeStep(index)}
            />
          </Flex>
        </Flex>

        <Flex>
          <Box width="100%">
            {index > 0 && (
              <Box mb="3">
                <Switch
                  label="Keep fact table from previous step"
                  value={inheritTable}
                  onChange={setInheritTable}
                />
              </Box>
            )}
            {!inheritTable && (
              <Select
                label="Fact table"
                size="sm"
                mb="3"
                disabled={disableFactTableSelector}
                value={step.factTableId}
                placeholder="Select a fact table"
                setValue={(factTableId) => {
                  const newFactTable = getFactTableById(factTableId);
                  if (!newFactTable) return;

                  // Repointing a step drops its filters, whose columns no longer
                  // apply to the new table.
                  updateStep(index, {
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
                  setValue={setRowFilters}
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
                <Switch
                  label="Conversion window"
                  description={
                    step.conversionWindow
                      ? index === 0
                        ? "Maximum time after exposure to reach this step."
                        : "Must occur within this time of the nearest required prior step."
                      : undefined
                  }
                  value={!!step.conversionWindow}
                  onChange={(checked) =>
                    setConversionWindow(
                      checked ? { value: 1, unit: "days" } : null,
                    )
                  }
                />
                {/* pl matches the switch width + gap (28px + 8px) so the
                fields align with the description text above. */}
                {step.conversionWindow && (
                  <Flex align="center" gap="2" mt="2" pl="36px">
                    <Field
                      size="md"
                      aria-label="Conversion window length"
                      type="number"
                      min={1}
                      value={step.conversionWindow.value}
                      onChange={(e) =>
                        setConversionWindow({
                          value: Math.max(
                            1,
                            Number(e.currentTarget.value) || 1,
                          ),
                        })
                      }
                      containerStyle={{ marginBottom: 0, width: 80 }}
                    />
                    <SelectField
                      size="md"
                      aria-label="Conversion window unit"
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
      </Frame>
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
  const { factTables, getFactTableById, getDatasourceById } = useDefinitions();
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

  // Stable per-step ids for drag-and-drop; kept aligned with `value.steps`.
  const stepIds = useRef<string[]>([]);
  const nextStepId = useRef(0);
  while (stepIds.current.length < value.steps.length) {
    stepIds.current.push(`funnel-step-${nextStepId.current++}`);
  }
  stepIds.current.length = value.steps.length;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
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
      label:
        allowChangingDatasource && !hasCommitted
          ? `${t.name} (${getDatasourceById(t.datasource)?.name || t.datasource})`
          : t.name,
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
    stepIds.current.splice(index, 1);
    initializedFilterTables.current.splice(index, 1);
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

  const moveStep = (from: number, to: number) => {
    const result = moveFunnelStep(value.steps, from, to);
    if (!result) return;
    overriddenTables.current = result.overriddenTables;
    stepIds.current = arrayMove(stepIds.current, from, to);
    initializedFilterTables.current = arrayMove(
      initializedFilterTables.current,
      from,
      to,
    );
    setValue({ ...value, steps: result.steps });
  };

  // New steps inherit the fact table of the step above.
  const insertStep = (atIndex: number) => {
    const previousFactTableId =
      value.steps[atIndex - 1]?.factTableId || initialFactTable || "";
    const previousFactTable = getFactTableById(previousFactTableId);
    const result = insertFunnelStep(
      value.steps,
      atIndex,
      {
        name: `Step ${atIndex + 1}`,
        factTableId: previousFactTableId,
        rowFilters: previousFactTable
          ? getInitialInlineFilters(previousFactTable)
          : [],
        optional: false,
      },
      overriddenTables.current,
    );
    overriddenTables.current = result.overriddenTables;
    stepIds.current.splice(atIndex, 0, `funnel-step-${nextStepId.current++}`);
    initializedFilterTables.current.splice(atIndex, 0, previousFactTableId);
    setValue({ ...value, steps: result.steps });
  };

  return (
    <Flex direction="column" gap="3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (!over) return;
          moveStep(
            stepIds.current.indexOf(String(active.id)),
            stepIds.current.indexOf(String(over.id)),
          );
        }}
      >
        <SortableContext
          // Step 1 isn't sortable, so nothing can be dropped above it.
          items={stepIds.current.slice(1)}
          strategy={verticalListSortingStrategy}
        >
          {value.steps.map((step, i) => (
            <FunnelStepInput
              key={stepIds.current[i]}
              sortableId={stepIds.current[i]}
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
              insertStep={insertStep}
              canAddStep={value.steps.length < MAX_FUNNEL_STEPS}
            />
          ))}
        </SortableContext>
      </DndContext>

      <Box>
        <Button
          variant="ghost"
          disabled={value.steps.length >= MAX_FUNNEL_STEPS}
          onClick={() => insertStep(value.steps.length)}
        >
          <PiPlus /> Add a step
        </Button>
      </Box>
    </Flex>
  );
}
