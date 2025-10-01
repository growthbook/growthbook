import React, { useState, useMemo } from "react";
import { FaTimes, FaPlusCircle } from "react-icons/fa";
import { PiPencilSimpleFill, PiX } from "react-icons/pi";
import { Text, Flex, IconButton } from "@radix-ui/themes";
import {
  isFactMetric,
  generatePinnedSliceKey,
  expandMetricGroups,
} from "shared/experiments";
import { FactMetricInterface } from "back-end/types/fact-table";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { CustomMetricSlice } from "back-end/src/validators/experiments";
import Badge from "@/ui/Badge";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";

export interface SliceLevel {
  column: string;
  levels: string[]; // single element for now, will support multiple levels in future
}

interface MetricWithDimensions extends FactMetricInterface {
  dimensionColumns: Array<{
    column: string;
    name: string;
    isAutoSliceColumn?: boolean;
    autoSlices?: string[];
  }>;
}

export interface MetricSlicesSelectorProps {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  customMetricSlices: CustomMetricSlice[];
  setCustomMetricSlices: (slices: CustomMetricSlice[]) => void;
  pinnedMetricSlices: string[];
  setPinnedMetricSlices: (slices: string[]) => void;
}

export default function MetricSlicesSelector({
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  customMetricSlices,
  setCustomMetricSlices,
  pinnedMetricSlices,
  setPinnedMetricSlices,
}: MetricSlicesSelectorProps) {
  const growthbook = useGrowthBook();
  const { hasCommercialFeature } = useUser();

  // State for editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // null = not editing, -1 = adding new, >=0 = editing existing
  const [editingSliceLevels, setEditingSliceLevels] = useState<SliceLevel[]>(
    [],
  );
  const [addingDimension, setAddingDimension] = useState(false);

  // Feature flags
  const hasMetricSlicesFeature = growthbook?.isOn("metric-slices");

  // Get all metrics and fact tables with slice analysis enabled
  const { factMetrics, metricGroups, factTables } = useDefinitions();

  // Expand metric groups to individual metrics for all operations
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

  const { metricsWithDimensionColumns } = useMemo(() => {
    const factTableMap = new Map(factTables.map((table) => [table.id, table]));

    const allMetrics = allMetricIds
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
        const dimensionColumns = factTable?.columns?.filter(
          (col) => col.isAutoSliceColumn && !col.deleted,
        );
        return {
          ...metric!,
          dimensionColumns: dimensionColumns || [],
        };
      });

    const metricsWithDimensionColumns = allMetrics.filter(
      (metric) => metric.dimensionColumns.length > 0,
    );

    return { metricsWithDimensionColumns };
  }, [allMetricIds, factMetrics, factTables]);

  // Start editing (either existing entry or new entry)
  const startEditing = (index: number) => {
    setEditingIndex(index);
    if (index === -1) {
      // Adding new entry - start with empty dimension-level pair
      setEditingSliceLevels([]);
      setAddingDimension(true); // Start in adding mode for first dimension
    } else {
      // Editing existing entry
      const levels = customMetricSlices[index];
      setEditingSliceLevels(
        levels.slices.map((s) => ({ column: s.column, levels: s.levels })),
      );
      setAddingDimension(false); // Don't show dimension selector initially
    }
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingIndex(null);
    setEditingSliceLevels([]);
    setAddingDimension(false);
  };

  // Save editing changes
  const saveEditing = () => {
    if (editingSliceLevels.length === 0) return;

    const sliceLevelsFormatted = editingSliceLevels.map((dl) => ({
      column: dl.column,
      levels: dl.levels[0] ? [dl.levels[0]] : [],
    }));

    const newLevels: CustomMetricSlice = {
      slices: editingSliceLevels.map((dl) => ({
        column: dl.column,
        levels: dl.levels,
      })),
    };

    // Remove old pinned keys if editing existing entry
    const keysToRemove: string[] = [];
    if (editingIndex !== null && editingIndex >= 0) {
      const oldLevels = customMetricSlices[editingIndex as number];
      const oldSliceLevelsFormatted = oldLevels.slices.map((dl) => ({
        column: dl.column,
        levels: dl.levels[0] ? [dl.levels[0]] : [],
      }));

      // Remove pins for all applicable metrics for the old dimension combination
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

    // Update the custom dimension levels
    let updatedLevels: CustomMetricSlice[];
    if (editingIndex === -1) {
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

  // Remove a metric dimension levels entry
  const removeMetricSliceLevels = (levelsIndex: number) => {
    const levelsToRemove = customMetricSlices[levelsIndex];
    const updatedLevels = customMetricSlices.filter(
      (_, i) => i !== levelsIndex,
    );
    setCustomMetricSlices(updatedLevels);

    // Auto-unpin custom dimension levels from all applicable metrics
    const sliceLevelsFormatted = levelsToRemove.slices.map((dl) => ({
      column: dl.column,
      levels: dl.levels[0] ? [dl.levels[0]] : [],
    }));

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

  // Remove a dimension level from the current editing levels
  const removeSliceLevel = (index: number) => {
    const newLevels = editingSliceLevels.filter((_, i) => i !== index);

    if (newLevels.length === 0) {
      // If this was the last pair, cancel editing entirely
      cancelEditing();
    } else {
      setEditingSliceLevels(newLevels);
    }
  };

  // Update a dimension level in the current editing levels
  const updateSliceLevel = (
    index: number,
    field: "column" | "level",
    value: string,
  ) => {
    const newLevels = [...editingSliceLevels];
    if (field === "level") {
      newLevels[index] = { ...newLevels[index], levels: [value] };
    } else {
      newLevels[index] = { ...newLevels[index], [field]: value };
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
      metricsWithDimensionColumns.length > 0 ? (
        <div className="my-4">
          <label className="font-weight-bold mb-1">
            Additional Metric Slices
          </label>

          <Text
            as="p"
            className="mb-2"
            style={{ color: "var(--color-text-mid)" }}
          >
            Define custom slices to analyze beyond the standard auto slices.
          </Text>

          {customMetricSlices.map((levels, levelsIndex) => {
            const isEditing = editingIndex === levelsIndex;

            return (
              <div key={levelsIndex} className="appbox px-2 py-1 mb-2">
                {isEditing ? (
                  <EditingInterface
                    editingSliceLevels={editingSliceLevels}
                    addingDimension={addingDimension}
                    setAddingDimension={setAddingDimension}
                    setEditingSliceLevels={setEditingSliceLevels}
                    updateSliceLevel={updateSliceLevel}
                    removeSliceLevel={removeSliceLevel}
                    saveEditing={saveEditing}
                    cancelEditing={cancelEditing}
                    metricsWithDimensions={metricsWithDimensionColumns}
                  />
                ) : (
                  <div className="d-flex align-items-center">
                    <div className="flex-grow-1">
                      <Flex gap="2" align="center">
                        {levels.slices.map((combo, comboIndex) => (
                          <React.Fragment key={comboIndex}>
                            {comboIndex > 0 && <Text size="1">AND</Text>}
                            <Badge
                              label={
                                <Text style={{ color: "var(--slate-12)" }}>
                                  {combo.column} = {combo.levels[0]}
                                </Text>
                              }
                              color="gray"
                            />
                          </React.Fragment>
                        ))}
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

          {editingIndex === null ? (
            <a
              role="button"
              className="d-inline-block link-purple font-weight-bold mt-2"
              onClick={() => startEditing(-1)}
            >
              <FaPlusCircle className="mr-1" />
              Add metrics slice
            </a>
          ) : editingIndex === -1 ? (
            // Adding new entry
            <div className="appbox px-2 py-1 mb-2">
              <EditingInterface
                editingSliceLevels={editingSliceLevels}
                addingDimension={addingDimension}
                setAddingDimension={setAddingDimension}
                setEditingSliceLevels={setEditingSliceLevels}
                updateSliceLevel={updateSliceLevel}
                removeSliceLevel={removeSliceLevel}
                saveEditing={saveEditing}
                cancelEditing={cancelEditing}
                metricsWithDimensions={metricsWithDimensionColumns}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// Dimension selector component for adding new dimensions
function DimensionSelector({
  editingSliceLevels,
  addingDimension,
  setAddingDimension,
  setEditingSliceLevels,
  metricsWithDimensions,
}: {
  editingSliceLevels: SliceLevel[];
  addingDimension: boolean;
  setAddingDimension: (value: boolean) => void;
  setEditingSliceLevels: (value: SliceLevel[]) => void;
  metricsWithDimensions: MetricWithDimensions[];
}) {
  // Check if the last dimension-level pair is complete before showing + AND
  const lastPairIndex = editingSliceLevels.length - 1;
  const lastPairIsComplete =
    lastPairIndex >= 0 &&
    editingSliceLevels[lastPairIndex].column &&
    editingSliceLevels[lastPairIndex].levels[0];

  // Get all available dimension columns and union their levels
  const usedDimensions = new Set(editingSliceLevels.map((dl) => dl.column));

  const dimensionMap = new Map<
    string,
    { name: string; levels: Set<string>; column: string }
  >();

  metricsWithDimensions.forEach((metric) => {
    (metric.dimensionColumns || []).forEach((col) => {
      if (!col.isAutoSliceColumn) return;

      const existing = dimensionMap.get(col.column);
      if (existing) {
        // UNION the levels from this metric with existing levels
        col.autoSlices?.forEach((level) => {
          existing.levels.add(level);
        });
      } else {
        // Create new entry with levels from this metric
        dimensionMap.set(col.column, {
          column: col.column,
          name: col.name || col.column || "",
          levels: new Set(col.autoSlices || []),
        });
      }
    });
  });

  // Convert to array and filter out used dimensions
  const uniqueDimensions = Array.from(dimensionMap.values())
    .filter((dim) => !usedDimensions.has(dim.column))
    .map((dim) => ({
      column: dim.column,
      name: dim.name,
      slices: Array.from(dim.levels).sort(), // Convert Set back to sorted array
    }));

  // Only show + AND if there are available dimensions AND the last pair is complete
  const shouldShowAndButton = uniqueDimensions.length > 0 && lastPairIsComplete;

  return addingDimension ? (
    uniqueDimensions.length > 0 ? (
      <div className="border rounded d-flex align-items-center bg-white">
        <SelectField
          value=""
          onChange={(value) => {
            if (value) {
              const newSliceLevel: SliceLevel = {
                column: value,
                levels: [""], // Start with empty level
              };
              setEditingSliceLevels([...editingSliceLevels, newSliceLevel]);
              setAddingDimension(false);
            }
          }}
          options={uniqueDimensions.map((col) => ({
            label: col.name || col.column || "",
            value: col.column || "",
          }))}
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
        setAddingDimension(true);
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
  addingDimension,
  setAddingDimension,
  setEditingSliceLevels,
  updateSliceLevel,
  removeSliceLevel,
  saveEditing,
  cancelEditing,
  metricsWithDimensions,
}: {
  editingSliceLevels: SliceLevel[];
  addingDimension: boolean;
  setAddingDimension: (value: boolean) => void;
  setEditingSliceLevels: (value: SliceLevel[]) => void;
  updateSliceLevel: (
    index: number,
    field: "column" | "level",
    value: string,
  ) => void;
  removeSliceLevel: (index: number) => void;
  saveEditing: () => void;
  cancelEditing: () => void;
  metricsWithDimensions: MetricWithDimensions[];
}) {
  return (
    <div className="d-flex align-items-top" style={{ gap: "3rem" }}>
      <div
        className="flex-grow-1 d-flex flex-wrap align-items-center"
        style={{ gap: "0.5rem", minHeight: "40px" }}
      >
        {editingSliceLevels.map((sliceLevel, levelIndex) => {
          // Build the same dimension map with unioned levels
          const dimensionMap = new Map<
            string,
            { name: string; levels: string[] }
          >();

          metricsWithDimensions.forEach((metric) => {
            (metric.dimensionColumns || []).forEach((col) => {
              if (!col.isAutoSliceColumn || col.column !== sliceLevel.column)
                return;

              const existing = dimensionMap.get(col.column);
              if (existing) {
                // UNION the levels from this metric with existing levels
                col.autoSlices?.forEach((level) => {
                  if (!existing.levels.includes(level)) {
                    existing.levels.push(level);
                  }
                });
              } else {
                // Create new entry with levels from this metric
                dimensionMap.set(col.column, {
                  name: col.name || col.column || "",
                  levels: [...(col.autoSlices || [])],
                });
              }
            });
          });

          const dimensionColumn = dimensionMap.get(sliceLevel.column);
          const availableLevels = dimensionColumn?.levels.sort() || [];

          return (
            <div
              key={levelIndex}
              className="border rounded d-flex align-items-center bg-white"
            >
              <span className="px-2 font-weight-medium">
                {dimensionColumn?.name || sliceLevel.column}:
              </span>
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
        })}

        <DimensionSelector
          editingSliceLevels={editingSliceLevels}
          addingDimension={addingDimension}
          setAddingDimension={setAddingDimension}
          setEditingSliceLevels={setEditingSliceLevels}
          metricsWithDimensions={metricsWithDimensions}
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
