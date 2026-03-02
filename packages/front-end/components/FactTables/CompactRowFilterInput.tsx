import { Flex } from "@radix-ui/themes";
import { FactTableInterface, RowFilter } from "shared/types/fact-table";
import { PiCaretDown, PiCaretUp, PiPlus, PiX } from "react-icons/pi";
import { useState } from "react";
import Collapsible from "react-collapsible";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import StringArrayField from "@/components/Forms/StringArrayField";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import {
  NUMBER_PATTERN,
  numberRegex,
  getAllowedOperators,
  operatorLabelMap,
  getColumnInfo,
} from "./rowFilterUtils";
import { DeferredField } from "./DeferredField";

export function CompactRowFilterInput({
  value,
  setValue,
  factTable,
  hideAddButton = false,
  deferTextInputUpdates = false,
}: {
  value: RowFilter[];
  setValue: (value: RowFilter[]) => void;
  factTable: Pick<FactTableInterface, "columns" | "filters" | "userIdTypes">;
  hideAddButton?: boolean;
  /** When true, free-text filter values are held in local state and only committed on blur. Prevents parent re-renders on every keystroke. */
  deferTextInputUpdates?: boolean;
}) {
  const [rowDeleted, setRowDeleted] = useState(false);
  const [collapsedFilters, setCollapsedFilters] = useState<Set<number>>(
    new Set(),
  );

  const toggleFilterCollapsed = (index: number) => {
    setCollapsedFilters((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <Flex direction="column" gap="2" width="100%">
      {value.length > 0 ? <Text weight="medium">Filters</Text> : null}
      {value.map((filter, i) => {
        const columnOptions: SingleValue[] = [];

        factTable.columns.forEach((col) => {
          if (col.datatype === "date") return;
          if (factTable.userIdTypes?.includes(col.column)) return;
          if (col.deleted) return;

          columnOptions.push({
            label: col.name || col.column,
            value: col.column,
          });

          // Add JSON fields as separate options
          if (col.jsonFields) {
            Object.keys(col.jsonFields).forEach((field) => {
              columnOptions.push({
                label: `${col.name || col.column}.${field}`,
                value: `${col.column}.${field}`,
              });
            });
          }
        });
        if (
          filter.column &&
          !columnOptions.find((o) => o.value === filter.column)
        ) {
          columnOptions.push({
            label: `${filter.column} (Invalid)`,
            value: filter.column,
          });
        }
        const firstSelectOptions: GroupedValue[] = [
          {
            label: "Columns",
            options: columnOptions,
          },
          {
            label: "Other",
            options: [
              {
                label: "SQL Expression",
                value: "$$sql_expr",
              },
              ...(factTable.filters.length > 0 ||
              filter.operator === "saved_filter"
                ? [
                    {
                      label: "Saved Filter",
                      value: "$$saved_filter",
                    },
                  ]
                : []),
            ],
          },
        ];

        const operatorInputRequired =
          filter.operator !== "sql_expr" && filter.operator !== "saved_filter";

        const firstSelectCompleted = !operatorInputRequired || !!filter.column;

        const operatorOptions: SingleValue[] = [];
        const valueOptions: SingleValue[] = [];
        let allowCreatingNewOptions = true;

        if (filter.operator === "saved_filter") {
          allowCreatingNewOptions = false;
          valueOptions.push(
            ...factTable.filters.map((f) => ({
              label: f.name,
              value: f.id,
            })),
          );
          if (
            filter.values &&
            filter.values[0] &&
            !factTable.filters.find((f) => f.id === filter.values?.[0])
          ) {
            valueOptions.push({
              label: `${filter.values[0]} (Deleted)`,
              value: filter.values[0],
            });
          }
        }

        let inputType: "text" | "number" = "text";

        if (operatorInputRequired) {
          const { datatype, topValues } = getColumnInfo(
            factTable,
            filter.column,
          );

          const allowedOperators = getAllowedOperators(datatype);

          if (datatype === "number") {
            inputType = "number";
          }

          if (topValues) {
            topValues.forEach((v) => {
              if (v) {
                valueOptions.push({
                  label: v,
                  value: v,
                });
              }
            });
          }

          // For boolean columns, remap =true/false to is_true/is_false
          if (datatype === "boolean") {
            if (filter.operator === "=") {
              filter.operator =
                filter.values?.[0] === "true" ? "is_true" : "is_false";
            }
          }

          if (!allowedOperators.includes(filter.operator)) {
            allowedOperators.push(filter.operator);
          }

          operatorOptions.push(
            ...allowedOperators.map((op) => ({
              label: operatorLabelMap[op],
              value: op,
            })),
          );
        }

        const valueInputRequired = ![
          "is_true",
          "is_false",
          "is_null",
          "not_null",
        ].includes(filter.operator);

        const multiValueInput = ["in", "not_in"].includes(filter.operator);

        const useValueOptions =
          (valueOptions.length > 0 || !allowCreatingNewOptions) &&
          ["in", "not_in", "=", "!=", "saved_filter"].includes(filter.operator);

        // Make sure all current values are in the options
        if (useValueOptions) {
          filter.values?.forEach((v) => {
            if (v && !valueOptions.find((o) => o.value === v)) {
              valueOptions.push({
                label: v,
                value: v,
              });
            }
          });
        }

        const updateRowFilter = (updates: Partial<RowFilter>) => {
          const newFilters = [...value];
          newFilters[i] = {
            ...filter,
            ...updates,
          };
          setValue(newFilters);
        };

        // Only auto-focus if it's the last row
        const autoFocus = i === value.length - 1;

        const handleDeleteFilter = () => {
          const newFilters = [...value];
          newFilters.splice(i, 1);
          setValue(newFilters);
          // Adjust collapsed indices when a filter is deleted
          setCollapsedFilters((prev) => {
            const next = new Set<number>();
            prev.forEach((idx) => {
              if (idx < i) {
                next.add(idx);
              } else if (idx > i) {
                next.add(idx - 1);
              }
              // idx === i is deleted, so we don't add it
            });
            return next;
          });
          // We use index for key, so force a re-render to avoid issues
          setRowDeleted(!rowDeleted);
        };

        const isCollapsed = collapsedFilters.has(i);

        // Build a summary string for the filter
        const getFilterSummary = () => {
          if (filter.operator === "sql_expr") {
            // Count SQL expression filters up to and including this one
            const sqlExprCount = value
              .slice(0, i + 1)
              .filter((f) => f.operator === "sql_expr").length;
            return `SQL Expression ${sqlExprCount}`;
          }
          if (filter.operator === "saved_filter") {
            const savedFilter = factTable.filters.find(
              (f) => f.id === filter.values?.[0],
            );
            return savedFilter ? savedFilter.name : "Saved Filter";
          }
          if (!filter.column) {
            return `Filter ${i + 1}`;
          }
          const col = factTable.columns.find((c) => c.column === filter.column);
          const colName = col?.name || filter.column;
          return `${colName} ${filter.operator} ${filter.values?.join(", ") || ""}`;
        };

        return (
          <Flex
            key={`${rowDeleted}-${i}`}
            direction="column"
            style={{
              border: "1px solid var(--gray-a3)",
              borderRadius: "var(--radius-3)",
              padding: "var(--space-2)",
              backgroundColor: "var(--color-panel-translucent)",
              opacity: filter.disabled ? 0.5 : 1,
            }}
          >
            <Flex justify="between" align="center" width="100%" gap="2">
              <Text
                size="small"
                truncate
                whiteSpace="nowrap"
                title={getFilterSummary()}
              >
                {getFilterSummary()}
              </Text>
              <Flex align="center" gap="1" style={{ flexShrink: 0 }}>
                <Switch
                  value={!filter.disabled}
                  onChange={(v) => {
                    updateRowFilter({ disabled: !v });
                  }}
                />
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => toggleFilterCollapsed(i)}
                  style={{ padding: 2 }}
                >
                  {isCollapsed ? (
                    <PiCaretDown size={14} />
                  ) : (
                    <PiCaretUp size={14} />
                  )}
                </Button>
                <Button size="xs" variant="ghost" onClick={handleDeleteFilter}>
                  <PiX size={14} />
                </Button>
              </Flex>
            </Flex>
            <Collapsible
              open={!isCollapsed}
              trigger=""
              triggerDisabled
              transitionTime={100}
            >
              <Flex direction="column" gap="2" mt="2">
                <SelectField
                  value={
                    filter.operator === "sql_expr"
                      ? "$$sql_expr"
                      : filter.operator === "saved_filter"
                        ? "$$saved_filter"
                        : filter.column || ""
                  }
                  onChange={(v) => {
                    if (v === "$$sql_expr") {
                      updateRowFilter({
                        operator: "sql_expr",
                        values: [],
                      });
                    } else if (v === "$$saved_filter") {
                      updateRowFilter({
                        operator: "saved_filter",
                        values: [],
                      });
                    } else {
                      const { datatype } = getColumnInfo(factTable, v);

                      let newOperator = filter.operator;
                      let newValues = filter.values || [];

                      // If current operator is not valid for new datatype, reset it
                      const allowedOperators = getAllowedOperators(datatype);
                      if (!allowedOperators.includes(newOperator)) {
                        newOperator = allowedOperators[0];
                        newValues = [];
                      }

                      if (datatype === "number") {
                        // If changing to number, remove any non-number values
                        newValues = newValues.filter((v) =>
                          numberRegex.test(v),
                        );
                      }

                      updateRowFilter({
                        operator: newOperator,
                        column: v,
                        values: newValues,
                      });
                    }
                  }}
                  options={firstSelectOptions}
                  autoFocus={autoFocus}
                  sort={false}
                  placeholder="Select column..."
                  required
                />
                {operatorInputRequired && firstSelectCompleted && (
                  <SelectField
                    value={filter.operator}
                    onChange={(v: RowFilter["operator"]) => {
                      let newValues = filter.values || [];

                      // If changing from a single-value to multi-value operator, remove empty strings
                      if (
                        ["in", "not_in"].includes(v) &&
                        !["in", "not_in"].includes(filter.operator)
                      ) {
                        newValues = newValues.filter((val) => val !== "");
                      }

                      updateRowFilter({
                        operator: v,
                        values: newValues,
                      });
                    }}
                    options={operatorOptions}
                    sort={false}
                    placeholder="Select operator..."
                    required
                  />
                )}
                {valueInputRequired && firstSelectCompleted && (
                  <>
                    {multiValueInput && useValueOptions ? (
                      <MultiSelectField
                        value={filter.values || []}
                        onChange={(v) => {
                          updateRowFilter({
                            values: v,
                          });
                        }}
                        options={valueOptions}
                        creatable={allowCreatingNewOptions}
                        sort={false}
                        autoFocus={autoFocus}
                        pattern={
                          inputType === "number" ? NUMBER_PATTERN : undefined
                        }
                        placeholder="Select values..."
                        required
                      />
                    ) : multiValueInput ? (
                      <StringArrayField
                        value={filter.values || []}
                        onChange={(v) => {
                          updateRowFilter({
                            values: v,
                          });
                        }}
                        delimiters={["Enter", "Tab"]}
                        autoFocus={autoFocus}
                        pattern={
                          inputType === "number" ? NUMBER_PATTERN : undefined
                        }
                        required
                      />
                    ) : useValueOptions ? (
                      <SelectField
                        value={filter.values?.[0] || ""}
                        onChange={(v) => {
                          updateRowFilter({
                            values: [v],
                          });
                        }}
                        options={valueOptions}
                        createable={allowCreatingNewOptions}
                        sort={false}
                        autoFocus={autoFocus}
                        pattern={
                          inputType === "number" ? NUMBER_PATTERN : undefined
                        }
                        placeholder="Select value..."
                        required
                      />
                    ) : deferTextInputUpdates ? (
                      <DeferredField
                        value={filter.values?.[0] || ""}
                        onCommit={(v) => updateRowFilter({ values: [v] })}
                        textarea={filter.operator === "sql_expr"}
                        minRows={1}
                        autoFocus={autoFocus}
                        type={inputType === "number" ? "text" : inputType}
                        inputMode={
                          inputType === "number" ? "decimal" : undefined
                        }
                        required
                      />
                    ) : (
                      <Field
                        value={filter.values?.[0] || ""}
                        onChange={(e) => {
                          const newValue = e.target.value;
                          // For numeric fields, only allow valid number input
                          if (inputType === "number" && newValue !== "") {
                            const isPartialValid = /^-?\.?$|^-?\d*\.?\d*$/.test(
                              newValue,
                            );
                            if (!isPartialValid) {
                              return;
                            }
                          }
                          updateRowFilter({
                            values: [newValue],
                          });
                        }}
                        textarea={filter.operator === "sql_expr"}
                        minRows={1}
                        autoFocus={autoFocus}
                        type={inputType === "number" ? "text" : inputType}
                        inputMode={
                          inputType === "number" ? "decimal" : undefined
                        }
                        required
                      />
                    )}
                  </>
                )}
              </Flex>
            </Collapsible>
          </Flex>
        );
      })}
      {!hideAddButton && (
        <Button
          size="xs"
          variant="ghost"
          style={{ maxWidth: "fit-content" }}
          onClick={() => {
            const newFilters = [...value];
            newFilters.push({
              column: "",
              operator: "=",
              values: [],
            });
            setValue(newFilters);
          }}
        >
          <Flex align="center" gap="2">
            <PiPlus size={14} />
            Add Filter
          </Flex>
        </Button>
      )}
    </Flex>
  );
}
