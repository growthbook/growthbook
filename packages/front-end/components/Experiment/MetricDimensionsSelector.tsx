import React, { useState, useMemo } from "react";
import {
  FaPlusCircle,
  FaMinusCircle,
  FaPencilAlt,
  FaTimes,
} from "react-icons/fa";
import { Text, Flex } from "@radix-ui/themes";
import {
  isFactMetric,
  generatePinnedDimensionKey,
  expandMetricGroups,
} from "shared/experiments";
import { useGrowthBook } from "@growthbook/growthbook-react";
import Badge from "@/ui/Badge";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";

export interface DimensionLevel {
  dimension: string;
  level: string;
}

export interface MetricDimensionLevels {
  metricId: string;
  dimensionLevels: DimensionLevel[];
}

export interface MetricDimensionsSelectorProps {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  customMetricDimensionLevels: MetricDimensionLevels[];
  setCustomMetricDimensionLevels: (levels: MetricDimensionLevels[]) => void;
  pinnedMetricDimensionLevels: string[];
  setPinnedMetricDimensionLevels: (levels: string[]) => void;
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
  const { getFactTableById } = useDefinitions();
  const growthbook = useGrowthBook();
  const { hasCommercialFeature } = useUser();

  // State for editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // null = not editing, -1 = adding new, >=0 = editing existing
  const [editingMetricId, setEditingMetricId] = useState("");
  const [editingDimensionLevels, setEditingDimensionLevels] = useState<
    DimensionLevel[]
  >([]);
  const [addingDimension, setAddingDimension] = useState(false);

  // Feature flags
  const hasMetricDimensionsFeature = growthbook?.isOn("metric-dimensions");

  // Get all metrics with dimension analysis enabled
  const { factMetrics, metricGroups } = useDefinitions();
  const allMetricIds = useMemo(() => {
    const rawMetricIds = [
      ...goalMetrics,
      ...secondaryMetrics,
      ...guardrailMetrics,
    ];
    const expandedMetricIds = expandMetricGroups(rawMetricIds, metricGroups);
    return [...new Set(expandedMetricIds)];
  }, [goalMetrics, secondaryMetrics, guardrailMetrics, metricGroups]);

  const metricsWithDimensions = useMemo(() => {
    return allMetricIds
      .map((id) => factMetrics.find((m) => m.id === id))
      .filter((metric) => {
        const factTable = metric
          ? getFactTableById(metric.numerator?.factTableId)
          : null;
        const hasColumns = !!factTable?.columns;
        return (
          !!metric &&
          isFactMetric(metric) &&
          !!metric.enableMetricDimensions &&
          hasColumns
        );
      })
      .map((metric) => {
        const factTable = getFactTableById(metric!.numerator?.factTableId);
        const dimensionColumns = factTable?.columns?.filter(
          (col) => col.isDimension,
        );
        return {
          ...metric!,
          dimensionColumns: dimensionColumns || [],
        };
      });
  }, [allMetricIds, factMetrics, getFactTableById]);

  // Update the parent state with new metric dimension levels
  const updateCustomMetricDimensionLevels = (
    newLevels: MetricDimensionLevels[],
  ) => {
    setCustomMetricDimensionLevels(newLevels);
  };

  // Start editing (either existing entry or new entry)
  const startEditing = (index: number) => {
    setEditingIndex(index);
    if (index === -1) {
      // Adding new entry
      setEditingMetricId("");
      setEditingDimensionLevels([]);
    } else {
      // Editing existing entry
      const levels = customMetricDimensionLevels[index];
      setEditingMetricId(levels.metricId);
      setEditingDimensionLevels(levels.dimensionLevels);
    }
    setAddingDimension(false);
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingIndex(null);
    setEditingMetricId("");
    setEditingDimensionLevels([]);
    setAddingDimension(false);
  };

