import { useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import {
  PiCaretDown,
  PiCaretRight,
  PiDotsThreeVertical,
  PiPlus,
  PiUserFill,
  PiX,
} from "react-icons/pi";
import type {
  ExplorationConfig,
  JourneyDataset,
  JourneyStepGroup,
} from "shared/validators";
import { MAX_JOURNEY_STEP_COLUMNS } from "shared/validators";
import {
  applyStepGroups,
  stepGroupsForColumn,
  suggestJourneyStepGroups,
} from "shared/journeys";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import SelectField from "@/components/Forms/SelectField";
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

function suggestedGroupsForColumns(
  columns: string[],
  samples: Record<string, string[]>,
): JourneyStepGroup[] {
  return columns.flatMap((column) =>
    suggestJourneyStepGroups(samples[column] ?? []).map((s) => ({
      column,
      pattern: s.pattern,
    })),
  );
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
    dataset: {
      ...nextDataset,
      dailyJourneys: true,
      collapseRepeats: true,
      excludedSteps: [],
    },
  } as ExplorationConfig;
}

export default function JourneyTabContent() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const { factTables, getFactTableById, project } = useDefinitions();
  const { permissionsUtil } = useUser();
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  const unitOptions = factTable?.userIdTypes ?? [];

  const groupedOptionValues = (column: string): string[] => {
    const rules = stepGroupsForColumn(dataset.stepGroups, column);
    return Array.from(
      new Set(
        (stepColumnSamples[column] ?? []).map((v) => applyStepGroups(v, rules)),
      ),
    );
  };

  const samplesForColumns = (
    columns: string[],
    factTableId: string | null,
  ): Record<string, string[]> => {
    const samples: Record<string, string[]> = {};
    const source: JourneyDataset = {
      ...dataset,
      factTableId,
    };
    for (const column of columns) {
      samples[column] = getColumnTopValues(
        source,
        column,
        getFactTableById,
        () => null,
      );
    }
    return samples;
  };

  const stepColumns =
    dataset.stepColumns.length > 0 ? dataset.stepColumns : [""];

  const commitStepColumns = (
    nextCols: string[],
    nextAnchor: string[] | null,
  ) => {
    setDraftExploreState((prev) =>
      patchJourney(prev, (current) => {
        const stored = nextCols.some(Boolean) ? nextCols : [];
        const prevFilled = current.stepColumns.filter(Boolean);
        const added = stored.filter((c) => c && !prevFilled.includes(c));
        const kept = (current.stepGroups ?? []).filter((g) =>
          stored.includes(g.column),
        );
        const samples = samplesForColumns(added, current.factTableId);
        const additions = suggestedGroupsForColumns(added, samples);
        const anchors = nextAnchor?.length
          ? nextAnchor.slice(0, stored.length)
          : null;
        return withStepGroupsApplied(
          {
            ...current,
            stepColumns: stored,
            anchorStepValues: anchors?.some(Boolean) ? anchors : null,
            path: [],
            rowFilters: withoutStepColumnFilters(current.rowFilters, stored),
          },
          [...kept, ...additions],
        );
      }),
    );
  };

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
            const samples = samplesForColumns(stepColumns, factTableId || null);
            const stepGroups = suggestedGroupsForColumns(stepColumns, samples);
            setDraftExploreState((prev) =>
              patchJourney(prev, {
                factTableId: factTableId || null,
                unit: ft?.userIdTypes?.[0] ?? null,
                stepColumns,
                stepGroups,
                anchorStepValues: null,
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
            <Flex justify="between" align="center">
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
              {unitOptions.length > 0 && (
                <DropdownMenu
                  open={unitDropdownOpen}
                  onOpenChange={setUnitDropdownOpen}
                  trigger={
                    <Button size="sm" variant="ghost">
                      <Flex align="center" gap="2">
                        <PiUserFill size={14} />
                        {dataset.unit ?? unitOptions[0]}
                      </Flex>
                    </Button>
                  }
                >
                  {unitOptions.map((u) => (
                    <DropdownMenuItem
                      key={u}
                      onClick={() => {
                        setDraftExploreState((prev) =>
                          patchJourney(prev, { unit: u || null, path: [] }),
                        );
                        setUnitDropdownOpen(false);
                      }}
                    >
                      <Text>{u}</Text>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
              )}
            </Flex>
          </>
        )}
      </Flex>

      {factTable && (
        <>
          <Flex direction="column" gap="2">
            <Text weight="medium">Steps defined by</Text>
            {stepColumns.map((col, i) => {
              return (
                <Flex key={i} align="center" gap="2" width="100%">
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <SelectField
                      containerClassName="mb-0"
                      value={col}
                      disabled={!canRun}
                      onChange={(next) => {
                        const nextCols = [...stepColumns];
                        nextCols[i] = next;
                        const nextAnchor = [
                          ...(dataset.anchorStepValues ??
                            stepColumns.map(() => "")),
                        ];
                        while (nextAnchor.length < nextCols.length) {
                          nextAnchor.push("");
                        }
                        nextAnchor[i] = "";
                        commitStepColumns(nextCols, nextAnchor);
                      }}
                      options={stepColumnOptions.filter(
                        (o) =>
                          o.value === col || !stepColumns.includes(o.value),
                      )}
                      placeholder="Select column..."
                      forceUndefinedValueToNull
                    />
                  </div>
                  {i === 0 && (
                    <DropdownMenu
                      menuPlacement="end"
                      disabled={!canRun}
                      trigger={
                        <span
                          aria-label="More"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 24,
                            height: 24,
                            pointerEvents: "auto",
                            cursor: canRun ? "pointer" : "not-allowed",
                          }}
                        >
                          <PiDotsThreeVertical size={16} />
                        </span>
                      }
                      triggerStyle={{
                        padding: 0,
                        margin: 0,
                        background: "transparent",
                        boxShadow: "none",
                        lineHeight: 0,
                      }}
                    >
                      <DropdownMenuItem
                        disabled={
                          stepColumns.length >= MAX_JOURNEY_STEP_COLUMNS
                        }
                        onClick={() => {
                          commitStepColumns(
                            [...stepColumns, ""],
                            [
                              ...(dataset.anchorStepValues ??
                                stepColumns.map(() => "")),
                              "",
                            ],
                          );
                        }}
                      >
                        Add column
                      </DropdownMenuItem>
                    </DropdownMenu>
                  )}
                  {i > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Remove column"
                      disabled={!canRun}
                      style={{ padding: 0, minWidth: 20 }}
                      onClick={() => {
                        commitStepColumns(
                          stepColumns.filter((_, idx) => idx !== i),
                          (dataset.anchorStepValues ?? []).filter(
                            (_, idx) => idx !== i,
                          ),
                        );
                      }}
                    >
                      <PiX size={14} />
                    </Button>
                  )}
                </Flex>
              );
            })}
          </Flex>

          {dataset.stepColumns.some(Boolean) && (
            <Flex direction="column" gap="2">
              <Text weight="medium">Show journeys</Text>
              <Flex wrap="wrap" align="center" gap="2">
                <div style={{ flex: "0 0 154px", width: 154, minWidth: 0 }}>
                  <SelectField
                    containerClassName="mb-0"
                    containerStyle={{ width: "100%" }}
                    value={dataset.direction}
                    sort={false}
                    onChange={(v) =>
                      setDraftExploreState((prev) =>
                        patchJourney(prev, {
                          direction: v as JourneyDataset["direction"],
                          path: [],
                        }),
                      )
                    }
                    options={[
                      { label: "Starting with", value: "forward" },
                      { label: "Ending with", value: "backward" },
                    ]}
                  />
                </div>
                {dataset.stepColumns.filter(Boolean).map((col, i) => {
                  const topValues = groupedOptionValues(col);
                  return (
                    <div
                      key={`${col}-${i}`}
                      style={{
                        flex: "1 1 0%",
                        minWidth: 120,
                      }}
                    >
                      <SelectField
                        containerClassName="mb-0"
                        containerStyle={{ width: "100%" }}
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
                        options={topValues.map((v) => ({
                          label: v,
                          value: v,
                        }))}
                        placeholder={`Choose ${
                          stepColumnOptions.find((o) => o.value === col)
                            ?.label ?? col
                        }...`}
                        forceUndefinedValueToNull
                        createable
                        keepCreatableWhenEmpty
                      />
                    </div>
                  );
                })}
              </Flex>
            </Flex>
          )}

          {dataset.stepColumns.some(Boolean) && (
            <Flex direction="column" gap="2">
              <Flex direction="row">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdvancedOpen((p) => !p)}
                >
                  <Flex direction="row" gap="2" align="center">
                    {advancedOpen ? (
                      <PiCaretDown size={14} />
                    ) : (
                      <PiCaretRight size={14} />
                    )}
                    <Text size="sm" weight="medium">
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
                  <JourneyStepGroups
                    dataset={dataset}
                    disabled={!canRun}
                    samples={stepColumnSamples}
                    columnLabel={(column) =>
                      stepColumnOptions.find((o) => o.value === column)
                        ?.label ?? column
                    }
                    onChange={(stepGroups) =>
                      setDraftExploreState((prev) =>
                        patchJourney(prev, (current) =>
                          withStepGroupsApplied(current, stepGroups),
                        ),
                      )
                    }
                  />
                </Flex>
              </Collapsible>
            </Flex>
          )}
        </>
      )}
    </Flex>
  );
}
