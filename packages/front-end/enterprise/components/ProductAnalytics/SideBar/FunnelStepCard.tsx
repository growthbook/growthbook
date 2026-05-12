import React, { useMemo, useState } from "react";
import { Box, Flex, TextField } from "@radix-ui/themes";
import {
  PiArrowDown,
  PiArrowUp,
  PiCaretDown,
  PiCaretUp,
  PiPencilSimple,
  PiPlus,
  PiX,
} from "react-icons/pi";
import Collapsible from "react-collapsible";
import { z } from "zod";
import {
  ExplorationConfig,
  FunnelDataset,
  FunnelStep,
  conversionWindowValidator,
  rowFilterValidator,
} from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import { factTableToColumnSource } from "./ExplorerFilterRow";
import { ExplorerRowFilterInput } from "./ExplorerRowFilterInput";
import styles from "./ValueCard.module.scss";

type RowFilter = z.infer<typeof rowFilterValidator>;
type ConversionWindow = z.infer<typeof conversionWindowValidator>;

const CONVERSION_WINDOW_UNITS: ConversionWindow["unit"][] = [
  "minutes",
  "hours",
  "days",
  "weeks",
];

/** Replaces the funnel step at `index` in the draft state. */
function updateStep(
  prev: ExplorationConfig,
  index: number,
  updater: (step: FunnelStep) => FunnelStep,
): ExplorationConfig {
  if (prev.dataset.type !== "funnel") return prev;
  const steps = prev.dataset.steps.map((s, i) =>
    i === index ? updater(s) : s,
  );
  return {
    ...prev,
    dataset: { ...prev.dataset, steps } as FunnelDataset,
  } as ExplorationConfig;
}

/** Removes the funnel step at `index`. */
function deleteStep(prev: ExplorationConfig, index: number): ExplorationConfig {
  if (prev.dataset.type !== "funnel") return prev;
  return {
    ...prev,
    dataset: {
      ...prev.dataset,
      steps: prev.dataset.steps.filter((_, i) => i !== index),
    } as FunnelDataset,
  } as ExplorationConfig;
}

/** Swaps the funnel step at `index` with the step at `index + delta`. */
function moveStep(
  prev: ExplorationConfig,
  index: number,
  delta: number,
): ExplorationConfig {
  if (prev.dataset.type !== "funnel") return prev;
  const target = index + delta;
  if (target < 0 || target >= prev.dataset.steps.length) return prev;
  const steps = [...prev.dataset.steps];
  [steps[index], steps[target]] = [steps[target], steps[index]];
  return {
    ...prev,
    dataset: { ...prev.dataset, steps } as FunnelDataset,
  } as ExplorationConfig;
}

interface Props {
  index: number;
  step: FunnelStep;
  steps: FunnelStep[];
  /** Fact table id of the previous step (used to derive the "inherited" state). */
  previousFactTable: string | null;
}