  // Save editing changes
  const saveEditing = () => {
    if (!editingMetricId || editingDimensionLevels.length === 0) return;

    const newLevels: MetricDimensionLevels = {
      metricId: editingMetricId,
      dimensionLevels: editingDimensionLevels,
    };

    let updatedLevels: MetricDimensionLevels[];
    if (editingIndex === -1) {
      // Adding new entry
      updatedLevels = [...customMetricDimensionLevels, newLevels];
    } else {
      // Editing existing entry
      updatedLevels = [...customMetricDimensionLevels];
      updatedLevels[editingIndex as number] = newLevels;
    }

    updateCustomMetricDimensionLevels(updatedLevels);

    // Auto-pin custom dimension levels for all locations where the metric appears
    const generatePinnedKeys = (
      metricId: string,
      dimensionLevels: DimensionLevel[],
    ) => {
      const keys: string[] = [];
      const dimensionLevelsFormatted = dimensionLevels.map((dl) => ({
        column: dl.dimension,
        level: dl.level || null,
      }));

      if (goalMetrics.includes(metricId)) {
        keys.push(
          generatePinnedDimensionKey(
            metricId,
            dimensionLevelsFormatted,
            "goal",
          ),
        );
      }
      if (secondaryMetrics.includes(metricId)) {
        keys.push(
          generatePinnedDimensionKey(
            metricId,
            dimensionLevelsFormatted,
            "secondary",
          ),
        );
      }
      if (guardrailMetrics.includes(metricId)) {
        keys.push(
          generatePinnedDimensionKey(
            metricId,
            dimensionLevelsFormatted,
            "guardrail",
          ),
        );
      }
      return keys;
    };

    // Remove old pinned keys if editing existing levels
    let keysToRemove: string[] = [];
    if (editingIndex !== null && editingIndex >= 0) {
      const oldLevels = customMetricDimensionLevels[editingIndex as number];
      keysToRemove = generatePinnedKeys(
        oldLevels.metricId,
        oldLevels.dimensionLevels,
      );
    }

    // Add new pinned keys
    const newKeys = generatePinnedKeys(editingMetricId, editingDimensionLevels);

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

    // Auto-unpin custom dimension levels from all locations where the metric appears
    const generatePinnedKeys = (
      metricId: string,
      dimensionLevels: DimensionLevel[],
    ) => {
      const keys: string[] = [];
      const dimensionLevelsFormatted = dimensionLevels.map((dl) => ({
        column: dl.dimension,
        level: dl.level || null,
      }));

      if (goalMetrics.includes(metricId)) {
        keys.push(
          generatePinnedDimensionKey(
            metricId,
            dimensionLevelsFormatted,
            "goal",
          ),
        );
      }
      if (secondaryMetrics.includes(metricId)) {
        keys.push(
          generatePinnedDimensionKey(
            metricId,
            dimensionLevelsFormatted,
            "secondary",
          ),
        );
      }
      if (guardrailMetrics.includes(metricId)) {
        keys.push(
          generatePinnedDimensionKey(
            metricId,
            dimensionLevelsFormatted,
            "guardrail",
          ),
        );
      }
      return keys;
    };

    const keysToRemove = generatePinnedKeys(
      levelsToRemove.metricId,
      levelsToRemove.dimensionLevels,
    );

    setPinnedMetricDimensionLevels(
      pinnedMetricDimensionLevels.filter((key) => !keysToRemove.includes(key)),
    );
  };

  // Remove a dimension level from the current editing levels
  const removeDimensionLevel = (index: number) => {
    setEditingDimensionLevels(
      editingDimensionLevels.filter((_, i) => i !== index),
    );
  };

  // Update a dimension level in the current editing levels
  const updateDimensionLevel = (
    index: number,
    field: "dimension" | "level",
    value: string,
  ) => {
    const newLevels = [...editingDimensionLevels];
    newLevels[index] = { ...newLevels[index], [field]: value };
    setEditingDimensionLevels(newLevels);
  };

