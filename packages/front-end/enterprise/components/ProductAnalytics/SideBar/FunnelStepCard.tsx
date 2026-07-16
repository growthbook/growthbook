import React, { useMemo, useState } from "react";
import { Box, Flex, TextField } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretRight,
  PiCaretUp,
  PiPencilSimple,
  PiPlus,
  PiUserFill,
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
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import {
  getFunnelStepPreview,
  getInitialInlineFilters,
} from "@/enterprise/components/ProductAnalytics/util";
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

interface Props {
  index: number;
  step: FunnelStep;
  steps: FunnelStep[];
  /** Fact table id of the previous step (used to derive the "inherited" state). */
  previousFactTable: string | null;
  /** Controlled collapse state — owned by FunnelTabContent so it can
   *  auto-collapse non-user-expanded steps when a new step is added. */
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  /** Delete handler lives in the parent so it can keep the per-step
   *  collapse state aligned with the underlying steps array. */
  onDelete: (index: number) => void;
  /** Intersection of user id types across all steps; step 1 shows the unit
   *  picker beside Add Filter when non-empty. */
  funnelUnitOptions: string[];
  /** `react-collapsible` duration (ms). Use `0` for programmatic batch collapses. */
  collapsibleTransitionMs?: number;
}

export default function FunnelStepCard({
  index,
  step,
  steps,
  previousFactTable,
  isCollapsed,
  onToggleCollapsed,
  onDelete,
  funnelUnitOptions,
  collapsibleTransitionMs = 100,
}: Props) {
  const { setDraftExploreState, draftExploreState } = useExplorerContext();
  const { factTables, getFactTableById } = useDefinitions();

  const [isEditingName, setIsEditingName] = useState(false);
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(step.name);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
        // Pre-seed alwaysInlineFilter columns from the new fact table so the
        // user is prompted to fill them in before the funnel can run.
        const seededFilters = newFt
          ? getInitialInlineFilters(newFt, cleanedFilters)
          : cleanedFilters;
        return { ...s, factTable: newFactTableId, rowFilters: seededFilters };
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

  const handleStartNameEdit = () => {
    setNameDraft(step.name);
    setIsEditingName(true);
  };

  // Collapsed-mode subline: fact-table label (when the step is the first or
  // an override) plus up to 2 filter previews, joined by " · " on one line.
  // Passing the full steps array lets the helper strip universal
  // column+operator prefixes so e.g. `event_name=` doesn't repeat on every
  // collapsed card when every step filters on it.
  const collapsedSubline = useMemo(
    () =>
      getFunnelStepPreview({
        step,
        factTable,
        showFactTable: index === 0 || !isInherited,
        allSteps: steps,
      }),
    [step, factTable, isInherited, index, steps],
  );

  const funnelUnit =
    draftExploreState.dataset.type === "funnel"
      ? draftExploreState.dataset.unit
      : null;

  const showFunnelUnitOnFilterRow = index === 0 && funnelUnitOptions.length > 0;

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
              <Box
                style={{ flex: 1, minWidth: 0, overflow: "hidden" }}
                onDoubleClick={handleStartNameEdit}
              >
                <Text
                  weight="medium"
                  truncate
                  as="div"
                  whiteSpace="nowrap"
                  title="Double-click to rename"
                >
                  {step.name}
                </Text>
              </Box>
              <Button
                className={styles.editBtn}
                variant="ghost"
                size="xs"
                onClick={handleStartNameEdit}
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
            onClick={onToggleCollapsed}
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <PiCaretDown size={14} /> : <PiCaretUp size={14} />}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={steps.length === 1}
            onClick={() => onDelete(index)}
            title="Delete step"
          >
            <PiX size={14} />
          </Button>
        </Flex>
      </Flex>
      {isCollapsed && collapsedSubline && (
        <Box
          mt="1"
          onClick={onToggleCollapsed}
          style={{ minWidth: 0, cursor: "pointer" }}
          title="Expand step"
        >
          <Text
            size="small"
            color="text-low"
            truncate
            whiteSpace="nowrap"
            as="div"
          >
            {collapsedSubline}
          </Text>
        </Box>
      )}
      <Collapsible
        open={!isCollapsed}
        trigger=""
        triggerDisabled
        transitionTime={collapsibleTransitionMs}
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
              <Flex
                justify={showFunnelUnitOnFilterRow ? "between" : "start"}
                align="center"
                mt="2"
              >
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
                {showFunnelUnitOnFilterRow && (
                  <DropdownMenu
                    open={unitDropdownOpen}
                    onOpenChange={setUnitDropdownOpen}
                    trigger={
                      <Button size="xs" variant="ghost">
                        <Flex align="center" gap="2">
                          <PiUserFill size={14} />
                          {funnelUnit ?? funnelUnitOptions[0]}
                        </Flex>
                      </Button>
                    }
                  >
                    {funnelUnitOptions.map((u) => (
                      <DropdownMenuItem
                        key={u}
                        onClick={() => {
                          setDraftExploreState((prev) => {
                            if (prev.dataset.type !== "funnel") return prev;
                            return {
                              ...prev,
                              dataset: { ...prev.dataset, unit: u },
                            } as ExplorationConfig;
                          });
                          setUnitDropdownOpen(false);
                        }}
                      >
                        <Text>{u}</Text>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenu>
                )}
              </Flex>
            </Box>
          )}

          {/* Follow-on step controls (Optional + conversion window) live
              under an "Advanced Options" disclosure to keep the step card
              lean — matches the Group By section's advanced-settings UX. */}
          {index > 0 && (
            <Flex direction="column" gap="2" mt="3">
              <Flex direction="row">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setAdvancedOpen((p) => !p)}
                >
                  <Flex direction="row" gap="2" align="center">
                    {advancedOpen ? (
                      <PiCaretDown size={14} />
                    ) : (
                      <PiCaretRight size={14} />
                    )}
                    <Text size="small" weight="medium">
                      Advanced Options
                    </Text>
                  </Flex>
                </Button>
              </Flex>
              <Collapsible
                transitionTime={100}
                open={advancedOpen}
                trigger=""
                triggerDisabled
              >
                <Flex direction="column" gap="2" mt="1">
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
                            value: Math.max(
                              1,
                              Number(e.currentTarget.value) || 1,
                            ),
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
                        handleConversionWindowChange({
                          value: 1,
                          unit: "days",
                        })
                      }
                    >
                      <Flex align="center" gap="2">
                        <PiPlus size={14} /> Set conversion window
                      </Flex>
                    </Button>
                  )}
                </Flex>
              </Collapsible>
            </Flex>
          )}
        </Box>
      </Collapsible>
    </Box>
  );
}
