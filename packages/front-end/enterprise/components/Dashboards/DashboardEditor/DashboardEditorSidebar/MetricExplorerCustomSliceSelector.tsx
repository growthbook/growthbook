import React, { useState, useMemo, useCallback } from "react";
import { FaPlusCircle } from "react-icons/fa";
import { PiPencilSimpleFill, PiX } from "react-icons/pi";
import { Text, Flex, IconButton } from "@radix-ui/themes";
import { isFactMetric, SliceLevelsData } from "shared/experiments";
import { FactMetricInterface } from "back-end/types/fact-table";
import { CustomMetricSlice } from "shared/validators";
import Badge from "@/ui/Badge";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  MetricSliceEditingInterface,
  MetricWithStringColumns,
} from "@/components/Experiment/MetricSliceEditingInterface";

export interface MetricExplorerCustomSliceSelectorProps {
  factMetricId: string;
  customMetricSlices: CustomMetricSlice[];
  setCustomMetricSlices: (slices: CustomMetricSlice[]) => void;
  disabled?: boolean;
}

export default function MetricExplorerCustomSliceSelector({
  factMetricId,
  customMetricSlices,
  setCustomMetricSlices,
  disabled = false,
}: MetricExplorerCustomSliceSelectorProps) {
  const [editState, setEditState] = useState<"adding" | "editing" | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingSliceLevels, setEditingSliceLevels] = useState<
    SliceLevelsData[]
  >([]);
  const [addingSlice, setAddingSlice] = useState(false);

  const { factMetrics, factTables } = useDefinitions();

  const metric = useMemo(
    () =>
      factMetrics.find((m) => m.id === factMetricId) as
        | FactMetricInterface
        | undefined,
    [factMetrics, factMetricId],
  );

  const factTable = useMemo(() => {
    if (!metric || !isFactMetric(metric)) return null;
    return (
      factTables.find((t) => t.id === metric.numerator?.factTableId) || null
    );
  }, [metric, factTables]);

  const metricWithStringColumns = useMemo(() => {
    if (!metric || !isFactMetric(metric) || !factTable) return null;

    const stringColumns = factTable.columns?.filter(
      (col) =>
        (col.datatype === "string" || col.datatype === "boolean") &&
        !col.deleted &&
        !factTable.userIdTypes.includes(col.column),
    );

    if (!stringColumns || stringColumns.length === 0) return null;

    return {
      ...metric,
      stringColumns: stringColumns.map((col) => ({
        column: col.column,
        name: col.name || col.column,
        datatype: col.datatype,
        isAutoSliceColumn: col.isAutoSliceColumn,
        autoSlices: col.autoSlices,
        topValues: col.topValues,
      })),
    } as MetricWithStringColumns;
  }, [metric, factTable]);

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
          // Look up datatype from metricWithStringColumns
          const columnMetadata = metricWithStringColumns?.stringColumns.find(
            (col) => col.column === s.column,
          );

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

    const newLevels: CustomMetricSlice = {
      slices: editingSliceLevels.map((dl) => ({
        column: dl.column,
        levels: dl.levels,
      })),
    };

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
    cancelEditing();
  };

  // Remove a metric slice levels entry
  const removeMetricSliceLevels = useCallback(
    (levelsIndex: number) => {
      const updatedLevels = customMetricSlices.filter(
        (_, i) => i !== levelsIndex,
      );
      setCustomMetricSlices(updatedLevels);
    },
    [customMetricSlices, setCustomMetricSlices],
  );

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
      const columnMetadata = metricWithStringColumns?.stringColumns.find(
        (col) => col.column === value,
      );

      newLevels[index] = {
        ...newLevels[index],
        column: value,
        datatype: columnMetadata?.datatype === "boolean" ? "boolean" : "string",
      };
    }
    setEditingSliceLevels(newLevels);
  };

  if (!metricWithStringColumns) {
    return null;
  }

  return (
    <div className="my-2">
      {customMetricSlices.map((levels, levelsIndex) => {
        const isEditing =
          editState === "editing" && editingIndex === levelsIndex;

        return (
          <div key={levelsIndex} className="appbox px-2 py-1 mb-2">
            {isEditing ? (
              <MetricSliceEditingInterface
                editingSliceLevels={editingSliceLevels}
                addingSlice={addingSlice}
                setAddingSlice={setAddingSlice}
                setEditingSliceLevels={setEditingSliceLevels}
                updateSliceLevel={updateSliceLevel}
                removeSliceLevel={removeSliceLevel}
                saveEditing={saveEditing}
                cancelEditing={cancelEditing}
                metricsWithSlices={[metricWithStringColumns]}
                disabled={disabled}
              />
            ) : (
              <div className="d-flex align-items-center">
                <div className="flex-grow-1">
                  <Flex gap="2" align="center">
                    {levels.slices.map((combo, comboIndex) => {
                      // Find the column datatype
                      const columnMetadata =
                        metricWithStringColumns.stringColumns.find(
                          (col) => col.column === combo.column,
                        );
                      const isBoolean = columnMetadata?.datatype === "boolean";

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
                      if (!disabled) {
                        startEditing(levelsIndex);
                      }
                    }}
                    disabled={disabled}
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
                      if (!disabled) {
                        removeMetricSliceLevels(levelsIndex);
                      }
                    }}
                    disabled={disabled}
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
          onClick={() => {
            if (!disabled) {
              startEditing(-1);
            }
          }}
          style={{
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <FaPlusCircle className="mr-1" />
          Add custom slice
        </a>
      ) : editState === "adding" ? (
        // Adding new entry
        <div className="appbox px-2 py-1 mb-2">
          <MetricSliceEditingInterface
            editingSliceLevels={editingSliceLevels}
            addingSlice={addingSlice}
            setAddingSlice={setAddingSlice}
            setEditingSliceLevels={setEditingSliceLevels}
            updateSliceLevel={updateSliceLevel}
            removeSliceLevel={removeSliceLevel}
            saveEditing={saveEditing}
            cancelEditing={cancelEditing}
            metricsWithSlices={[metricWithStringColumns]}
            disabled={disabled}
          />
        </div>
      ) : null}
    </div>
  );
}
