import { Box, Flex } from "@radix-ui/themes";
import {
  ComputedColumn,
  ComputedColumnOperand,
  ComputedColumnStringPart,
  FactTableInterface,
  NumericComputedColumn,
  StringComputedColumn,
} from "shared/types/fact-table";
import { PiPlus, PiX } from "react-icons/pi";
import { getComputedColumnRef } from "shared/experiments";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

// A stable-enough client-side id for referencing a computed column via
// `$$computed:<id>`. Uniqueness only needs to hold within a single metric.
function genId(): string {
  return "cc_" + Math.random().toString(36).slice(2, 10);
}

function newOperand(): ComputedColumnOperand {
  return { type: "column", column: "" };
}
function newStringPart(): ComputedColumnStringPart {
  return { type: "column", column: "" };
}
function newNumericComputedColumn(): NumericComputedColumn {
  return {
    id: genId(),
    name: "",
    kind: "number",
    operands: [newOperand()],
    operators: [],
  };
}
function newStringComputedColumn(): StringComputedColumn {
  return { id: genId(), name: "", kind: "string", parts: [newStringPart()] };
}

function getNumericColumnOptions(
  factTable: Pick<FactTableInterface, "columns" | "userIdTypes">,
): SingleValue[] {
  const options: SingleValue[] = [];
  factTable.columns.forEach((col) => {
    if (col.deleted) return;
    if (factTable.userIdTypes?.includes(col.column)) return;
    if (col.datatype === "number") {
      options.push({ label: col.name || col.column, value: col.column });
    }
    if (col.jsonFields) {
      Object.entries(col.jsonFields).forEach(([field, data]) => {
        if (data.datatype === "number") {
          options.push({
            label: `${col.name || col.column}.${field}`,
            value: `${col.column}.${field}`,
          });
        }
      });
    }
  });
  return options;
}

function getStringColumnOptions(
  factTable: Pick<FactTableInterface, "columns" | "userIdTypes">,
): SingleValue[] {
  const options: SingleValue[] = [];
  factTable.columns.forEach((col) => {
    if (col.deleted) return;
    if (factTable.userIdTypes?.includes(col.column)) return;
    if (col.datatype === "string") {
      options.push({ label: col.name || col.column, value: col.column });
    }
    if (col.jsonFields) {
      Object.entries(col.jsonFields).forEach(([field, data]) => {
        if (data.datatype === "string") {
          options.push({
            label: `${col.name || col.column}.${field}`,
            value: `${col.column}.${field}`,
          });
        }
      });
    }
  });
  return options;
}

// Map already-defined computed columns to selectable `$$computed:<id>` options
// so a column can be built on top of an earlier one (e.g. `avg` then `avg * 100`).
function getComputedColumnOptions(
  priorColumns: ComputedColumn[],
  kind: "number" | "string",
): SingleValue[] {
  return priorColumns
    .filter((c) => c.kind === kind)
    .map((c) => ({
      label: c.name || "(unnamed)",
      value: getComputedColumnRef(c.id),
    }));
}

// Unified operator between two operands: + − × ÷.
const ARITHMETIC_OPERATORS: SingleValue[] = [
  { label: "+", value: "+" },
  { label: "−", value: "-" },
  { label: "×", value: "*" },
  { label: "÷", value: "/" },
];

// Sentinel option for "this operand is a literal number" — selecting it reveals
// a number input beside the dropdown.
const NUMBER_OPTION_VALUE = "$$number";

// A thin horizontal rule used to separate the columns from the "Number" option.
function OperandOptionDivider() {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border-color-200)",
        margin: "2px 0",
      }}
    />
  );
}

function NumericOperandInput({
  operand,
  columnOptions,
  onChange,
}: {
  operand: ComputedColumnOperand;
  columnOptions: SingleValue[];
  onChange: (o: ComputedColumnOperand) => void;
}) {
  const isLiteral = operand.type === "literal";
  // Columns (and earlier computed columns) on top, a divider, then "Number".
  const options: (SingleValue | GroupedValue)[] = [
    ...columnOptions,
    { label: "", options: [{ label: "Number", value: NUMBER_OPTION_VALUE }] },
  ];
  return (
    <Flex align="center" gap="2">
      <Box style={{ minWidth: 200 }}>
        <SelectField
          value={isLiteral ? NUMBER_OPTION_VALUE : operand.column}
          onChange={(v) =>
            onChange(
              v === NUMBER_OPTION_VALUE
                ? { type: "literal", value: isLiteral ? operand.value : 0 }
                : { type: "column", column: v },
            )
          }
          options={options}
          formatGroupLabel={() => <OperandOptionDivider />}
          placeholder="Select column or number..."
          sort={false}
          required
        />
      </Box>
      {isLiteral && (
        <Field
          type="number"
          step="any"
          value={operand.value}
          onChange={(e) =>
            onChange({ type: "literal", value: e.target.valueAsNumber || 0 })
          }
          style={{ maxWidth: 110, height: 38 }}
        />
      )}
    </Flex>
  );
}