  // Render editing interface (shared between editing existing and adding new)
  const renderEditingInterface = () => (
    <div className="d-flex align-items-top" style={{ gap: "3rem" }}>
      <div
        className="flex-grow-1 d-flex flex-wrap align-items-center"
        style={{ gap: "0.5rem", minHeight: "40px" }}
      >
        {editingMetricId ? (
          <div className="d-flex align-items-center">
            <span className="font-weight-medium mr-2">
              {metricsWithDimensions.find((m) => m.id === editingMetricId)
                ?.name || editingMetricId}
              :
            </span>
          </div>
        ) : (
          <SelectField
            value={editingMetricId}
            onChange={setEditingMetricId}
            options={metricsWithDimensions.map((m) => ({
              label: m.name || "",
              value: m.id || "",
            }))}
            className="mb-0"
            style={{ minWidth: "200px" }}
            placeholder="Select metric..."
          />
        )}

        {editingDimensionLevels.map((dimensionLevel, levelIndex) => {
          const metricForEditing = metricsWithDimensions.find(
            (m) => m.id === editingMetricId,
          );
          if (!metricForEditing) return null;

          const dimensionColumn = metricForEditing.dimensionColumns.find(
            (col) => col.column === dimensionLevel.dimension,
          );
          const availableLevels = dimensionColumn?.dimensionLevels || [];

          return (
            <div
              key={levelIndex}
              className="border rounded d-flex align-items-center bg-white"
            >
              <span className="px-2 font-weight-medium">
                {dimensionColumn?.name ||
                  dimensionColumn?.column ||
                  dimensionLevel.dimension}
                :
              </span>
              <SelectField
                value={dimensionLevel.level}
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
                autoFocus={!dimensionLevel.level}
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

        {(() => {
          const metricForEditing = metricsWithDimensions.find(
            (m) => m.id === editingMetricId,
          );
          if (!metricForEditing) return null;

          const usedDimensions = new Set(
            editingDimensionLevels.map((dl) => dl.dimension),
          );
          const availableDimensions = metricForEditing.dimensionColumns.filter(
            (col) => !usedDimensions.has(col.column),
          );

          return availableDimensions.length > 0 ? (
            addingDimension ? (
              <div className="border rounded d-flex align-items-center bg-white">
                <SelectField
                  value=""
                  onChange={(value) => {
                    if (value) {
                      const newDimensionLevel: DimensionLevel = {
                        dimension: value,
                        level: "", // Start with empty level
                      };
                      setEditingDimensionLevels([
                        ...editingDimensionLevels,
                        newDimensionLevel,
                      ]);
                      setAddingDimension(false);
                    }
                  }}
                  options={availableDimensions.map((col) => ({
                    label: col.name || col.column || "",
                    value: col.column || "",
                  }))}
                  onBlur={() => setAddingDimension(false)}
                  className="mb-0"
                  autoFocus
                />
              </div>
            ) : (
              <a
                role="button"
                onClick={(e) => {
                  e.preventDefault();
                  setAddingDimension(true);
                }}
                className="link-purple mx-1"
              >
                {editingDimensionLevels.length === 0 ? "+ Dimension" : "+ AND"}
              </a>
            )
          ) : null;
        })()}
      </div>

      <div className="d-flex align-items-start pt-1" style={{ flexShrink: 0 }}>
        <button
          className="btn btn-primary btn-sm mr-2"
          type="button"
          onClick={saveEditing}
          disabled={
            !editingMetricId ||
            editingDimensionLevels.length === 0 ||
            editingDimensionLevels.some(
              (level) => !level.level || level.level.trim() === "",
            )
          }
          style={{ height: "auto", alignSelf: "flex-start" }}
        >
          Done
        </button>
        <button
          className="btn btn-link text-danger p-0"
          type="button"
          onClick={cancelEditing}
          style={{ height: "auto", alignSelf: "flex-start" }}
        >
          <FaMinusCircle />
        </button>
      </div>
    </div>
  );

  if (!hasCommercialFeature("metric-dimensions")) {
    // todo: handle this better
    return null;
  }

  return (
    <div className="form-group my-4">
      {/* Label with conditional premium tooltip */}
      {hasMetricDimensionsFeature ? (
        <label className="font-weight-bold mb-1">
          Additional Metric Dimension Breakdowns
        </label>
      ) : (
        <PremiumTooltip commercialFeature="metric-dimensions">
          <label className="font-weight-bold mb-1">
            Additional Metric Dimension Breakdowns
          </label>
        </PremiumTooltip>
      )}

      {/* Description text */}
      <Text
        as="p"
        size="2"
        style={{ color: "var(--color-text-mid)" }}
        className="mb-2"
      >
        Define specific dimension combinations to analyze beyond the standard
        dimension breakdowns.
      </Text>

      {/* Conditional alerts */}
      {!hasMetricDimensionsFeature && (
        <div className="alert alert-info">
          Additional metric dimension breakdowns require an enterprise license.
        </div>
      )}

      {hasMetricDimensionsFeature && metricsWithDimensions.length === 0 && (
        <div className="alert alert-info">
          No metrics with dimension analysis enabled found. Enable dimension
          analysis on your fact metrics first.
        </div>
      )}

      {/* Main content - only show if feature is enabled and metrics exist */}
      {hasMetricDimensionsFeature && metricsWithDimensions.length > 0 && (
        <>
          {/* List of submitted entries */}
          {customMetricDimensionLevels.map((levels, levelsIndex) => {
            const metric = metricsWithDimensions.find(
              (m) => m.id === levels.metricId,
            );
            if (!metric) return null;

            const isEditing = editingIndex === levelsIndex;

            return (
              <div key={levelsIndex} className="appbox px-2 py-1 mb-2">
                {isEditing ? (
                  renderEditingInterface()
                ) : (
                  // Display mode
                  <div className="d-flex align-items-center">
                    <div className="flex-grow-1">
                      <Flex gap="2" align="center">
                        <Text weight="medium">{metric.name}:</Text>
                        {levels.dimensionLevels.map((combo, comboIndex) => (
                          <React.Fragment key={comboIndex}>
                            {comboIndex > 0 && <Text size="1">AND</Text>}
                            <Badge
                              label={
                                <Text style={{ color: "var(--slate-12)" }}>
                                  {combo.dimension} = {combo.level}
                                </Text>
                              }
                              color="gray"
                            />
                          </React.Fragment>
                        ))}
                      </Flex>
                    </div>
                    <div className="d-flex align-items-center">
                      <button
                        className="btn btn-link text-primary p-0 mr-2"
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          startEditing(levelsIndex);
                        }}
                      >
                        <FaPencilAlt />
                      </button>
                      <button
                        className="btn btn-link text-danger p-0"
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          removeMetricDimensionLevels(levelsIndex);
                        }}
                      >
                        <FaMinusCircle />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Empty state message */}
          {customMetricDimensionLevels.length === 0 &&
            editingIndex === null && (
              <div className="font-italic text-muted mr-3">
                No custom dimension combinations defined.
              </div>
            )}

          {/* Add button or editing form */}
          {editingIndex === null ? (
            <div className="mt-3">
              <a
                role="button"
                onClick={(e) => {
                  e.preventDefault();
                  startEditing(-1);
                }}
                className="link-purple font-weight-bold"
              >
                <FaPlusCircle className="mr-1" />
                Add dimension breakdown
              </a>
            </div>
          ) : editingIndex === -1 ? (
            // Adding new entry
            <div className="appbox px-2 py-1 mb-2">
              {renderEditingInterface()}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