export default function FunnelStepCard({
  index,
  step,
  steps,
  previousFactTable,
}: Props) {
  const { setDraftExploreState, draftExploreState } = useExplorerContext();
  const { factTables, getFactTableById } = useDefinitions();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(step.name);
  const [isCollapsed, setIsCollapsed] = useState(false);
  // For follow-on steps: when the step inherits, we hide the picker until the
  // user clicks "Override". Once they're overriding (or the step was loaded
  // with an override already), we show the picker inline.
  const isInherited = index > 0 && step.factTable === previousFactTable;
  const [overrideOpen, setOverrideOpen] = useState(!isInherited);

  // Keep the local override state in sync if the step's relationship to its
  // predecessor changes (e.g., after a reorder or a previous-step change).
  React.useEffect(() => {
    setOverrideOpen(!isInherited || index === 0);
  }, [isInherited, index]);

  const factTable = step.factTable ? getFactTableById(step.factTable) : null;
  const availableFactTables = useMemo(
    () =>
      factTables.filter((ft) => ft.datasource === draftExploreState.datasource),
    [factTables, draftExploreState.datasource],
  );

  const columnSource = useMemo(
    () => (factTable ? factTableToColumnSource(factTable) : null),
    [factTable],
  );

  const handleFiltersChange = (filters: RowFilter[]) => {
    setDraftExploreState((prev) =>
      updateStep(prev, index, (s) => ({ ...s, rowFilters: filters })),
    );
  };

  const handleFactTableChange = (newFactTableId: string) => {
    setDraftExploreState((prev) =>
      updateStep(prev, index, (s) => {
        // Drop filters whose columns aren't on the new fact table (mirrors
        // the metric/fact-table behavior for column-scoped filters).
        const newFt = newFactTableId ? getFactTableById(newFactTableId) : null;
        const newColumns = new Set((newFt?.columns ?? []).map((c) => c.column));
        const cleanedFilters = s.rowFilters.filter((f) => {
          if (f.operator === "sql_expr" || f.operator === "saved_filter") {
            return true;
          }
          return !f.column || newColumns.has(f.column);
        });
        return { ...s, factTable: newFactTableId, rowFilters: cleanedFilters };
      }),
    );
  };

  const commitName = () => {
    const trimmed = nameDraft.trim();
    setDraftExploreState((prev) =>
      updateStep(prev, index, (s) => ({
        ...s,
        name: trimmed || s.name,
      })),
    );
    setIsEditingName(false);
  };

  const handleConversionWindowChange = (
    update: Partial<ConversionWindow> | null,
  ) => {
    setDraftExploreState((prev) =>
      updateStep(prev, index, (s) => {
        if (update === null) {
          return { ...s, conversionWindow: null };
        }
        const merged = {
          unit: update.unit ?? s.conversionWindow?.unit ?? "days",
          value: update.value ?? s.conversionWindow?.value ?? 1,
        } as ConversionWindow;
        return { ...s, conversionWindow: merged };
      }),
    );
  };

  return (
    <Box
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-3)",
        padding: "var(--space-3)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex justify="between" align="center">
        <Flex
          align="center"
          gap="2"
          className={styles.titleGroup}
          style={{ minWidth: 0, flex: 1 }}
        >
          <Box style={{ flexShrink: 0 }}>
            <Text size="small" color="text-low">
              {index + 1}.
            </Text>
          </Box>
          {isEditingName ? (
            <TextField.Root
              size="1"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") {
                  setNameDraft(step.name);
                  setIsEditingName(false);
                }
              }}
              autoFocus
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : (
            <>
              <Box style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <Text
                  weight="medium"
                  truncate
                  as="div"
                  whiteSpace="nowrap"
                  title={step.name}
                >
                  {step.name}
                </Text>
              </Box>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setNameDraft(step.name);
                  setIsEditingName(true);
                }}
                title="Edit name"
              >
                <PiPencilSimple size={14} />
              </Button>
            </>
          )}
        </Flex>
        <Flex align="center" style={{ flexShrink: 0 }}>
          <Button
            variant="ghost"
            size="xs"
            disabled={index === 0}
            onClick={() =>
              setDraftExploreState((prev) => moveStep(prev, index, -1))
            }
            title="Move up"
          >
            <PiArrowUp size={14} />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={index === steps.length - 1}
            onClick={() =>
              setDraftExploreState((prev) => moveStep(prev, index, 1))
            }
            title="Move down"
          >
            <PiArrowDown size={14} />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setIsCollapsed((p) => !p)}
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <PiCaretDown size={14} /> : <PiCaretUp size={14} />}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={steps.length === 1}
            onClick={() =>
              setDraftExploreState((prev) => deleteStep(prev, index))
            }
            title="Delete step"
          >
            <PiX size={14} />
          </Button>
        </Flex>
      </Flex>
      <Collapsible
        open={!isCollapsed}
        trigger=""
        triggerDisabled
        transitionTime={100}
      >
        <Box mt="2">
          {/* Fact-table picker / inheritance row */}
          {index === 0 || overrideOpen ? (
            <Flex direction="column" gap="2">
              <Text weight="medium" mt="2">
                Fact Table
              </Text>
              <SelectField
                value={step.factTable}
                onChange={handleFactTableChange}
                options={availableFactTables.map((ft) => ({
                  label: ft.name,
                  value: ft.id,
                }))}
                placeholder="Select fact table..."
                forceUndefinedValueToNull
              />
              {index > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    if (previousFactTable) {
                      handleFactTableChange(previousFactTable);
                    }
                    setOverrideOpen(false);
                  }}
                  disabled={!previousFactTable}
                  title="Reset to inherit from the previous step"
                >
                  Reset to inherited
                </Button>
              )}
            </Flex>
          ) : (
            <Tooltip body="Inherits from the previous step. Click to override.">
              <Flex align="center" gap="2" py="2" style={{ minWidth: 0 }}>
                <Text size="small" color="text-low">
                  Fact table:
                </Text>
                <Text size="small" weight="medium" truncate>
                  {factTable?.name ?? step.factTable ?? "(inherited)"}
                </Text>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setOverrideOpen(true)}
                  title="Override fact table"
                >
                  <PiPencilSimple size={14} />
                </Button>
              </Flex>
            </Tooltip>
          )}

          {/* Filters */}
          {columnSource && (
            <Box mt="2">
              <ExplorerRowFilterInput
                columnSource={columnSource}
                value={step.rowFilters}
                setValue={handleFiltersChange}
              />
              <Flex justify="start" align="center" mt="2">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    handleFiltersChange([
                      ...step.rowFilters,
                      { column: "", operator: "=", values: [] },
                    ]);
                  }}
                >
                  <Flex align="center" gap="2">
                    <PiPlus size={14} />
                    Add Filter
                  </Flex>
                </Button>
              </Flex>
            </Box>
          )}

          {/* Follow-on step controls: optional + conversion window */}
          {index > 0 && (
            <Flex direction="column" gap="2" mt="3">
              <Checkbox
                label="Optional step"
                value={step.optional}
                setValue={(value) =>
                  setDraftExploreState((prev) =>
                    updateStep(prev, index, (s) => ({
                      ...s,
                      optional: !!value,
                    })),
                  )
                }
                description="Users who skip this step can still convert to later steps."
              />
              <Text weight="medium" mt="1">
                Conversion window
              </Text>
              {step.conversionWindow ? (
                <Flex align="center" gap="2">
                  <Field
                    type="number"
                    min={1}
                    value={step.conversionWindow.value}
                    onChange={(e) =>
                      handleConversionWindowChange({
                        value: Math.max(1, Number(e.currentTarget.value) || 1),
                      })
                    }
                    containerStyle={{ marginBottom: 0, width: 80 }}
                  />
                  <SelectField
                    value={step.conversionWindow.unit}
                    onChange={(unit) =>
                      handleConversionWindowChange({
                        unit: unit as ConversionWindow["unit"],
                      })
                    }
                    options={CONVERSION_WINDOW_UNITS.map((u) => ({
                      label: u,
                      value: u,
                    }))}
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleConversionWindowChange(null)}
                    title="Remove conversion window"
                  >
                    Clear
                  </Button>
                </Flex>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    handleConversionWindowChange({ value: 1, unit: "days" })
                  }
                >
                  <Flex align="center" gap="2">
                    <PiPlus size={14} /> Set conversion window
                  </Flex>
                </Button>
              )}
            </Flex>
          )}
        </Box>
      </Collapsible>
    </Box>
  );
}
