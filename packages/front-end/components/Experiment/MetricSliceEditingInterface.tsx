import React from "react";
import { FaTimes } from "react-icons/fa";
import { PiX, PiStackBold } from "react-icons/pi";
import { Text, Flex, IconButton } from "@radix-ui/themes";
import { SliceLevelsData } from "shared/experiments";
import { FactMetricInterface } from "shared/types/fact-table";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";

export interface MetricWithStringColumns extends FactMetricInterface {
  stringColumns: Array<{
    column: string;
    name: string;
    datatype?: string;
    isAutoSliceColumn?: boolean;
    autoSlices?: string[];
    topValues?: string[];
  }>;
}

interface SliceSelectorProps {
  editingSliceLevels: SliceLevelsData[];
  addingSlice: boolean;
  setAddingSlice: (value: boolean) => void;
  setEditingSliceLevels: (value: SliceLevelsData[]) => void;
  metricsWithSlices: MetricWithStringColumns[];
  disabled?: boolean;
}

// Slice selector component for adding new slices
function SliceSelector({
  editingSliceLevels,
  addingSlice,
  setAddingSlice,
  setEditingSliceLevels,
  metricsWithSlices,
  disabled,
}: SliceSelectorProps) {
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
            if (value && !disabled) {
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
          disabled={disabled}
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
        if (!disabled) {
          setAddingSlice(true);
        }
      }}
      className="link-purple mx-1"
      style={{
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      + AND
    </a>
  ) : null;
}

export interface MetricSliceEditingInterfaceProps {
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
  disabled?: boolean;
}

// Main editing interface component
export function MetricSliceEditingInterface({
  editingSliceLevels,
  addingSlice,
  setAddingSlice,
  setEditingSliceLevels,
  updateSliceLevel,
  removeSliceLevel,
  saveEditing,
  cancelEditing,
  metricsWithSlices,
  disabled,
}: MetricSliceEditingInterfaceProps) {
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
                  disabled={disabled}
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
                  onClick={() => {
                    if (!disabled) {
                      removeSliceLevel(levelIndex);
                    }
                  }}
                  disabled={disabled}
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
                  disabled={disabled}
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
                  disabled={disabled}
                  className="mb-0"
                  style={{ width: "130px" }}
                  placeholder="Column value..."
                  autoFocus={!sliceLevel.levels[0]}
                />
              )}
              <button
                type="button"
                className="btn btn-link p-0 ml-1 text-muted"
                onClick={() => {
                  if (!disabled) {
                    removeSliceLevel(levelIndex);
                  }
                }}
                disabled={disabled}
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
          disabled={disabled}
        />
      </div>

      <div className="d-flex align-items-center" style={{ gap: "0.5rem" }}>
        <Button
          size="xs"
          onClick={saveEditing}
          disabled={
            disabled ||
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
          disabled={disabled}
        >
          <PiX />
        </IconButton>
      </div>
    </div>
  );
}
