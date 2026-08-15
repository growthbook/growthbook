import React, { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import type { ExplorationConfig, JourneyDataset } from "shared/validators";
import { MAX_JOURNEY_STEP_COLUMNS } from "shared/validators";
import { applyStepGroups, stepGroupsForColumn } from "shared/journeys";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import RadioGroup from "@/ui/RadioGroup";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  getColumnTopValues,
  getDefaultJourneyStepColumns,
  getInitialInlineFilters,
  withStepGroupsApplied,
} from "@/enterprise/components/ProductAnalytics/util";
import { factTableToColumnSource } from "./ExplorerFilterRow";
import { ExplorerRowFilterInput } from "./ExplorerRowFilterInput";
import JourneyStepGroups from "./JourneyStepGroups";

function withoutStepColumnFilters(
  rowFilters: JourneyDataset["rowFilters"],
  stepColumns: string[],
): JourneyDataset["rowFilters"] {
  const cols = new Set(stepColumns.filter(Boolean));
  if (cols.size === 0) return rowFilters;
  return rowFilters.filter((rf) => !rf.column || !cols.has(rf.column));
}

function patchJourney(
  prev: ExplorationConfig,
  patch:
    | Partial<JourneyDataset>
    | ((dataset: JourneyDataset) => JourneyDataset),
): ExplorationConfig {
  if (prev.dataset.type !== "journey") return prev;
  const nextDataset =
    typeof patch === "function"
      ? patch(prev.dataset)
      : { ...prev.dataset, ...patch };
  return {
    ...prev,
    dataset: nextDataset,
  } as ExplorationConfig;
}

