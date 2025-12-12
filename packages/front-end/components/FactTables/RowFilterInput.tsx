import { Flex } from "@radix-ui/themes";
import { FactTableInterface, RowFilter } from "back-end/types/fact-table";
import { PiPlus, PiX } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
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
  return (
    <Flex direction="column" gap="2">
      <strong>Row Filter</strong>
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

          const { datatype, topValues } = getColumnInfo(
            factTable,
            filter.column,
          );

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

        return (
          <Flex direction="row" gap="2" key={i} align="center">
            {i > 0 && <div>AND</div>}
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
              autoFocus={autoFocus}
              sort={false}
              placeholder="Filter by..."
              required
            />
            {operatorInputRequired && firstSelectCompleted && (
              <SelectField
                value={filter.operator}
                onChange={(v: RowFilter["operator"]) => {
                  updateRowFilter({
                    operator: v,
                  });
                }}
                options={operatorOptions}
                sort={false}
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
                    required
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
                    autoFocus={autoFocus}
                    required
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
      <div>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            const newFilters = [...value];
            newFilters.push({
              column: "",
              operator: "=",
              values: [""],
            });
            setValue(newFilters);
          }}
        >
          <PiPlus /> Add
        </a>
      </div>
    </Flex>
  );
}

function getColumnInfo(
  factTable: Pick<FactTableInterface, "columns">,
  column: string | undefined,
) {
  if (!column) {
    return { datatype: "" as const, topValues: [] as string[] };
  }

  // First, look for exact match
  const exactMatch = factTable.columns.find((c) => c.column === column);
  if (exactMatch) {
    return {
      datatype: exactMatch.datatype,
      topValues: exactMatch.topValues || [],
    };
  }

  // Next, look for JSON field match
  const [baseColumnName, jsonField] = column.split(".", 2);
  const baseColumnMatch = factTable.columns.find(
    (c) => c.column === baseColumnName,
  );
  if (
    baseColumnMatch &&
    baseColumnMatch.jsonFields &&
    jsonField &&
    baseColumnMatch.jsonFields[jsonField]
  ) {
    return {
      datatype: baseColumnMatch.jsonFields[jsonField].datatype,
      topValues: [],
    };
  }

  return { datatype: "" as const, topValues: [] as string[] };
}
