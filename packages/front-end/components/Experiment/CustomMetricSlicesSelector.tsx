import React, { ReactNode, useState, useMemo } from "react";
import clsx from "clsx";
import { PiPlus, PiX, PiStackBold, PiArrowSquareOut } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import {
  isFactMetric,
  expandMetricGroups,
  getFactMetricPrimaryFactTableId,
  SliceLevelsData,
} from "shared/experiments";
import { FactMetricInterface } from "shared/types/fact-table";
import { CustomMetricSlice } from "shared/validators";
import { StylesConfig } from "react-select";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { DocLink } from "@/components/DocLink";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import QuickEditButton, {
  editsOnClick,
  revealedByQuickEdit,
  revealsQuickEdit,
} from "@/components/Experiment/TabbedPage/QuickEditButton";

type MetricWithStringColumns = FactMetricInterface & {
  stringColumns: Array<{
    column: string;
    name: string;
    datatype?: string;
    isAutoSliceColumn?: boolean;
    autoSlices?: string[];
    topValues?: string[];
  }>;
};

export interface CustomMetricSlicesSelectorProps {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  customMetricSlices: CustomMetricSlice[];
  setCustomMetricSlices: (slices: CustomMetricSlice[]) => void;
  className?: string;
  // As a labelled setup row, rather than a block with its own label.
  asRow?: boolean;
  disabled?: boolean;
}