export default function JourneyTabContent() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const { factTables, getFactTableById, project } = useDefinitions();
  const { permissionsUtil } = useUser();

  const dataset =
    draftExploreState.dataset?.type === "journey"
      ? draftExploreState.dataset
      : null;

  const factTable = dataset?.factTableId
    ? getFactTableById(dataset.factTableId)
    : null;

  const stepColumnOptions = useMemo(() => {
    if (!factTable) return [];
    const userIdTypes = new Set(factTable.userIdTypes ?? []);
    const options: { label: string; value: string }[] = [];
    for (const c of factTable.columns ?? []) {
      if (c.deleted || userIdTypes.has(c.column)) continue;
      if (c.datatype === "string") {
        options.push({ label: c.name || c.column, value: c.column });
      }
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [factTable]);

  const columnSource = useMemo(
    () => (factTable ? factTableToColumnSource(factTable) : null),
    [factTable],
  );

  const stepColumnSamples = useMemo(() => {
    const samples: Record<string, string[]> = {};
    if (!dataset) return samples;
    for (const column of dataset.stepColumns.filter(Boolean)) {
      samples[column] = getColumnTopValues(
        dataset,
        column,
        getFactTableById,
        () => null,
      );
    }
    return samples;
  }, [dataset, getFactTableById]);

  if (!dataset) return null;

  const canRun =
    permissionsUtil.canRunFactQueries({ projects: [project] }) ||
    permissionsUtil.canRunFactQueries({ projects: [] });

  const stepColumns =
    dataset.stepColumns.length > 0 ? dataset.stepColumns : [""];
  const unitOptions = factTable?.userIdTypes ?? [];

  const groupedOptionValues = (column: string): string[] => {
    const rules = stepGroupsForColumn(dataset.stepGroups, column);
    return Array.from(
      new Set(
        (stepColumnSamples[column] ?? []).map((v) => applyStepGroups(v, rules)),
      ),
    );
  };

  const excludedOptions = dataset.stepColumns[0]
    ? groupedOptionValues(dataset.stepColumns[0]).map((v) => ({
        label: v,
        value: v,
      }))
    : [];

  return (
    <Flex
      direction="column"
      gap="4"
      p="3"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex direction="column" gap="2">
        <Text weight="medium">Fact Table</Text>
        <SelectField
          value={dataset.factTableId ?? ""}
          disabled={!canRun}
          onChange={(factTableId) => {
            const ft = factTableId ? getFactTableById(factTableId) : null;
            const stepColumns = ft ? getDefaultJourneyStepColumns(ft) : [];
            setDraftExploreState((prev) =>
              patchJourney(prev, {
                factTableId: factTableId || null,
                unit: ft?.userIdTypes?.[0] ?? null,
                stepColumns,
                anchorStepValues: null,
                excludedSteps: [],
                path: [],
                rowFilters: ft
                  ? getInitialInlineFilters(ft, [], stepColumns)
                  : [],
              }),
            );
          }}
          options={factTables
            .filter((f) => f.datasource === draftExploreState.datasource)
            .map((ft) => ({
              label: ft.name,
              value: ft.id,
            }))}
          placeholder="Select fact table..."
          forceUndefinedValueToNull
        />
      </Flex>

      {factTable && (
        <>
          <Flex direction="column" gap="2">
            <Text weight="medium">Unit</Text>
            <SelectField
              value={dataset.unit ?? ""}
              onChange={(unit) =>
                setDraftExploreState((prev) =>
                  patchJourney(prev, { unit: unit || null, path: [] }),
                )
              }
              options={unitOptions.map((u) => ({ label: u, value: u }))}
              placeholder="Select unit..."
              forceUndefinedValueToNull
            />
            <Checkbox
              label="Daily journeys"
              description="Treat each calendar day as a separate journey for the same unit"
              value={dataset.dailyJourneys}
              setValue={(dailyJourneys) =>
                setDraftExploreState((prev) =>
                  patchJourney(prev, { dailyJourneys, path: [] }),
                )
              }
            />
          </Flex>

          <Flex direction="column" gap="2">
            <Text weight="medium">Step columns</Text>
            {stepColumns.map((col, i) => (
              <Flex key={i} align="center" gap="2" width="100%">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SelectField
                    value={col}
                    onChange={(next) => {
                      setDraftExploreState((prev) =>
                        patchJourney(prev, (current) => {
                          const nextCols = [
                            ...(current.stepColumns.length
                              ? current.stepColumns
                              : [""]),
                          ];
                          nextCols[i] = next;
                          const nextAnchor = current.anchorStepValues
                            ? [...current.anchorStepValues]
                            : nextCols.map(() => "");
                          while (nextAnchor.length < nextCols.length)
                            nextAnchor.push("");
                          nextAnchor[i] = "";
                          return {
                            ...current,
                            stepColumns: nextCols.filter(Boolean).length
                              ? nextCols
                              : [],
                            anchorStepValues: nextAnchor.every((v) => !v)
                              ? null
                              : nextAnchor,
                            path: [],
                            excludedSteps: i === 0 ? [] : current.excludedSteps,
                            rowFilters: withoutStepColumnFilters(
                              current.rowFilters,
                              nextCols,
                            ),
                          };
                        }),
                      );
                    }}
                    options={stepColumnOptions}
                    placeholder={`Column ${i + 1}`}
                    forceUndefinedValueToNull
                  />
                </div>
                {stepColumns.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDraftExploreState((prev) =>
                        patchJourney(prev, (current) => {
                          const nextCols = current.stepColumns.filter(
                            (_, idx) => idx !== i,
                          );
                          const nextAnchor = (
                            current.anchorStepValues ?? []
                          ).filter((_, idx) => idx !== i);
                          return {
                            ...current,
                            stepColumns: nextCols,
                            anchorStepValues:
                              nextAnchor.length === 0 ? null : nextAnchor,
                            path: [],
                            excludedSteps: i === 0 ? [] : current.excludedSteps,
                            rowFilters: withoutStepColumnFilters(
                              current.rowFilters,
                              nextCols,
                            ),
                          };
                        }),
                      );
                    }}
                    title="Remove column"
                  >
                    <PiX size={14} />
                  </Button>
                )}
              </Flex>
            ))}
            {stepColumns.length < MAX_JOURNEY_STEP_COLUMNS &&
              dataset.stepColumns.every(Boolean) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraftExploreState((prev) =>
                      patchJourney(prev, (current) => ({
                        ...current,
                        stepColumns: [...current.stepColumns, ""],
                        anchorStepValues: [
                          ...(current.anchorStepValues ??
                            current.stepColumns.map(() => "")),
                          "",
                        ],
                        path: [],
                      })),
                    );
                  }}
                >
                  <Flex align="center" gap="1">
                    <PiPlus size={14} />
                    Add column
                  </Flex>
                </Button>
              )}
          </Flex>

          <JourneyStepGroups
            dataset={dataset}
            disabled={!canRun}
            samples={stepColumnSamples}
            columnLabel={(column) =>
              stepColumnOptions.find((o) => o.value === column)?.label ?? column
            }
            onChange={(stepGroups) =>
              setDraftExploreState((prev) =>
                patchJourney(prev, (current) =>
                  withStepGroupsApplied(current, stepGroups),
                ),
              )
            }
          />

          <Flex direction="column" gap="2">
            <Text weight="medium">Direction</Text>
            <RadioGroup
              value={dataset.direction}
              setValue={(v) =>
                setDraftExploreState((prev) =>
                  patchJourney(prev, {
                    direction: v as JourneyDataset["direction"],
                    path: [],
                  }),
                )
              }
              options={[
                {
                  value: "forward",
                  label: "Forward",
                  description: "What people do after the starting step",
                },
                {
                  value: "backward",
                  label: "Backward",
                  description: "What people did before the ending step",
                },
              ]}
            />
          </Flex>

          {dataset.stepColumns.some(Boolean) && (
            <Flex direction="column" gap="2">
              <Text weight="medium">
                {dataset.direction === "backward"
                  ? "Ending step"
                  : "Starting step"}
              </Text>
              {dataset.stepColumns.map((col, i) => {
                if (!col) return null;
                const topValues = groupedOptionValues(col);
                return (
                  <SelectField
                    key={`${col}-${i}`}
                    label={
                      stepColumnOptions.find((o) => o.value === col)?.label ??
                      col
                    }
                    value={dataset.anchorStepValues?.[i] ?? ""}
                    onChange={(value) => {
                      setDraftExploreState((prev) =>
                        patchJourney(prev, (current) => {
                          const next = current.anchorStepValues
                            ? [...current.anchorStepValues]
                            : current.stepColumns.map(() => "");
                          while (next.length < current.stepColumns.length) {
                            next.push("");
                          }
                          next[i] = value;
                          return {
                            ...current,
                            anchorStepValues: next,
                            path: [],
                          };
                        }),
                      );
                    }}
                    options={topValues.map((v) => ({ label: v, value: v }))}
                    placeholder={
                      dataset.direction === "backward"
                        ? "Select ending value..."
                        : "Select starting value..."
                    }
                    forceUndefinedValueToNull
                    createable
                    keepCreatableWhenEmpty
                  />
                );
              })}
            </Flex>
          )}

          {dataset.stepColumns[0] && (
            <Flex direction="column" gap="2">
              <Text weight="medium">Excluded steps</Text>
              <MultiSelectField
                value={dataset.excludedSteps}
                onChange={(excludedSteps) =>
                  setDraftExploreState((prev) =>
                    patchJourney(prev, { excludedSteps, path: [] }),
                  )
                }
                options={excludedOptions}
                placeholder="Values of the first step column to drop"
                creatable
              />
            </Flex>
          )}

          <Checkbox
            label="Collapse consecutive repeats"
            value={dataset.collapseRepeats}
            setValue={(collapseRepeats) =>
              setDraftExploreState((prev) =>
                patchJourney(prev, { collapseRepeats, path: [] }),
              )
            }
          />

          {columnSource && (
            <>
              <ExplorerRowFilterInput
                value={dataset.rowFilters}
                setValue={(rowFilters) =>
                  setDraftExploreState((prev) =>
                    patchJourney(prev, { rowFilters, path: [] }),
                  )
                }
                columnSource={columnSource}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraftExploreState((prev) =>
                    patchJourney(prev, (current) => ({
                      ...current,
                      rowFilters: [
                        ...current.rowFilters,
                        { column: "", operator: "=", values: [] },
                      ],
                      path: [],
                    })),
                  )
                }
              >
                <Flex align="center" gap="2">
                  <PiPlus size={14} />
                  Add Filter
                </Flex>
              </Button>
            </>
          )}
        </>
      )}
    </Flex>
  );
}