function NumericComputedColumnEditor({
  value,
  factTable,
  priorColumns,
  setValue,
}: {
  value: NumericComputedColumn;
  factTable: Pick<FactTableInterface, "columns" | "userIdTypes">;
  priorColumns: ComputedColumn[];
  setValue: (v: NumericComputedColumn) => void;
}) {
  const columnOptions = [
    ...getNumericColumnOptions(factTable),
    ...getComputedColumnOptions(priorColumns, "number"),
  ];

  const updateOperand = (i: number, operand: ComputedColumnOperand) => {
    const operands = [...value.operands];
    operands[i] = operand;
    setValue({ ...value, operands });
  };
  const removeOperand = (i: number) => {
    const operands = [...value.operands];
    operands.splice(i, 1);
    const operators = [...value.operators];
    operators.splice(Math.max(0, i - 1), 1);
    setValue({ ...value, operands, operators });
  };
  const addOperand = () => {
    setValue({
      ...value,
      operands: [...value.operands, newOperand()],
      operators: [...value.operators, "+"],
    });
  };
  const setOperator = (i: number, op: string) => {
    const operators = [...value.operators];
    operators[i] = op as "+" | "-" | "*" | "/";
    setValue({ ...value, operators });
  };

  return (
    <Flex direction="column" gap="3">
      {/* Flat formula row: operand [op] operand [op] operand ... */}
      <Flex align="center" gap="2" wrap="wrap">
        {value.operands.map((operand, i) => (
          <Flex align="center" gap="2" key={i} wrap="wrap">
            {i > 0 && (
              <Box style={{ width: 64 }}>
                <SelectField
                  value={value.operators[i - 1] || "+"}
                  onChange={(v) => setOperator(i - 1, v)}
                  options={ARITHMETIC_OPERATORS}
                  sort={false}
                />
              </Box>
            )}
            <NumericOperandInput
              operand={operand}
              columnOptions={columnOptions}
              onChange={(o) => updateOperand(i, o)}
            />
            {value.operands.length > 1 && (
              <Button
                variant="ghost"
                color="red"
                onClick={() => removeOperand(i)}
              >
                <PiX />
              </Button>
            )}
          </Flex>
        ))}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            addOperand();
          }}
        >
          <PiPlus /> Add
        </a>
      </Flex>
      <Text size="small" color="text-low">
        × and ÷ are calculated before + and −.
      </Text>

      <Flex align="center" gap="3" wrap="wrap">
        <Checkbox
          label="Treat nulls as 0"
          value={!!value.coalesceZero}
          setValue={(v) => setValue({ ...value, coalesceZero: v })}
        />
        <Flex align="center" gap="2">
          <Text size="small">Rounding</Text>
          <Box style={{ width: 130 }}>
            <SelectField
              value={value.rounding?.mode || ""}
              onChange={(v) =>
                setValue({
                  ...value,
                  rounding: v
                    ? {
                        mode: v as "round" | "floor" | "ceil",
                        decimals: value.rounding?.decimals ?? 2,
                      }
                    : undefined,
                })
              }
              options={[
                { label: "None", value: "" },
                { label: "Round", value: "round" },
                { label: "Floor", value: "floor" },
                { label: "Ceiling", value: "ceil" },
              ]}
              sort={false}
            />
          </Box>
          {value.rounding && (
            <Field
              type="number"
              min={0}
              max={10}
              value={value.rounding.decimals ?? 2}
              onChange={(e) =>
                setValue({
                  ...value,
                  rounding: {
                    mode: value.rounding?.mode || "round",
                    decimals: Math.max(
                      0,
                      Math.min(10, e.target.valueAsNumber || 0),
                    ),
                  },
                })
              }
              prepend="decimals"
              style={{ maxWidth: 80 }}
            />
          )}
        </Flex>
      </Flex>
    </Flex>
  );
}

