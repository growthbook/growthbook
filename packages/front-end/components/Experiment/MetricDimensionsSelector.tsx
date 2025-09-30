import React, { useState, useMemo } from "react";
import { FaTimes, FaPlusCircle } from "react-icons/fa";
import { PiPencilSimpleFill, PiX } from "react-icons/pi";
import { Text, Flex, IconButton } from "@radix-ui/themes";
import {
  isFactMetric,
  generatePinnedDimensionKey,
  expandMetricGroups,
} from "shared/experiments";
import {
  FactTableInterface,
  FactMetricInterface,
} from "back-end/types/fact-table";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { CustomMetricDimensionLevel } from "back-end/src/validators/experiments";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import Badge from "@/ui/Badge";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import HelperText from "@/ui/HelperText";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";

export interface DimensionLevel {
  dimension: string;
  levels: string[]; // single element for now, will support multiple levels in future
}

interface MetricWithDimensions extends FactMetricInterface {
  dimensionColumns: Array<{
    column: string;
    name: string;
    isDimension?: boolean;
    dimensionLevels?: string[];
  }>;
}

export interface MetricDimensionsSelectorProps {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  customMetricDimensionLevels: CustomMetricDimensionLevel[];
  setCustomMetricDimensionLevels: (
    levels: CustomMetricDimensionLevel[],
  ) => void;
  pinnedMetricDimensionLevels: string[];
  setPinnedMetricDimensionLevels: (levels: string[]) => void;
}

interface StandardDimensionsSectionProps {
  metricsWithDimensions: MetricWithDimensions[];
  factTables: FactTableInterface[];
}

function StandardDimensionsSection({
  metricsWithDimensions,
  factTables,
}: StandardDimensionsSectionProps) {
  // Create a map for efficient lookups
  const factTableMap = new Map(factTables.map((table) => [table.id, table]));

  const metricsWithEnabledDimensions = metricsWithDimensions.filter(
    (metric) => metric.enableMetricDimensions,
  );

  if (metricsWithEnabledDimensions.length === 0) {
    return (
      <div className="text-muted">
        <em>No metrics have dimension analysis enabled.</em>
      </div>
    );
  }

  return (
    <div className="d-flex flex-wrap" style={{ gap: "0.5rem" }}>
      {metricsWithEnabledDimensions.map((metric) => {
        const factTable = factTableMap.get(metric.numerator.factTableId);
        if (!factTable) return null;

        const dimensionColumns = factTable.columns.filter(
          (col) => col.isDimension && !col.deleted,
        );

        const totalDimensionLevels = dimensionColumns.reduce((total, col) => {
          return total + (col.dimensionLevels?.length || 0);
        }, 0);

        return (
          <Tooltip
            key={metric.id}
            body={`${dimensionColumns.length} dimensions, ${totalDimensionLevels} levels`}
          >
            <Badge label={metric.name} color="violet" />
          </Tooltip>
        );
      })}
    </div>
  );
}

