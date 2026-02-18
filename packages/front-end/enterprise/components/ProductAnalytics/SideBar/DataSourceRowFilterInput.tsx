import { Flex } from "@radix-ui/themes";
import { RowFilter } from "shared/types/fact-table";
import { PiCaretDown, PiCaretUp, PiPlus, PiX } from "react-icons/pi";
import { useState } from "react";
import Collapsible from "react-collapsible";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import StringArrayField from "@/components/Forms/StringArrayField";
import Button from "@/ui/Button";
import {
  getAllowedOperators,
  NUMBER_PATTERN,
  operatorLabelMap,
  numberRegex,
} from "@/components/FactTables/RowFilterInput";

export type DataSourceRowFilterInputVariant = "default" | "compact";

export type ColumnTypesMap = Record<
  string,
  "string" | "number" | "date" | "boolean" | "other"
>;

function getColumnDatatype(
  columnTypes: ColumnTypesMap,
  column: string | undefined,
): ColumnTypesMap[string] | "" {
  if (!column || !(column in columnTypes)) return "";
  return columnTypes[column];
}

export function DataSourceRowFilterInput({
  value,
  setValue,
  columnTypes,
  variant = "default",
  hideAddButton = false,
}: {
  value: RowFilter[];
  setValue: (value: RowFilter[]) => void;
  columnTypes: ColumnTypesMap;
  variant?: DataSourceRowFilterInputVariant;
  hideAddButton?: boolean;
}) {
  const [rowDeleted, setRowDeleted] = useState(false);
  const [collapsedFilters, setCollapsedFilters] = useState<Set<number>>(
    new Set(),
  );
  const isCompact = variant === "compact";

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

  const columnOptions: SingleValue[] = Object.entries(columnTypes)
    .filter(([, datatype]) => datatype !== "date")
    .map(([col]) => ({ label: col, value: col }));

  return (
    <Flex direction="column" gap="2" width={isCompact ? "100%" : undefined}>
      {isCompact ? (
        value.length > 0 ? (
          <Text weight="medium">Filters</Text>
        ) : null
      ) : (
        <strong>Row Filter</strong>
      )}
      {value.map((filter, i) => {
        const optionsWithInvalid =
          filter.column && !columnOptions.find((o) => o.value === filter.column)
            ? [
                ...columnOptions,
                { label: `${filter.column} (Invalid)`, value: filter.column },
              ]
            : columnOptions;

        const firstSelectOptions: GroupedValue[] = [
          { label: "Columns", options: optionsWithInvalid },
          {
            label: "Other",
            options: [{ label: "SQL Expression", value: "$$sql_expr" }],
          },
        ];

        const operatorInputRequired = filter.operator !== "sql_expr";
        const firstSelectCompleted = !operatorInputRequired || !!filter.column;

        const operatorOptions: SingleValue[] = [];
        let inputType: "text" | "number" = "text";

        if (operatorInputRequired) {
          const datatype = getColumnDatatype(columnTypes, filter.column);
          const effectiveDatatype = datatype || "other";
          const allowedOperators = getAllowedOperators(effectiveDatatype);

          if (effectiveDatatype === "number") {
            inputType = "number";
          }

          let currentOperator = filter.operator;
          if (effectiveDatatype === "boolean" && currentOperator === "=") {
            currentOperator =
              filter.values?.[0] === "true" ? "is_true" : "is_false";
          }
          if (!allowedOperators.includes(currentOperator)) {
            allowedOperators.push(currentOperator);
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

        const updateRowFilter = (updates: Partial<RowFilter>) => {
          const newFilters = [...value];
          newFilters[i] = { ...filter, ...updates };
          setValue(newFilters);
        };

        const autoFocus = i === value.length - 1;

        const handleDeleteFilter = () => {
          const newFilters = [...value];
          newFilters.splice(i, 1);
          setValue(newFilters);
          setCollapsedFilters((prev) => {
            const next = new Set<number>();
            prev.forEach((idx) => {
              if (idx < i) next.add(idx);
              else if (idx > i) next.add(idx - 1);
            });
            return next;
          });
          setRowDeleted(!rowDeleted);
        };

        const columnSelect = (
          <SelectField
            value={
              filter.operator === "sql_expr"
                ? "$$sql_expr"
                : filter.column || ""
            }
            onChange={(v) => {
              if (v === "$$sql_expr") {
                updateRowFilter({ operator: "sql_expr", values: [] });
              } else {
                const datatype = getColumnDatatype(columnTypes, v);
                const allowed = getAllowedOperators(datatype || "other");
                let newOperator = filter.operator;
                let newValues = filter.values || [];
                if (!allowed.includes(newOperator)) {
                  newOperator = allowed[0];
                  newValues = [];
                }
                if (datatype === "number") {
                  newValues = newValues.filter((val) => numberRegex.test(val));
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
            placeholder={isCompact ? "Select column..." : "Filter by..."}
            required
          />
        );

        const operatorSelect = operatorInputRequired &&
          firstSelectCompleted && (
            <SelectField
              value={filter.operator}
              onChange={(v: RowFilter["operator"]) => {
                let newValues = filter.values || [];
                if (
                  ["in", "not_in"].includes(v) &&
                  !["in", "not_in"].includes(filter.operator)
                ) {
                  newValues = newValues.filter((val) => val !== "");
                }
                updateRowFilter({ operator: v, values: newValues });
              }}
              options={operatorOptions}
              sort={false}
              placeholder={isCompact ? "Select operator..." : undefined}
              required
            />
          );

        const valueInput = valueInputRequired && firstSelectCompleted && (
          <>
            {multiValueInput ? (
              <StringArrayField
                value={filter.values || []}
                onChange={(v) => updateRowFilter({ values: v })}
                delimiters={["Enter", "Tab"]}
                autoFocus={autoFocus}
                pattern={inputType === "number" ? NUMBER_PATTERN : undefined}
                required
              />
            ) : (
              <Field
                value={filter.values?.[0] ?? ""}
                onChange={(e) => {
                  const newValue = e.target.value;
                  if (inputType === "number" && newValue !== "") {
                    const isPartialValid = /^-?\.?$|^-?\d*\.?\d*$/.test(
                      newValue,
                    );
                    if (!isPartialValid) return;
                  }
                  updateRowFilter({ values: [newValue] });
                }}
                textarea={filter.operator === "sql_expr"}
                minRows={1}
                autoFocus={autoFocus}
                type={inputType === "number" ? "text" : inputType}
                inputMode={inputType === "number" ? "decimal" : undefined}
                required
              />
            )}
          </>
        );

        if (isCompact) {
          const isCollapsed = collapsedFilters.has(i);
          const getFilterSummary = () => {
            if (filter.operator === "sql_expr") {
              const sqlExprCount = value
                .slice(0, i + 1)
                .filter((f) => f.operator === "sql_expr").length;
              return `SQL Expression ${sqlExprCount}`;
            }
            if (!filter.column) return `Filter ${i + 1}`;
            const colName = filter.column;
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
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={handleDeleteFilter}
                  >
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
                  {columnSelect}
                  {operatorSelect}
                  {valueInput}
                </Flex>
              </Collapsible>
            </Flex>
          );
        }

        return (
          <Flex
            direction="row"
            gap="2"
            key={`${rowDeleted}-${i}`}
            align="center"
          >
            {i > 0 && <div>AND</div>}
            {columnSelect}
            {operatorSelect}
            {valueInput}
            <Button variant="ghost" color="red" onClick={handleDeleteFilter}>
              <PiX />
            </Button>
          </Flex>
        );
      })}
      {!hideAddButton &&
        (isCompact ? (
          <Button
            size="xs"
            variant="ghost"
            style={{ maxWidth: "fit-content" }}
            onClick={() => {
              setValue([...value, { column: "", operator: "=", values: [] }]);
            }}
          >
            <Flex align="center" gap="2">
              <PiPlus size={14} />
              Add Filter
            </Flex>
          </Button>
        ) : (
          <div>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setValue([
                  ...value,
                  { column: "", operator: "=", values: [""] },
                ]);
              }}
            >
              <PiPlus /> Add
            </a>
          </div>
        ))}
    </Flex>
  );
}