export default function CustomMetricSlicesSelector({
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  customMetricSlices,
  setCustomMetricSlices,
  className = "my-4",
  asRow = false,
  disabled = false,
}: CustomMetricSlicesSelectorProps) {
  const { hasCommercialFeature } = useUser();
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");

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
          ? factTableMap.get(getFactMetricPrimaryFactTableId(metric))
          : null;
        const hasColumns = !!factTable?.columns;
        return !!metric && isFactMetric(metric) && hasColumns;
      })
      .map((metric) => {
        const factTable = factTableMap.get(
          getFactMetricPrimaryFactTableId(metric!),
        );
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
  const removeMetricSliceLevels = (levelsIndex: number) => {
    const updatedLevels = customMetricSlices.filter(
      (_, i) => i !== levelsIndex,
    );
    setCustomMetricSlices(updatedLevels);
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
      {metricsWithStringColumns.length > 0 ? (
        <SlicesRow asRow={asRow}>
          <div className={asRow ? undefined : className}>
            {asRow ? null : (
              <label className="font-weight-bold mb-1">
                Custom Metric Slices
              </label>
            )}

            {disabled && !customMetricSlices.length ? (
              <Text color="text-mid">None</Text>
            ) : (
              <Text as="p" mb="2" color="text-mid">
                Define custom slices to analyze across all experiment metrics.{" "}
                <DocLink useRadix={false} docSection="customSlices">
                  Learn more <PiArrowSquareOut />
                </DocLink>
              </Text>
            )}

            {customMetricSlices.map((levels, levelsIndex) => {
              const isEditing =
                editState === "editing" && editingIndex === levelsIndex;

              return (
                <div key={levelsIndex} className="mb-2">
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
                    <Flex
                      align="center"
                      gap="3"
                      className={
                        disabled
                          ? undefined
                          : clsx(revealsQuickEdit, editsOnClick)
                      }
                      // Framed as a field only where it opens for editing.
                      style={
                        disabled
                          ? undefined
                          : {
                              ...MULTI_SELECT_FRAME,
                              minHeight: 36,
                              padding: "2px 2px 2px 8px",
                            }
                      }
                    >
                      <Flex gap="2" align="center" wrap="wrap" flexGrow="1">
                        {levels.slices.map((combo, comboIndex) => {
                          const columnMetadata = metricsWithStringColumns
                            .flatMap((metric) => metric.stringColumns || [])
                            .find((col) => col.column === combo.column);
                          const isBoolean =
                            columnMetadata?.datatype === "boolean";

                          return (
                            <React.Fragment key={comboIndex}>
                              {comboIndex > 0 && <Text size="sm">AND</Text>}
                              <Flex
                                align="center"
                                px="2"
                                style={{
                                  height: 24,
                                  background:
                                    "var(--form-multivalue-background-color)",
                                  borderRadius: "var(--radius-1)",
                                }}
                              >
                                <Text
                                  size="sm"
                                  weight="medium"
                                  color="text-high"
                                >
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
                              </Flex>
                            </React.Fragment>
                          );
                        })}
                      </Flex>
                      {disabled ? null : (
                        // Spaced as a field's own indicators are.
                        <Flex align="center" gap="1px">
                          <QuickEditButton
                            label="Edit custom slice"
                            onClick={() => startEditing(levelsIndex)}
                            labelTooltip={false}
                            fillsRow
                          />
                          <span className={revealedByQuickEdit}>
                            <button
                              type="button"
                              className="gb-field-indicator"
                              aria-label="Remove custom slice"
                              onClick={() =>
                                removeMetricSliceLevels(levelsIndex)
                              }
                            >
                              <PiX />
                            </button>
                          </span>
                        </Flex>
                      )}
                    </Flex>
                  )}
                </div>
              );
            })}

            {disabled ? null : editState === null ? (
              <Box mt="1">
                <Link onClick={() => startEditing(-1)}>
                  <PiPlus /> Add custom slice
                </Link>
              </Box>
            ) : editState === "adding" ? (
              // Adding new entry
              <div className="mb-2">
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
        </SlicesRow>
      ) : null}
    </>
  );
}

function SlicesRow({
  asRow,
  children,
}: {
  asRow: boolean;
  children: React.ReactNode;
}) {
  return asRow ? (
    <SetupFieldRow label="Custom slices" content="text">
      {children}
    </SetupFieldRow>
  ) : (
    <>{children}</>
  );
}

// A multi-select field's frame, around values that read as its values do.
const MULTI_SELECT_FRAME = {
  border: "1px solid var(--gray-a7)",
  borderRadius: "var(--radius-2)",
  background: "var(--color-surface)",
};

// A menu as wide as its options, not the narrower field it opens from.
const FIT_MENU: StylesConfig<SingleValue, boolean> = {
  menu: (base) => ({ ...base, width: "max-content", minWidth: "100%" }),
};

// As wide as its value, up to a limit, so focusing or opening it doesn't
// reflow the row; only a new value does.
function FitToValue({
  text,
  input = false,
  children,
}: {
  text: string;
  // A text input, with no dropdown arrow to leave room for.
  input?: boolean;
  children: ReactNode;
}) {
  return (
    <Box style={{ display: "inline-grid", minWidth: 72, maxWidth: 220 }}>
      <Box
        aria-hidden
        style={{
          gridArea: "1 / 1",
          height: 0,
          overflow: "hidden",
          visibility: "hidden",
          whiteSpace: "nowrap",
          fontSize: "var(--font-size-2)",
          paddingInline: input ? "12px" : "10px 40px",
        }}
      >
        {text}
      </Box>
      <Box style={{ gridArea: "1 / 1", width: 0, minWidth: "100%" }}>
        {children}
      </Box>
    </Box>
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
      <SelectField
        size="sm"
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
        style={{ width: 160 }}
        options={sortedSlices.map((col) => ({
          label: col.name || col.column || "",
          value: col.column || "",
        }))}
        formatOptionLabel={(option) => (
          <Flex align="center" gap="1">
            {autoSliceColumnMap.has(option.value) ? (
              <PiStackBold size={12} style={{ color: "var(--violet-11)" }} />
            ) : (
              <div style={{ width: 13 }} />
            )}
            <Text>{option.label}</Text>
          </Flex>
        )}
        placeholder="Column"
        className="mb-0"
        autoFocus
      />
    ) : null
  ) : shouldShowAndButton ? (
    <Link onClick={() => setAddingSlice(true)}>
      <PiPlus /> AND
    </Link>
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
    <Flex
      direction="column"
      gap="3"
      style={{ ...MULTI_SELECT_FRAME, padding: "8px" }}
    >
      <Flex align="center" gap="3" wrap="wrap">
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

          const name = sliceColumn.name || sliceLevel.column;
          const availableLevels = Array.from(sliceColumn.levels).sort();
          const value = sliceLevel.levels[0] || "";
          const valueInput =
            sliceColumn.datatype === "boolean" ? (
              <FitToValue text={value.toUpperCase() || "Select..."}>
                <SelectField
                  size="sm"
                  value={sliceLevel.levels[0] || ""}
                  onChange={(value) =>
                    updateSliceLevel(levelIndex, "level", value)
                  }
                  options={[
                    { label: "TRUE", value: "true" },
                    { label: "FALSE", value: "false" },
                    { label: "NULL", value: "null" },
                  ]}
                  className="mb-0"
                  placeholder="Select..."
                  autoFocus={!sliceLevel.levels[0]}
                  sort={false}
                  containerStyles={FIT_MENU}
                />
              </FitToValue>
            ) : availableLevels.length > 0 ? (
              <FitToValue text={value}>
                <SelectField
                  size="sm"
                  value={sliceLevel.levels[0] || ""}
                  onChange={(value) =>
                    updateSliceLevel(levelIndex, "level", value)
                  }
                  options={availableLevels.map((level) => ({
                    label: level,
                    value: level,
                  }))}
                  className="mb-0"
                  createable
                  placeholder=""
                  autoFocus={!sliceLevel.levels[0]}
                  sort={false}
                  containerStyles={FIT_MENU}
                />
              </FitToValue>
            ) : (
              <FitToValue text={value || "Column value..."} input>
                <Field
                  size="sm"
                  value={sliceLevel.levels[0] || ""}
                  onChange={(e) =>
                    updateSliceLevel(levelIndex, "level", e.target.value)
                  }
                  containerClassName="mb-0"
                  placeholder="Column value..."
                  autoFocus={!sliceLevel.levels[0]}
                />
              </FitToValue>
            );

          // AND wraps with its chip, so a line never ends on it.
          return (
            <Flex key={levelIndex} align="center" gap="3">
              {levelIndex > 0 ? <Text size="sm">AND</Text> : null}
              <Flex
                align="center"
                py="1"
                pl="2"
                pr="0"
                style={{
                  background: "var(--form-multivalue-background-color)",
                  borderRadius: "var(--radius-2)",
                }}
              >
                <Text weight="medium" mr="2">
                  {name}
                </Text>
                {valueInput}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  className="gb-multi-select__multi-value__remove"
                  onClick={() => removeSliceLevel(levelIndex)}
                  style={{
                    alignSelf: "stretch",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 4px",
                    border: 0,
                    borderRadius: 2,
                    background: "none",
                    color: "var(--slate-12)",
                  }}
                >
                  <PiX size={14} />
                </button>
              </Flex>
            </Flex>
          );
        })}

        <SliceSelector
          editingSliceLevels={editingSliceLevels}
          addingSlice={addingSlice}
          setAddingSlice={setAddingSlice}
          setEditingSliceLevels={setEditingSliceLevels}
          metricsWithSlices={metricsWithSlices}
        />
      </Flex>

      <Flex justify="end" align="center" gap="3">
        <Button size="sm" variant="ghost" onClick={cancelEditing}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={saveEditing}
          disabled={
            editingSliceLevels.length === 0 ||
            editingSliceLevels.some(
              (level) => !level.levels[0] || level.levels[0].trim() === "",
            )
          }
        >
          Done
        </Button>
      </Flex>
    </Flex>
  );
}