function StringComputedColumnEditor({
  value,
  factTable,
  priorColumns,
  setValue,
}: {
  value: StringComputedColumn;
  factTable: Pick<FactTableInterface, "columns" | "userIdTypes">;
  priorColumns: ComputedColumn[];
  setValue: (v: StringComputedColumn) => void;
}) {
  const columnOptions = [
    ...getStringColumnOptions(factTable),
    ...getComputedColumnOptions(priorColumns, "string"),
  ];

  const updatePart = (i: number, part: ComputedColumnStringPart) => {
    const parts = [...value.parts];
    parts[i] = part;
    setValue({ ...value, parts });
  };
  const removePart = (i: number) => {
    const parts = [...value.parts];
    parts.splice(i, 1);
    setValue({ ...value, parts });
  };
  const addPart = (part: ComputedColumnStringPart) => {
    setValue({ ...value, parts: [...value.parts, part] });
  };

  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2" wrap="wrap">
        {value.parts.map((part, i) => (
          <Flex align="center" gap="2" key={i} wrap="wrap">
            {i > 0 && <Text size="small">+</Text>}
            <Box style={{ width: 104 }}>
              <SelectField
                value={part.type}
                onChange={(v) =>
                  updatePart(
                    i,
                    v === "literal"
                      ? { type: "literal", value: "" }
                      : { type: "column", column: "" },
                  )
                }
                options={[
                  { label: "Column", value: "column" },
                  { label: "Text", value: "literal" },
                ]}
                sort={false}
              />
            </Box>
            {part.type === "column" ? (
              <Box style={{ minWidth: 170 }}>
                <SelectField
                  value={part.column}
                  onChange={(column) =>
                    updatePart(i, { type: "column", column })
                  }
                  options={columnOptions}
                  placeholder="Select column..."
                  required
                />
              </Box>
            ) : (
              <Field
                value={part.value}
                onChange={(e) =>
                  updatePart(i, { type: "literal", value: e.target.value })
                }
                placeholder="text..."
              />
            )}
            {value.parts.length > 1 && (
              <Button variant="ghost" color="red" onClick={() => removePart(i)}>
                <PiX />
              </Button>
            )}
          </Flex>
        ))}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            addPart(newStringPart());
          }}
        >
          <PiPlus /> Column
        </a>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            addPart({ type: "literal", value: "" });
          }}
        >
          <PiPlus /> Text
        </a>
      </Flex>
    </Flex>
  );
}

export function ComputedColumnInput({
  value,
  setValue,
  factTable,
}: {
  value: ComputedColumn[];
  setValue: (value: ComputedColumn[]) => void;
  factTable: Pick<FactTableInterface, "columns" | "userIdTypes">;
}) {
  const updateColumn = (i: number, column: ComputedColumn) => {
    const next = [...value];
    next[i] = column;
    setValue(next);
  };
  const removeColumn = (i: number) => {
    const next = [...value];
    next.splice(i, 1);
    setValue(next);
  };

  return (
    <Flex direction="column" gap="2">
      {value.map((column, i) => (
        <Box
          key={column.id}
          className="appbox"
          p="3"
          mb="0"
          style={{ background: "var(--color-panel-solid)" }}
        >
          <Flex justify="between" align="start" gap="2">
            <Box style={{ flex: 1 }}>
              <Field
                label="Name"
                value={column.name}
                onChange={(e) =>
                  updateColumn(i, { ...column, name: e.target.value })
                }
                placeholder="e.g. revenue_per_item"
                required
                // Match the react-select control height (38px) so the Name input
                // and Type dropdown line up.
                style={{ height: 38 }}
              />
            </Box>
            <Box style={{ width: 140 }}>
              <SelectField
                label="Type"
                value={column.kind}
                onChange={(v) =>
                  updateColumn(
                    i,
                    v === "string"
                      ? {
                          ...newStringComputedColumn(),
                          id: column.id,
                          name: column.name,
                        }
                      : {
                          ...newNumericComputedColumn(),
                          id: column.id,
                          name: column.name,
                        },
                  )
                }
                options={[
                  { label: "Number", value: "number" },
                  { label: "String (concat)", value: "string" },
                ]}
                sort={false}
              />
            </Box>
            <Button
              variant="ghost"
              color="red"
              onClick={() => removeColumn(i)}
              mt="4"
            >
              <PiX />
            </Button>
          </Flex>

          {column.kind === "number" ? (
            <NumericComputedColumnEditor
              value={column}
              factTable={factTable}
              priorColumns={value.slice(0, i)}
              setValue={(v) => updateColumn(i, v)}
            />
          ) : (
            <StringComputedColumnEditor
              value={column}
              factTable={factTable}
              priorColumns={value.slice(0, i)}
              setValue={(v) => updateColumn(i, v)}
            />
          )}
        </Box>
      ))}
      <div>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setValue([...value, newNumericComputedColumn()]);
          }}
        >
          <PiPlus /> Add
        </a>
      </div>
    </Flex>
  );
}
