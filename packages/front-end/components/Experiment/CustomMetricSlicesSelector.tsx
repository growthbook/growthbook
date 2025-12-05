import React, { useState, useMemo } from "react";
import { FaTimes, FaPlusCircle } from "react-icons/fa";
import {
  PiPencilSimpleFill,
  PiX,
  PiStackBold,
  PiArrowSquareOut,
} from "react-icons/pi";
import { Text, Flex, IconButton } from "@radix-ui/themes";
import {
  isFactMetric,
  generatePinnedSliceKey,
  expandMetricGroups,
  SliceLevelsData,
} from "shared/experiments";
import { FactMetricInterface } from "back-end/types/fact-table";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { CustomMetricSlice } from "shared/src/validators/experiments";
import Badge from "@/ui/Badge";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import { DocLink } from "../DocLink";

interface MetricWithStringColumns extends FactMetricInterface {
  stringColumns: Array<{
    column: string;
    name: string;
    datatype?: string;
    isAutoSliceColumn?: boolean;
    autoSlices?: string[];
    topValues?: string[];
  }>;
}

export interface CustomMetricSlicesSelectorProps {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  customMetricSlices: CustomMetricSlice[];
  setCustomMetricSlices: (slices: CustomMetricSlice[]) => void;
  pinnedMetricSlices: string[];
  setPinnedMetricSlices: (slices: string[]) => void;
}

