import { Flex } from "@radix-ui/themes";
import { FactTableInterface, RowFilter } from "back-end/types/fact-table";
import { PiPlus, PiX } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import StringArrayField from "@/components/Forms/StringArrayField";
import Button from "@/ui/Button";

export function RowFilterInput({
  value,
  setValue,
  factTable,
}: {
  value: RowFilter[];
  setValue: (value: RowFilter[]) => void;
  factTable: Pick<FactTableInterface, "columns" | "filters" | "userIdTypes">;
}) {
  if (!value.length) {
    return (
      <Button
        variant="soft"
        onClick={() => {
          setValue([
            {
              operator: "=",
              column: "",
              values: [],
            },
          ]);
        }}
      >
        Filter Rows
      </Button>
    );
  }

  return (
    <Flex direction="column" gap="2">
      {value.map((filter, i) => {
        const firstSelectOptions: SingleValue[] = [];

        factTable.columns.forEach((col) => {
          if (col.datatype === "date") return;
          if (factTable.userIdTypes?.includes(col.column)) return;
          if (col.deleted) return;

          firstSelectOptions.push({
            label: col.name || col.column,
            value: col.column,
          });

          // Add JSON fields as separate options
          if (col.jsonFields) {
            Object.keys(col.jsonFields).forEach((field) => {
              firstSelectOptions.push({
                label: `${col.name || col.column}.${field}`,
                value: `${col.column}.${field}`,
              });
            });
          }
        });
        if (
          filter.column &&
          !firstSelectOptions.find((o) => o.value === filter.column)
        ) {
          firstSelectOptions.push({
            label: `${filter.column} (Invalid)`,
            value: filter.column,
          });
        }
        firstSelectOptions.push({
          label: "SQL Expression",
          value: "$$sql_expr",
        });
        if (
          factTable.filters.length > 0 ||
          filter.operator === "saved_filter"
        ) {
          firstSelectOptions.push({
            label: "Saved Filter",
            value: "$$saved_filter",
          });
        }

        const operatorInputRequired =
          filter.operator !== "sql_expr" && filter.operator !== "saved_filter";

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

        if (operatorInputRequired) {
          const operatorLabelMap: Record<RowFilter["operator"], string> = {
            "=": "=",
            "!=": "!=",
            "<": "<",
            "<=": "<=",
            ">": ">",
            ">=": ">=",
            in: "in",
            not_in: "not in",
            is_true: "is true",
            is_false: "is false",
            is_null: "is null",
            not_null: "is not null",
            sql_expr: "SQL Expression",
            saved_filter: "Saved Filter",
            contains: "contains",
            not_contains: "not contains",
            starts_with: "starts with",
            ends_with: "ends with",
          };

          const allowedOperators: RowFilter["operator"][] = [];

          const { datatype, topValues } = (() => {
            if (!filter.column) {
              return { datatype: "" as const, topValues: [] as string[] };
            }

            // First, look for exact match
            const column = factTable.columns.find(
              (c) => c.column === filter.column,
            );
            if (column) {
              return {
                datatype: column.datatype,
                topValues: column.topValues || [],
              };
            }

            // Next, look for JSON field match
            const [baseColumnName, jsonField] = filter.column.split(".", 2);
            const baseColumn = factTable.columns.find(
              (c) => c.column === baseColumnName,
            );
            if (
              baseColumn &&
              baseColumn.jsonFields &&
              jsonField &&
              baseColumn.jsonFields[jsonField]
            ) {
              return {
                datatype: baseColumn.jsonFields[jsonField].datatype,
                topValues: [],
              };
            }

            return { datatype: "" as const, topValues: [] as string[] };
          })();

          if (topValues) {
            valueOptions.push(
              ...topValues.map((v) => ({
                label: v,
                value: v,
              })),
            );
            filter.values?.forEach((v) => {
              if (!valueOptions.find((o) => o.value === v)) {
                valueOptions.push({
                  label: v,
                  value: v,
                });
              }
            });
          }

          if (datatype === "boolean") {
            allowedOperators.push("is_true", "is_false", "is_null", "not_null");
          } else if (datatype === "number") {
            allowedOperators.push(
              "=",
              "!=",
              "<",
              "<=",
              ">",
              ">=",
              "in",
              "not_in",
              "is_null",
              "not_null",
            );
          } else if (datatype === "string") {
            allowedOperators.push(
              "=",
              "!=",
              "in",
              "not_in",
              "starts_with",
              "ends_with",
              "contains",
              "not_contains",
              "is_null",
              "not_null",
            );
          } else {
            allowedOperators.push(
              "=",
              "!=",
              "in",
              "not_in",
              "is_null",
              "not_null",
            );
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

        const updateRowFilter = (updates: Partial<RowFilter>) => {
          const newFilters = [...value];
          newFilters[i] = {
            ...filter,
            ...updates,
          };
          setValue(newFilters);
        };

        return (
          <Flex direction="row" gap="2" key={i} align="center">
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
                  });
                } else if (v === "$$saved_filter") {
                  updateRowFilter({
                    operator: "saved_filter",
                  });
                } else {
                  updateRowFilter({
                    column: v,
                  });
                }
              }}
              options={firstSelectOptions}
              autoFocus={i === value.length - 1}
            />
            {operatorInputRequired && (
              <SelectField
                value={filter.operator}
                onChange={(v: RowFilter["operator"]) => {
                  updateRowFilter({
                    operator: v,
                  });
                }}
                options={operatorOptions}
              />
            )}
            {valueInputRequired && (
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
                  />
                ) : (
                  <Field
                    value={filter.values?.[0] || ""}
                    onChange={(e) => {
                      updateRowFilter({
                        values: [e.target.value],
                      });
                    }}
                    textarea={filter.operator === "sql_expr"}
                    minRows={1}
                  />
                )}
              </>
            )}
            <Button
              variant="ghost"
              color="red"
              onClick={() => {
                const newFilters = [...value];
                newFilters.splice(i, 1);
                setValue(newFilters);
              }}
            >
              <PiX />
            </Button>
          </Flex>
        );
      })}
      <Button
        variant="soft"
        onClick={() => {
          const newFilters = [...value];
          newFilters.push({
            column: "",
            operator: "=",
            values: [""],
          });
          setValue(newFilters);
        }}
      >
        <PiPlus /> Row Filter
      </Button>
    </Flex>
  );
}
