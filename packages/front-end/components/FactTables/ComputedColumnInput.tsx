import { Box, Flex } from "@radix-ui/themes";
import {
  ComputedColumn,
  ComputedColumnOperand,
  ComputedColumnStringPart,
  FactTableInterface,
  NumericComputedColumn,
  StringComputedColumn,
  StringComputedColumnOperation,
} from "shared/types/fact-table";
import { PiPlus, PiX } from "react-icons/pi";
import {
  getComputedColumnRef,
  dataSourceSupportsRegexp,
} from "shared/experiments";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import styles from "./ComputedColumnInput.module.scss";

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

function newStringOperation(
  type: StringComputedColumnOperation["type"],
): StringComputedColumnOperation {
  switch (type) {
    case "replace":
      return { type: "replace", find: "", replaceWith: "" };
    case "regexpReplace":
      return { type: "regexpReplace", pattern: "", replaceWith: "" };
    case "regexpExtract":
      return { type: "regexpExtract", pattern: "" };
    case "upper":
      return { type: "upper" };
    case "lower":
      return { type: "lower" };
    case "trim":
      return { type: "trim" };
  }
}

// Options for the string-operation type dropdown. `regex` ops are filtered out
// for datasources that can't run regular expressions.
const STRING_OPERATION_OPTIONS: (SingleValue & { regex?: boolean })[] = [
  { label: "Replace text", value: "replace" },
  { label: "Replace (regex)", value: "regexpReplace", regex: true },
  { label: "Extract (regex)", value: "regexpExtract", regex: true },
  { label: "Uppercase", value: "upper" },
  { label: "Lowercase", value: "lower" },
  { label: "Trim whitespace", value: "trim" },
];

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
  // Two labeled sections: "Columns" (fact + earlier computed columns) and
  // "Static" (a literal number).
  const options: GroupedValue[] = [];
  if (columnOptions.length > 0) {
    options.push({ label: "Columns", options: columnOptions });
  }
  options.push({
    label: "Static",
    options: [{ label: "Number", value: NUMBER_OPTION_VALUE }],
  });
  return (
    <Flex align="center" gap="2">
      <Box style={{ minWidth: 100, width: "fit-content" }}>
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
          placeholder="Column or number..."
          sort={false}
          required
          // The default focused-input style stretches the control to fill its
          // container (`1fr`); inside a fit-content wrapper that makes the
          // trigger jump wider when opened. Size the search input to its own
          // content instead so the trigger keeps its closed width.
          containerStyles={{
            input: (base) => ({
              ...base,
              gridTemplateColumns: "0 minmax(2px, min-content)",
            }),
          }}
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
          className={styles.numberInput}
          style={{ width: 50, height: 38 }}
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
  onRemove,
}: {
  value: NumericComputedColumn;
  factTable: Pick<FactTableInterface, "columns" | "userIdTypes">;
  priorColumns: ComputedColumn[];
  setValue: (v: NumericComputedColumn) => void;
  onRemove: () => void;
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
    // Removing the only operand leaves no logic — delete the whole computed
    // column instead of keeping an empty (invalid) formula.
    if (value.operands.length <= 1) {
      onRemove();
      return;
    }
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
          <div className={styles.operandBlock} key={i}>
            {i > 0 && (
              <Box style={{ width: 50 }}>
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
            <button
              type="button"
              className={styles.removeButton}
              aria-label="Remove operand"
              onClick={() => removeOperand(i)}
            >
              <PiX size={9} />
            </button>
          </div>
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

// Ordered list of string transforms applied after the concat (trim, replace,
// regex replace/extract, upper/lower). Regex ops are hidden when the datasource
// can't run regular expressions.
function StringOperationsEditor({
  operations,
  supportsRegexp,
  setOperations,
}: {
  operations: StringComputedColumnOperation[];
  supportsRegexp: boolean;
  setOperations: (ops: StringComputedColumnOperation[]) => void;
}) {
  const typeOptions = STRING_OPERATION_OPTIONS.filter(
    (o) => supportsRegexp || !o.regex,
  );

  const updateOp = (i: number, op: StringComputedColumnOperation) => {
    const next = [...operations];
    next[i] = op;
    setOperations(next);
  };
  const removeOp = (i: number) => {
    const next = [...operations];
    next.splice(i, 1);
    setOperations(next);
  };

  return (
    <Flex direction="column" gap="2">
      {operations.map((op, i) => (
        <Flex align="center" gap="2" key={i} wrap="wrap">
          <Box style={{ width: 160 }}>
            <SelectField
              value={op.type}
              onChange={(v) =>
                updateOp(
                  i,
                  newStringOperation(
                    v as StringComputedColumnOperation["type"],
                  ),
                )
              }
              options={typeOptions}
              sort={false}
            />
          </Box>
          {(op.type === "replace" || op.type === "regexpReplace") && (
            <>
              <Field
                value={op.type === "replace" ? op.find : op.pattern}
                onChange={(e) =>
                  updateOp(
                    i,
                    op.type === "replace"
                      ? { ...op, find: e.target.value }
                      : { ...op, pattern: e.target.value },
                  )
                }
                placeholder={op.type === "replace" ? "find" : "pattern"}
                style={{ maxWidth: 150 }}
              />
              <Text size="small" color="text-low">
                →
              </Text>
              <Field
                value={op.replaceWith}
                onChange={(e) =>
                  updateOp(i, { ...op, replaceWith: e.target.value })
                }
                placeholder="replace with"
                style={{ maxWidth: 150 }}
              />
            </>
          )}
          {op.type === "regexpExtract" && (
            <Field
              value={op.pattern}
              onChange={(e) => updateOp(i, { ...op, pattern: e.target.value })}
              placeholder="pattern"
              style={{ maxWidth: 200 }}
            />
          )}
          <Button
            variant="ghost"
            color="red"
            size="xs"
            aria-label="Remove transform"
            onClick={() => removeOp(i)}
          >
            <PiX />
          </Button>
        </Flex>
      ))}
      <div>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setOperations([...operations, newStringOperation("replace")]);
          }}
        >
          <PiPlus /> Add transform
        </a>
      </div>
    </Flex>
  );
}

// Sentinel option for "this part is a static text literal" — selecting it
// reveals a text input beside the dropdown (mirrors NUMBER_OPTION_VALUE).
const TEXT_OPTION_VALUE = "$$text";

function StringPartInput({
  part,
  columnOptions,
  onChange,
}: {
  part: ComputedColumnStringPart;
  columnOptions: SingleValue[];
  onChange: (p: ComputedColumnStringPart) => void;
}) {
  const isLiteral = part.type === "literal";
  const options: GroupedValue[] = [];
  if (columnOptions.length > 0) {
    options.push({ label: "Columns", options: columnOptions });
  }
  options.push({
    label: "Static",
    options: [{ label: "Static Text", value: TEXT_OPTION_VALUE }],
  });
  return (
    <Flex align="center" gap="2">
      <Box style={{ minWidth: 100, width: "fit-content" }}>
        <SelectField
          value={isLiteral ? TEXT_OPTION_VALUE : part.column}
          onChange={(v) =>
            onChange(
              v === TEXT_OPTION_VALUE
                ? { type: "literal", value: isLiteral ? part.value : "" }
                : { type: "column", column: v },
            )
          }
          options={options}
          placeholder="Column or text..."
          sort={false}
          required
          containerStyles={{
            input: (base) => ({
              ...base,
              gridTemplateColumns: "0 minmax(2px, min-content)",
            }),
          }}
        />
      </Box>
      {isLiteral && (
        <Field
          value={part.value}
          onChange={(e) => onChange({ type: "literal", value: e.target.value })}
          placeholder="text"
          style={{ maxWidth: 150, height: 38 }}
        />
      )}
    </Flex>
  );
}

function StringComputedColumnEditor({
  value,
  factTable,
  priorColumns,
  supportsRegexp,
  setValue,
  onRemove,
}: {
  value: StringComputedColumn;
  factTable: Pick<FactTableInterface, "columns" | "userIdTypes">;
  priorColumns: ComputedColumn[];
  supportsRegexp: boolean;
  setValue: (v: StringComputedColumn) => void;
  onRemove: () => void;
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
    // Removing the only part leaves nothing — delete the whole computed column.
    if (value.parts.length <= 1) {
      onRemove();
      return;
    }
    const parts = [...value.parts];
    parts.splice(i, 1);
    setValue({ ...value, parts });
  };
  const addPart = () => {
    setValue({ ...value, parts: [...value.parts, newStringPart()] });
  };

  return (
    <Flex direction="column" gap="2">
      {/* Concatenation: part [concat] part [concat] part ... */}
      <Flex align="center" gap="2" wrap="wrap">
        {value.parts.map((part, i) => (
          <div className={styles.operandBlock} key={i}>
            {i > 0 && (
              <Text size="small" color="text-low">
                concat
              </Text>
            )}
            <StringPartInput
              part={part}
              columnOptions={columnOptions}
              onChange={(p) => updatePart(i, p)}
            />
            <button
              type="button"
              className={styles.removeButton}
              aria-label="Remove part"
              onClick={() => removePart(i)}
            >
              <PiX size={9} />
            </button>
          </div>
        ))}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            addPart();
          }}
        >
          <PiPlus /> Add
        </a>
      </Flex>

      <Box mt="1">
        <Text size="small" color="text-low">
          Then transform (optional)
        </Text>
        <StringOperationsEditor
          operations={value.operations || []}
          supportsRegexp={supportsRegexp}
          setOperations={(ops) =>
            setValue({ ...value, operations: ops.length ? ops : undefined })
          }
        />
      </Box>
    </Flex>
  );
}

export function ComputedColumnInput({
  value,
  setValue,
  factTable,
  datasourceType,
}: {
  value: ComputedColumn[];
  setValue: (value: ComputedColumn[]) => void;
  factTable: Pick<FactTableInterface, "columns" | "userIdTypes">;
  // Datasource engine (e.g. "postgres"); gates regexp string operations.
  datasourceType?: string;
}) {
  const supportsRegexp = dataSourceSupportsRegexp(datasourceType);

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
                  { label: "String", value: "string" },
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
              onRemove={() => removeColumn(i)}
            />
          ) : (
            <StringComputedColumnEditor
              value={column}
              factTable={factTable}
              priorColumns={value.slice(0, i)}
              supportsRegexp={supportsRegexp}
              setValue={(v) => updateColumn(i, v)}
              onRemove={() => removeColumn(i)}
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