export default function CustomMetricSlicesSelector({
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  customMetricSlices,
  setCustomMetricSlices,
  pinnedMetricSlices,
  setPinnedMetricSlices,
}: CustomMetricSlicesSelectorProps) {
  const growthbook = useGrowthBook();
  const hasMetricSlicesFeature = growthbook?.isOn("metric-slices");

  const { hasCommercialFeature } = useUser();

  const [editState, setEditState] = useState<"adding" | "editing" | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingSliceLevels, setEditingSliceLevels] = useState<
    SliceLevelsData[]
  >([]);
  const [addingSlice, setAddingSlice] = useState(false);

  const { factMetrics, metricGroups, factTables } = useDefinitions();
  const expandedGoalMetrics = useMemo(
    () => expandMetricGroups(goalMetrics, metricGroups),
    [goalMetrics, metricGroups],
  );
  const expandedSecondaryMetrics = useMemo(
    () => expandMetricGroups(secondaryMetrics, metricGroups),
    [secondaryMetrics, metricGroups],
  );
  const expandedGuardrailMetrics = useMemo(
    () => expandMetricGroups(guardrailMetrics, metricGroups),
    [guardrailMetrics, metricGroups],
  );

  const allMetricIds = useMemo(() => {
    const rawMetricIds = [
      ...expandedGoalMetrics,
      ...expandedSecondaryMetrics,
      ...expandedGuardrailMetrics,
    ];
    return [...new Set(rawMetricIds)];
  }, [expandedGoalMetrics, expandedSecondaryMetrics, expandedGuardrailMetrics]);

  const metricsWithStringColumns = useMemo(() => {
    const factTableMap = new Map(factTables.map((table) => [table.id, table]));

    const applicableMetrics = allMetricIds
      .map((id) => factMetrics.find((m) => m.id === id))
      .filter((metric) => {
        const factTable = metric
          ? factTableMap.get(metric.numerator?.factTableId)
          : null;
        const hasColumns = !!factTable?.columns;
        return !!metric && isFactMetric(metric) && hasColumns;
      })
      .map((metric) => {
        const factTable = factTableMap.get(metric!.numerator?.factTableId);
        const stringColumns = factTable?.columns?.filter(
          (col) =>
            (col.datatype === "string" || col.datatype === "boolean") &&
            !col.deleted &&
            !factTable.userIdTypes.includes(col.column),
        );
        return {
          ...metric!,
          stringColumns:
            stringColumns?.map((col) => ({
              column: col.column,
              name: col.name || col.column,
              datatype: col.datatype,
              isAutoSliceColumn: col.isAutoSliceColumn,
              autoSlices: col.autoSlices,
              topValues: col.topValues,
            })) || [],
        };
      });

    return applicableMetrics.filter(
      (metric) => metric.stringColumns.length > 0,
    );
  }, [allMetricIds, factMetrics, factTables]);

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setEditState(index === -1 ? "adding" : "editing");
    if (index === -1) {
      // Adding new entry - start with empty slice-level pair
      setEditingSliceLevels([]);
      setAddingSlice(true);
    } else {
      // Editing existing entry
      const levels = customMetricSlices[index];
      setEditingSliceLevels(
        levels.slices.map((s) => {
          // Look up datatype from metricsWithStringColumns
          const columnMetadata = metricsWithStringColumns
            .flatMap((metric) => metric.stringColumns || [])
            .find((col) => col.column === s.column);

          return {
            column: s.column,
            levels: s.levels,
            datatype: (columnMetadata?.datatype === "boolean"
              ? "boolean"
              : "string") as "string" | "boolean",
          };
        }),
      );
      setAddingSlice(false);
    }
  };

  const cancelEditing = () => {
    setEditState(null);
    setEditingIndex(null);
    setEditingSliceLevels([]);
    setAddingSlice(false);
  };

  const saveEditing = () => {
    if (editingSliceLevels.length === 0) return;

    const sliceLevelsFormatted = editingSliceLevels.map((dl) => {
      // For boolean "null" slices, use empty array to generate correct pin ID
      const levels =
        dl.levels[0] === "null" && dl.datatype === "boolean"
          ? []
          : dl.levels[0]
            ? [dl.levels[0]]
            : [];

      return {
        column: dl.column,
        datatype: dl.datatype,
        levels,
      };
    });

    const newLevels: CustomMetricSlice = {
      slices: editingSliceLevels.map((dl) => ({
        column: dl.column,
        levels: dl.levels,
      })),
    };

    // Remove old pinned keys if editing existing entry
    const keysToRemove: string[] = [];
    if (editState === "editing" && editingIndex !== null) {
      const oldLevels = customMetricSlices[editingIndex as number];
      const oldSliceLevelsFormatted = oldLevels.slices.map((dl) => {
        // Look up datatype from metricsWithStringColumns
        const columnMetadata = metricsWithStringColumns
          .flatMap((metric) => metric.stringColumns || [])
          .find((col) => col.column === dl.column);

        return {
          column: dl.column,
          datatype: (columnMetadata?.datatype === "boolean"
            ? "boolean"
            : "string") as "string" | "boolean",
          levels: dl.levels[0] ? [dl.levels[0]] : [],
        };
      });

      // Remove pins for all applicable metrics for the old slice combination
      [
        ...expandedGoalMetrics,
        ...expandedSecondaryMetrics,
        ...expandedGuardrailMetrics,
      ].forEach((metricId) => {
        const locations: ("goal" | "secondary" | "guardrail")[] = [];
        if (expandedGoalMetrics.includes(metricId)) locations.push("goal");
        if (expandedSecondaryMetrics.includes(metricId))
          locations.push("secondary");
        if (expandedGuardrailMetrics.includes(metricId))
          locations.push("guardrail");

        locations.forEach((location) => {
          keysToRemove.push(
            generatePinnedSliceKey(
              metricId,
              oldSliceLevelsFormatted,
              location as "goal" | "secondary" | "guardrail",
            ),
          );
        });
      });
    }

    // Update the custom slice levels
    let updatedLevels: CustomMetricSlice[];
    if (editState === "adding") {
      // Adding new entry
      updatedLevels = [...customMetricSlices, newLevels];
    } else {
      // Editing existing entry
      updatedLevels = [...customMetricSlices];
      updatedLevels[editingIndex as number] = newLevels;
    }

    setCustomMetricSlices(updatedLevels);

    // Generate new pinned keys for all applicable metrics
    const newKeys: string[] = [];
    [
      ...expandedGoalMetrics,
      ...expandedSecondaryMetrics,
      ...expandedGuardrailMetrics,
    ].forEach((metricId) => {
      const locations: ("goal" | "secondary" | "guardrail")[] = [];
      if (expandedGoalMetrics.includes(metricId)) locations.push("goal");
      if (expandedSecondaryMetrics.includes(metricId))
        locations.push("secondary");
      if (expandedGuardrailMetrics.includes(metricId))
        locations.push("guardrail");

      locations.forEach((location) => {
        newKeys.push(
          generatePinnedSliceKey(
            metricId,
            sliceLevelsFormatted,
            location as "goal" | "secondary" | "guardrail",
          ),
        );
      });
    });

    // Update pinnedSliceLevels by removing old keys and adding new ones
    setPinnedMetricSlices([
      ...pinnedMetricSlices.filter((key) => !keysToRemove.includes(key)),
      ...newKeys,
    ]);

    cancelEditing();
  };

  // Remove a metric slice levels entry
  const removeMetricSliceLevels = (levelsIndex: number) => {
    const levelsToRemove = customMetricSlices[levelsIndex];
    const updatedLevels = customMetricSlices.filter(
      (_, i) => i !== levelsIndex,
    );
    setCustomMetricSlices(updatedLevels);

    // Auto-unpin custom slice levels from all applicable metrics
    const sliceLevelsFormatted = levelsToRemove.slices.map((dl) => {
      // Find the column metadata to check if it's boolean
      const columnMetadata = metricsWithStringColumns
        .flatMap((metric) => metric.stringColumns || [])
        .find((col) => col.column === dl.column);

      // For boolean "null" slices, use empty array to generate correct pin ID
      const levels =
        dl.levels[0] === "null" && columnMetadata?.datatype === "boolean"
          ? []
          : dl.levels[0]
            ? [dl.levels[0]]
            : [];

      return {
        column: dl.column,
        datatype: (columnMetadata?.datatype === "boolean"
          ? "boolean"
          : "string") as "string" | "boolean",
        levels,
      };
    });

    const keysToRemove: string[] = [];
    [
      ...expandedGoalMetrics,
      ...expandedSecondaryMetrics,
      ...expandedGuardrailMetrics,
    ].forEach((metricId) => {
      const locations: ("goal" | "secondary" | "guardrail")[] = [];
      if (expandedGoalMetrics.includes(metricId)) locations.push("goal");
      if (expandedSecondaryMetrics.includes(metricId))
        locations.push("secondary");
      if (expandedGuardrailMetrics.includes(metricId))
        locations.push("guardrail");

      locations.forEach((location) => {
        keysToRemove.push(
          generatePinnedSliceKey(
            metricId,
            sliceLevelsFormatted,
            location as "goal" | "secondary" | "guardrail",
          ),
        );
      });
    });

    setPinnedMetricSlices(
      pinnedMetricSlices.filter((key) => !keysToRemove.includes(key)),
    );
  };

  // Remove a slice level from the current editing levels
  const removeSliceLevel = (index: number) => {
    const newLevels = editingSliceLevels.filter((_, i) => i !== index);

    if (newLevels.length === 0) {
      // If this was the last pair, cancel editing entirely
      cancelEditing();
    } else {
      setEditingSliceLevels(newLevels);
    }
  };

  // Update a slice level in the current editing levels
  const updateSliceLevel = (
    index: number,
    field: "column" | "level",
    value: string,
  ) => {
    const newLevels = [...editingSliceLevels];
    if (field === "level") {
      newLevels[index] = { ...newLevels[index], levels: [value] };
    } else if (field === "column") {
      // When column changes, update datatype based on column metadata
      const columnMetadata = metricsWithStringColumns
        .flatMap((metric) => metric.stringColumns || [])
        .find((col) => col.column === value);

      newLevels[index] = {
        ...newLevels[index],
        column: value,
        datatype: columnMetadata?.datatype === "boolean" ? "boolean" : "string",
      };
    }
    setEditingSliceLevels(newLevels);
  };

  if (!hasMetricSlicesFeature) {
    return null;
  }

  if (!allMetricIds.length) {
    return null;
  }

  return (
    <>
      {hasCommercialFeature("metric-slices") &&
      metricsWithStringColumns.length > 0 ? (
        <div className="my-4">
          <label className="font-weight-bold mb-1">Custom Metric Slices</label>

          <Text
            as="p"
            className="mb-2"
            style={{ color: "var(--color-text-mid)" }}
          >
            Define custom slices to analyze across all experiment metrics.{" "}
            <DocLink docSection="customSlices">
              Learn More <PiArrowSquareOut />
            </DocLink>
          </Text>

          {customMetricSlices.map((levels, levelsIndex) => {
            const isEditing =
              editState === "editing" && editingIndex === levelsIndex;

            return (
              <div key={levelsIndex} className="appbox px-2 py-1 mb-2">
                {isEditing ? (
                  <EditingInterface
                    editingSliceLevels={editingSliceLevels}
                    addingSlice={addingSlice}
                    setAddingSlice={setAddingSlice}
                    setEditingSliceLevels={setEditingSliceLevels}
                    updateSliceLevel={updateSliceLevel}
                    removeSliceLevel={removeSliceLevel}
                    saveEditing={saveEditing}
                    cancelEditing={cancelEditing}
                    metricsWithSlices={metricsWithStringColumns}
                  />
                ) : (
                  <div className="d-flex align-items-center">
                    <div className="flex-grow-1">
                      <Flex gap="2" align="center">
                        {levels.slices.map((combo, comboIndex) => {
                          // Find the column datatype
                          const columnMetadata = metricsWithStringColumns
                            .flatMap((metric) => metric.stringColumns || [])
                            .find((col) => col.column === combo.column);
                          const isBoolean =
                            columnMetadata?.datatype === "boolean";

                          return (
                            <React.Fragment key={comboIndex}>
                              {comboIndex > 0 && <Text size="1">AND</Text>}
                              <Badge
                                label={
                                  <Text style={{ color: "var(--slate-12)" }}>
                                    {combo.column} ={" "}
                                    {isBoolean ? (
                                      <span
                                        style={{
                                          textTransform: "uppercase",
                                          fontWeight: 600,
                                          fontSize: "10px",
                                        }}
                                      >
                                        {combo.levels[0]}
                                      </span>
                                    ) : (
                                      combo.levels[0]
                                    )}
                                  </Text>
                                }
                                color="gray"
                              />
                            </React.Fragment>
                          );
                        })}
                      </Flex>
                    </div>
                    <div
                      className="d-flex align-items-center"
                      style={{ gap: "0.5rem" }}
                    >
                      <IconButton
                        variant="ghost"
                        size="1"
                        onClick={(e) => {
                          e.preventDefault();
                          startEditing(levelsIndex);
                        }}
                        mr="1"
                      >
                        <PiPencilSimpleFill />
                      </IconButton>
                      <IconButton
                        color="red"
                        variant="ghost"
                        size="1"
                        onClick={(e) => {
                          e.preventDefault();
                          removeMetricSliceLevels(levelsIndex);
                        }}
                      >
                        <PiX />
                      </IconButton>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {editState === null ? (
            <a
              role="button"
              className="d-inline-block link-purple font-weight-bold mt-1"
              onClick={() => startEditing(-1)}
            >
              <FaPlusCircle className="mr-1" />
              Add custom slice
            </a>
          ) : editState === "adding" ? (
            // Adding new entry
            <div className="appbox px-2 py-1 mb-2">
              <EditingInterface
                editingSliceLevels={editingSliceLevels}
                addingSlice={addingSlice}
                setAddingSlice={setAddingSlice}
                setEditingSliceLevels={setEditingSliceLevels}
                updateSliceLevel={updateSliceLevel}
                removeSliceLevel={removeSliceLevel}
                saveEditing={saveEditing}
                cancelEditing={cancelEditing}
                metricsWithSlices={metricsWithStringColumns}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// Slice selector component for adding new slices
function SliceSelector({
  editingSliceLevels,
  addingSlice,
  setAddingSlice,
  setEditingSliceLevels,
  metricsWithSlices,
}: {
  editingSliceLevels: SliceLevelsData[];
  addingSlice: boolean;
  setAddingSlice: (value: boolean) => void;
  setEditingSliceLevels: (value: SliceLevelsData[]) => void;
  metricsWithSlices: MetricWithStringColumns[];
}) {
  // Check if the last slice-level pair is complete before showing + AND
  const lastPairIndex = editingSliceLevels.length - 1;
  const lastPairIsComplete =
    lastPairIndex >= 0 &&
    editingSliceLevels[lastPairIndex].column &&
    editingSliceLevels[lastPairIndex].levels[0];

  // Get all available slice columns and union their levels
  const usedSlices = new Set(editingSliceLevels.map((dl) => dl.column));

  const sliceMap = new Map<
    string,
    { name: string; levels: Set<string>; column: string; datatype?: string }
  >();

  metricsWithSlices.forEach((metric) => {
    (metric.stringColumns || []).forEach((col) => {
      const existing = sliceMap.get(col.column);
      if (existing) {
        if (col.datatype === "boolean") {
          existing.levels.add("true");
          existing.levels.add("false");
          existing.levels.add("null");
        } else {
          col.autoSlices?.forEach((level) => {
            existing.levels.add(level);
          });
          col.topValues?.forEach((level) => {
            existing.levels.add(level);
          });
        }
      } else {
        let allLevels: Set<string>;
        if (col.datatype === "boolean") {
          allLevels = new Set(["true", "false", "null"]);
        } else {
          allLevels = new Set([
            ...(col.autoSlices || []),
            ...(col.topValues || []),
          ]);
        }
        sliceMap.set(col.column, {
          column: col.column,
          name: col.name || col.column || "",
          levels: allLevels,
          datatype: col.datatype,
        });
      }
    });
  });

  // Convert to array and filter out used slices
  const uniqueSlices = Array.from(sliceMap.values())
    .filter((slice) => !usedSlices.has(slice.column))
    .map((slice) => ({
      column: slice.column,
      name: slice.name,
      slices: Array.from(slice.levels).sort(), // Convert Set back to sorted array
      isAutoSliceColumn: metricsWithSlices.some((metric) =>
        metric.stringColumns.some(
          (col) => col.column === slice.column && col.isAutoSliceColumn,
        ),
      ),
    }));

  // Sort with isAutoSliceColumn first
  const sortedSlices = uniqueSlices.sort((a, b) => {
    if (a.isAutoSliceColumn && !b.isAutoSliceColumn) return -1;
    if (!a.isAutoSliceColumn && b.isAutoSliceColumn) return 1;
    return a.name.localeCompare(b.name);
  });

  // Create a map for quick lookup of auto slice columns
  const autoSliceColumnMap = new Set(
    sortedSlices
      .filter((slice) => slice.isAutoSliceColumn)
      .map((slice) => slice.column),
  );

  // Only show + AND if there are available slices AND the last pair is complete
  const shouldShowAndButton = sortedSlices.length > 0 && lastPairIsComplete;

  return addingSlice ? (
    sortedSlices.length > 0 ? (
      <div className="border rounded d-flex align-items-center bg-white">
        <SelectField
          value=""
          onChange={(value) => {
            if (value) {
              // Look up datatype from metricsWithSlices
              const columnMetadata = metricsWithSlices
                .flatMap((metric) => metric.stringColumns || [])
                .find((col) => col.column === value);

              const newSliceLevel: SliceLevelsData = {
                column: value,
                levels: [""], // Start with empty level
                datatype: (columnMetadata?.datatype === "boolean"
                  ? "boolean"
                  : "string") as "string" | "boolean",
              };
              setEditingSliceLevels([...editingSliceLevels, newSliceLevel]);
              setAddingSlice(false);
            }
          }}
          style={{ minWidth: "150px" }}
          options={sortedSlices.map((col) => ({
            label: col.name || col.column || "",
            value: col.column || "",
          }))}
          formatOptionLabel={(option) => (
            <Flex align="center" gap="1">
              {autoSliceColumnMap.has(option.value) ? (
                <Text color="purple" size="1">
                  <PiStackBold />
                </Text>
              ) : (
                <div style={{ width: 13 }} />
              )}
              <Text>{option.label}</Text>
            </Flex>
          )}
          placeholder="column"
          className="mb-0"
          autoFocus
        />
      </div>
    ) : null
  ) : shouldShowAndButton ? (
    <a
      role="button"
      onClick={(e) => {
        e.preventDefault();
        setAddingSlice(true);
      }}
      className="link-purple mx-1"
    >
      + AND
    </a>
  ) : null;
}

// Main editing interface component
function EditingInterface({
  editingSliceLevels,
  addingSlice,
  setAddingSlice,
  setEditingSliceLevels,
  updateSliceLevel,
  removeSliceLevel,
  saveEditing,
  cancelEditing,
  metricsWithSlices,
}: {
  editingSliceLevels: SliceLevelsData[];
  addingSlice: boolean;
  setAddingSlice: (value: boolean) => void;
  setEditingSliceLevels: (value: SliceLevelsData[]) => void;
  updateSliceLevel: (
    index: number,
    field: "column" | "level",
    value: string,
  ) => void;
  removeSliceLevel: (index: number) => void;
  saveEditing: () => void;
  cancelEditing: () => void;
  metricsWithSlices: MetricWithStringColumns[];
}) {
  return (
    <div className="d-flex align-items-top" style={{ gap: "3rem" }}>
      <div
        className="flex-grow-1 d-flex flex-wrap align-items-center"
        style={{ gap: "0.5rem", minHeight: "40px" }}
      >
        {editingSliceLevels.map((sliceLevel, levelIndex) => {
          const sliceMap = new Map<
            string,
            {
              name: string;
              levels: Set<string>;
              column: string;
              datatype?: string;
            }
          >();

          metricsWithSlices.forEach((metric) => {
            (metric.stringColumns || []).forEach((col) => {
              if (col.column !== sliceLevel.column) return;

              const existing = sliceMap.get(col.column);
              if (existing) {
                if (col.datatype === "boolean") {
                  existing.levels.add("true");
                  existing.levels.add("false");
                  existing.levels.add("null");
                } else {
                  col.autoSlices?.forEach((level) => {
                    existing.levels.add(level);
                  });
                  col.topValues?.forEach((level) => {
                    existing.levels.add(level);
                  });
                }
              } else {
                let allLevels: Set<string>;
                if (col.datatype === "boolean") {
                  allLevels = new Set(["true", "false", "null"]);
                } else {
                  allLevels = new Set([
                    ...(col.autoSlices || []),
                    ...(col.topValues || []),
                  ]);
                }
                sliceMap.set(col.column, {
                  column: col.column,
                  name: col.name || col.column || "",
                  levels: allLevels,
                  datatype: col.datatype,
                });
              }
            });
          });

          const sliceColumn = sliceMap.get(sliceLevel.column);

          if (!sliceColumn) return null;

          if (sliceColumn.datatype === "boolean") {
            const booleanOptions = [
              { label: "TRUE", value: "true" },
              { label: "FALSE", value: "false" },
              { label: "NULL", value: "null" },
            ];

            return (
              <div
                key={levelIndex}
                className="border rounded d-flex align-items-center bg-white"
              >
                <span className="px-2 font-weight-medium">
                  {sliceColumn?.name || sliceLevel.column}:
                </span>
                <SelectField
                  value={sliceLevel.levels[0] || ""}
                  onChange={(value) =>
                    updateSliceLevel(levelIndex, "level", value)
                  }
                  options={booleanOptions}
                  className="mb-0"
                  style={{ minWidth: "120px" }}
                  placeholder="Select..."
                  autoFocus={!sliceLevel.levels[0]}
                  sort={false}
                />
                <button
                  type="button"
                  className="btn btn-link p-0 ml-1 text-muted"
                  onClick={() => removeSliceLevel(levelIndex)}
                >
                  <FaTimes />
                </button>
              </div>
            );
          }

          const availableLevels = Array.from(sliceColumn.levels).sort();

          return (
            <div
              key={levelIndex}
              className="border rounded d-flex align-items-center bg-white"
            >
              <span className="px-2 font-weight-medium">
                {sliceColumn?.name || sliceLevel.column}:
              </span>
              {availableLevels.length > 0 ? (
                <SelectField
                  value={sliceLevel.levels[0] || ""}
                  onChange={(value) =>
                    updateSliceLevel(levelIndex, "level", value)
                  }
                  options={availableLevels.map((level) => ({
                    label: level,
                    value: level,
                  }))}
                  className="mb-0"
                  style={{ minWidth: "120px" }}
                  createable
                  placeholder=""
                  autoFocus={!sliceLevel.levels[0]}
                  sort={false}
                />
              ) : (
                <Field
                  value={sliceLevel.levels[0] || ""}
                  onChange={(e) =>
                    updateSliceLevel(levelIndex, "level", e.target.value)
                  }
                  className="mb-0"
                  style={{ width: "130px" }}
                  placeholder="Column value..."
                  autoFocus={!sliceLevel.levels[0]}
                />
              )}
              <button
                type="button"
                className="btn btn-link p-0 ml-1 text-muted"
                onClick={() => removeSliceLevel(levelIndex)}
              >
                <FaTimes />
              </button>
            </div>
          );
        })}

        <SliceSelector
          editingSliceLevels={editingSliceLevels}
          addingSlice={addingSlice}
          setAddingSlice={setAddingSlice}
          setEditingSliceLevels={setEditingSliceLevels}
          metricsWithSlices={metricsWithSlices}
        />
      </div>

      <div className="d-flex align-items-center" style={{ gap: "0.5rem" }}>
        <Button
          size="xs"
          onClick={saveEditing}
          disabled={
            editingSliceLevels.length === 0 ||
            editingSliceLevels.some(
              (level) => !level.levels[0] || level.levels[0].trim() === "",
            )
          }
          mr="1"
        >
          Done
        </Button>
        <IconButton
          color="red"
          variant="ghost"
          size="1"
          onClick={cancelEditing}
        >
          <PiX />
        </IconButton>
      </div>
    </div>
  );
}