export default function MetricDimensionsSelector({
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  customMetricDimensionLevels,
  setCustomMetricDimensionLevels,
  pinnedMetricDimensionLevels,
  setPinnedMetricDimensionLevels,
}: MetricDimensionsSelectorProps) {
  const growthbook = useGrowthBook();
  const { hasCommercialFeature } = useUser();

  // State for editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // null = not editing, -1 = adding new, >=0 = editing existing
  const [editingDimensionLevels, setEditingDimensionLevels] = useState<
    DimensionLevel[]
  >([]);
  const [addingDimension, setAddingDimension] = useState(false);

  // Feature flags
  const hasMetricDimensionsFeature = growthbook?.isOn("metric-dimensions");

  // Get all metrics and fact tables with dimension analysis enabled
  const { factMetrics, metricGroups, factTables } = useDefinitions();
  const allMetricIds = useMemo(() => {
    const rawMetricIds = [
      ...goalMetrics,
      ...secondaryMetrics,
      ...guardrailMetrics,
    ];
    const expandedMetricIds = expandMetricGroups(rawMetricIds, metricGroups);
    return [...new Set(expandedMetricIds)];
  }, [goalMetrics, secondaryMetrics, guardrailMetrics, metricGroups]);

  const { metricsWithDimensionColumns, metricsWithDimensionsEnabled } =
    useMemo(() => {
      const factTableMap = new Map(
        factTables.map((table) => [table.id, table]),
      );

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
            (col) => col.isDimension && !col.deleted,
          );
          return {
            ...metric!,
            dimensionColumns: dimensionColumns || [],
          };
        });

      const metricsWithDimensionColumns = allMetrics.filter(
        (metric) => metric.dimensionColumns.length > 0,
      );

      const metricsWithDimensionsEnabled = allMetrics.filter(
        (metric) =>
          metric.dimensionColumns.length > 0 && !!metric.enableMetricDimensions,
      );

      return { metricsWithDimensionColumns, metricsWithDimensionsEnabled };
    }, [allMetricIds, factMetrics, factTables]);

  // Update the parent state with new metric dimension levels
  const updateCustomMetricDimensionLevels = (
    newLevels: CustomMetricDimensionLevel[],
  ) => {
    setCustomMetricDimensionLevels(newLevels);
  };

  // Start editing (either existing entry or new entry)
  const startEditing = (index: number) => {
    setEditingIndex(index);
    if (index === -1) {
      // Adding new entry - start with empty dimension-level pair
      setEditingDimensionLevels([]);
      setAddingDimension(true); // Start in adding mode for first dimension
    } else {
      // Editing existing entry
      const levels = customMetricDimensionLevels[index];
      setEditingDimensionLevels(levels.dimensionLevels);
      setAddingDimension(false); // Don't show dimension selector initially
    }
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingIndex(null);
    setEditingDimensionLevels([]);
    setAddingDimension(false);
  };

  // Save editing changes
  const saveEditing = () => {
    if (editingDimensionLevels.length === 0) return;

    const dimensionLevelsFormatted = editingDimensionLevels.map((dl) => ({
      dimension: dl.dimension,
      levels: dl.levels[0] ? [dl.levels[0]] : [],
    }));

    const newLevels: CustomMetricDimensionLevel = {
      dimensionLevels: editingDimensionLevels,
    };

    // Remove old pinned keys if editing existing entry
    const keysToRemove: string[] = [];
    if (editingIndex !== null && editingIndex >= 0) {
      const oldLevels = customMetricDimensionLevels[editingIndex as number];
      const oldDimensionLevelsFormatted = oldLevels.dimensionLevels.map(
        (dl) => ({
          dimension: dl.dimension,
          levels: dl.levels[0] ? [dl.levels[0]] : [],
        }),
      );

      // Remove pins for all applicable metrics for the old dimension combination
      [...goalMetrics, ...secondaryMetrics, ...guardrailMetrics].forEach(
        (metricId) => {
          const locations: ("goal" | "secondary" | "guardrail")[] = [];
          if (goalMetrics.includes(metricId)) locations.push("goal");
          if (secondaryMetrics.includes(metricId)) locations.push("secondary");
          if (guardrailMetrics.includes(metricId)) locations.push("guardrail");

          locations.forEach((location) => {
            keysToRemove.push(
              generatePinnedDimensionKey(
                metricId,
                oldDimensionLevelsFormatted,
                location as "goal" | "secondary" | "guardrail",
              ),
            );
          });
        },
      );
    }

    // Update the custom dimension levels
    let updatedLevels: CustomMetricDimensionLevel[];
    if (editingIndex === -1) {
      // Adding new entry
      updatedLevels = [...customMetricDimensionLevels, newLevels];
    } else {
      // Editing existing entry
      updatedLevels = [...customMetricDimensionLevels];
      updatedLevels[editingIndex as number] = newLevels;
    }

    updateCustomMetricDimensionLevels(updatedLevels);

    // Generate new pinned keys for all applicable metrics
    const newKeys: string[] = [];
    [...goalMetrics, ...secondaryMetrics, ...guardrailMetrics].forEach(
      (metricId) => {
        const locations: ("goal" | "secondary" | "guardrail")[] = [];
        if (goalMetrics.includes(metricId)) locations.push("goal");
        if (secondaryMetrics.includes(metricId)) locations.push("secondary");
        if (guardrailMetrics.includes(metricId)) locations.push("guardrail");

        locations.forEach((location) => {
          newKeys.push(
            generatePinnedDimensionKey(
              metricId,
              dimensionLevelsFormatted,
              location as "goal" | "secondary" | "guardrail",
            ),
          );
        });
      },
    );

    // Update pinnedDimensionLevels by removing old keys and adding new ones
    setPinnedMetricDimensionLevels([
      ...pinnedMetricDimensionLevels.filter(
        (key) => !keysToRemove.includes(key),
      ),
      ...newKeys,
    ]);

    cancelEditing();
  };

  // Remove a metric dimension levels entry
  const removeMetricDimensionLevels = (levelsIndex: number) => {
    const levelsToRemove = customMetricDimensionLevels[levelsIndex];
    const updatedLevels = customMetricDimensionLevels.filter(
      (_, i) => i !== levelsIndex,
    );
    updateCustomMetricDimensionLevels(updatedLevels);

    // Auto-unpin custom dimension levels from all applicable metrics
    const dimensionLevelsFormatted = levelsToRemove.dimensionLevels.map(
      (dl) => ({
        dimension: dl.dimension,
        levels: dl.levels[0] ? [dl.levels[0]] : [],
      }),
    );

    const keysToRemove: string[] = [];
    [...goalMetrics, ...secondaryMetrics, ...guardrailMetrics].forEach(
      (metricId) => {
        const locations: ("goal" | "secondary" | "guardrail")[] = [];
        if (goalMetrics.includes(metricId)) locations.push("goal");
        if (secondaryMetrics.includes(metricId)) locations.push("secondary");
        if (guardrailMetrics.includes(metricId)) locations.push("guardrail");

        locations.forEach((location) => {
          keysToRemove.push(
            generatePinnedDimensionKey(
              metricId,
              dimensionLevelsFormatted,
              location as "goal" | "secondary" | "guardrail",
            ),
          );
        });
      },
    );

    setPinnedMetricDimensionLevels(
      pinnedMetricDimensionLevels.filter((key) => !keysToRemove.includes(key)),
    );
  };

  // Remove a dimension level from the current editing levels
  const removeDimensionLevel = (index: number) => {
    const newLevels = editingDimensionLevels.filter((_, i) => i !== index);

    if (newLevels.length === 0) {
      // If this was the last pair, cancel editing entirely
      cancelEditing();
    } else {
      setEditingDimensionLevels(newLevels);
    }
  };

  // Update a dimension level in the current editing levels
  const updateDimensionLevel = (
    index: number,
    field: "dimension" | "level",
    value: string,
  ) => {
    const newLevels = [...editingDimensionLevels];
    if (field === "level") {
      newLevels[index] = { ...newLevels[index], levels: [value] };
    } else {
      newLevels[index] = { ...newLevels[index], [field]: value };
    }
    setEditingDimensionLevels(newLevels);
  };

  if (!hasMetricDimensionsFeature) {
    return null;
  }

  if (!allMetricIds.length) {
    return null;
  }

  return (
    <>
      <div className="my-4">
        <label className="font-weight-bold mb-1">
          Metric Dimensions
          <PaidFeatureBadge commercialFeature="metric-dimensions" />
        </label>

        {metricsWithDimensionsEnabled.length > 0 ? (
          <>
            <Text
              as="p"
              className="mb-2"
              style={{ color: "var(--color-text-mid)" }}
            >
              These metrics will be analyzed across all dimensions and levels
              defined in their fact table.
            </Text>
            <StandardDimensionsSection
              metricsWithDimensions={metricsWithDimensionsEnabled}
              factTables={factTables}
            />
          </>
        ) : (
          <HelperText status="info" mt="1">
            No metrics with dimension analysis enabled found. Configure
            dimension for for your metrics&apos; fact tables.
          </HelperText>
        )}
      </div>

      {hasCommercialFeature("metric-dimensions") &&
      metricsWithDimensionColumns.length > 0 ? (
        <div className="my-4">
          <label className="font-weight-bold mb-1">
            Additional Metric Dimensions
          </label>

          <Text
            as="p"
            className="mb-2"
            style={{ color: "var(--color-text-mid)" }}
          >
            Define custom dimensions to analyze beyond the standard dimension
            breakdowns.
          </Text>

          {customMetricDimensionLevels.map((levels, levelsIndex) => {
            const isEditing = editingIndex === levelsIndex;

            return (
              <div key={levelsIndex} className="appbox px-2 py-1 mb-2">
                {isEditing ? (
                  <EditingInterface
                    editingDimensionLevels={editingDimensionLevels}
                    addingDimension={addingDimension}
                    setAddingDimension={setAddingDimension}
                    setEditingDimensionLevels={setEditingDimensionLevels}
                    updateDimensionLevel={updateDimensionLevel}
                    removeDimensionLevel={removeDimensionLevel}
                    saveEditing={saveEditing}
                    cancelEditing={cancelEditing}
                    metricsWithDimensions={metricsWithDimensionColumns}
                  />
                ) : (
                  <div className="d-flex align-items-center">
                    <div className="flex-grow-1">
                      <Flex gap="2" align="center">
                        {levels.dimensionLevels.map((combo, comboIndex) => (
                          <React.Fragment key={comboIndex}>
                            {comboIndex > 0 && <Text size="1">AND</Text>}
                            <Badge
                              label={
                                <Text style={{ color: "var(--slate-12)" }}>
                                  {combo.dimension} = {combo.levels[0]}
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
                          removeMetricDimensionLevels(levelsIndex);
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
            <div className="mt-2">
              <a
                role="button"
                className="d-inline-block link-purple font-weight-bold mt-2"
                onClick={() => startEditing(-1)}
              >
                <FaPlusCircle className="mr-1" />
                Add dimension breakdown
              </a>
            </div>
          ) : editingIndex === -1 ? (
            // Adding new entry
            <div className="appbox px-2 py-1 mb-2">
              <EditingInterface
                editingDimensionLevels={editingDimensionLevels}
                addingDimension={addingDimension}
                setAddingDimension={setAddingDimension}
                setEditingDimensionLevels={setEditingDimensionLevels}
                updateDimensionLevel={updateDimensionLevel}
                removeDimensionLevel={removeDimensionLevel}
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
  editingDimensionLevels,
  addingDimension,
  setAddingDimension,
  setEditingDimensionLevels,
  metricsWithDimensions,
}: {
  editingDimensionLevels: DimensionLevel[];
  addingDimension: boolean;
  setAddingDimension: (value: boolean) => void;
  setEditingDimensionLevels: (value: DimensionLevel[]) => void;
  metricsWithDimensions: MetricWithDimensions[];
}) {
  // Check if the last dimension-level pair is complete before showing + AND
  const lastPairIndex = editingDimensionLevels.length - 1;
  const lastPairIsComplete =
    lastPairIndex >= 0 &&
    editingDimensionLevels[lastPairIndex].dimension &&
    editingDimensionLevels[lastPairIndex].levels[0];

  // Get all available dimension columns and union their levels
  const usedDimensions = new Set(
    editingDimensionLevels.map((dl) => dl.dimension),
  );

  const dimensionMap = new Map<
    string,
    { name: string; levels: Set<string>; column: string }
  >();

  metricsWithDimensions.forEach((metric) => {
    (metric.dimensionColumns || []).forEach((col) => {
      if (!col.isDimension) return;

      const existing = dimensionMap.get(col.column);
      if (existing) {
        // UNION the levels from this metric with existing levels
        col.dimensionLevels?.forEach((level) => {
          existing.levels.add(level);
        });
      } else {
        // Create new entry with levels from this metric
        dimensionMap.set(col.column, {
          column: col.column,
          name: col.name || col.column || "",
          levels: new Set(col.dimensionLevels || []),
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
      dimensionLevels: Array.from(dim.levels).sort(), // Convert Set back to sorted array
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
              const newDimensionLevel: DimensionLevel = {
                dimension: value,
                levels: [""], // Start with empty level
              };
              setEditingDimensionLevels([
                ...editingDimensionLevels,
                newDimensionLevel,
              ]);
              setAddingDimension(false);
            }
          }}
          options={uniqueDimensions.map((col) => ({
            label: col.name || col.column || "",
            value: col.column || "",
          }))}
          placeholder="Dimension column"
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
  editingDimensionLevels,
  addingDimension,
  setAddingDimension,
  setEditingDimensionLevels,
  updateDimensionLevel,
  removeDimensionLevel,
  saveEditing,
  cancelEditing,
  metricsWithDimensions,
}: {
  editingDimensionLevels: DimensionLevel[];
  addingDimension: boolean;
  setAddingDimension: (value: boolean) => void;
  setEditingDimensionLevels: (value: DimensionLevel[]) => void;
  updateDimensionLevel: (
    index: number,
    field: "dimension" | "level",
    value: string,
  ) => void;
  removeDimensionLevel: (index: number) => void;
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
        {editingDimensionLevels.map((dimensionLevel, levelIndex) => {
          // Build the same dimension map with unioned levels
          const dimensionMap = new Map<
            string,
            { name: string; levels: string[] }
          >();

          metricsWithDimensions.forEach((metric) => {
            (metric.dimensionColumns || []).forEach((col) => {
              if (!col.isDimension || col.column !== dimensionLevel.dimension)
                return;

              const existing = dimensionMap.get(col.column);
              if (existing) {
                // UNION the levels from this metric with existing levels
                col.dimensionLevels?.forEach((level) => {
                  if (!existing.levels.includes(level)) {
                    existing.levels.push(level);
                  }
                });
              } else {
                // Create new entry with levels from this metric
                dimensionMap.set(col.column, {
                  name: col.name || col.column || "",
                  levels: [...(col.dimensionLevels || [])],
                });
              }
            });
          });

          const dimensionColumn = dimensionMap.get(dimensionLevel.dimension);
          const availableLevels = dimensionColumn?.levels.sort() || [];

          return (
            <div
              key={levelIndex}
              className="border rounded d-flex align-items-center bg-white"
            >
              <span className="px-2 font-weight-medium">
                {dimensionColumn?.name || dimensionLevel.dimension}:
              </span>
              <SelectField
                value={dimensionLevel.levels[0] || ""}
                onChange={(value) =>
                  updateDimensionLevel(levelIndex, "level", value)
                }
                options={availableLevels.map((level) => ({
                  label: level,
                  value: level,
                }))}
                className="mb-0"
                style={{ minWidth: "120px" }}
                createable
                placeholder=""
                autoFocus={!dimensionLevel.levels[0]}
              />
              <button
                type="button"
                className="btn btn-link p-0 ml-1 text-muted"
                onClick={() => removeDimensionLevel(levelIndex)}
              >
                <FaTimes />
              </button>
            </div>
          );
        })}

        <DimensionSelector
          editingDimensionLevels={editingDimensionLevels}
          addingDimension={addingDimension}
          setAddingDimension={setAddingDimension}
          setEditingDimensionLevels={setEditingDimensionLevels}
          metricsWithDimensions={metricsWithDimensions}
        />
      </div>

      <div className="d-flex align-items-center" style={{ gap: "0.5rem" }}>
        <Button
          size="xs"
          onClick={saveEditing}
          disabled={
            editingDimensionLevels.length === 0 ||
            editingDimensionLevels.some(
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
