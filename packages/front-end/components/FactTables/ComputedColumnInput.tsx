import { Box, Flex } from "@radix-ui/themes";
import {
  ComputedColumn,
  ComputedColumnOperand,
  ComputedColumnStringPart,
  ComputedColumnTerm,
  FactTableInterface,
  NumericComputedColumn,
  StringComputedColumn,
} from "shared/types/fact-table";
import { PiPlus, PiX } from "react-icons/pi";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
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
function newTerm(): ComputedColumnTerm {
  return { operands: [newOperand()], operators: [] };
}
function newStringPart(): ComputedColumnStringPart {
  return { type: "column", column: "" };
}
function newNumericComputedColumn(): NumericComputedColumn {
  return {
    id: genId(),
    name: "",
    kind: "number",
    terms: [newTerm()],
    termOperators: [],
  };
}
function newStringComputedColumn(): StringComputedColumn {
  return { id: genId(), name: "", kind: "string", parts: [newStringPart()] };
}

// Numeric columns (and numeric JSON fields) usable as operands.
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

// String columns (and string JSON fields) usable as concat parts.
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

const MULTIPLICATIVE_OPERATORS: SingleValue[] = [
  { label: "×", value: "*" },
  { label: "÷", value: "/" },
];
const ADDITIVE_OPERATORS: SingleValue[] = [
  { label: "+", value: "+" },
  { label: "−", value: "-" },
];

function OperandEditor({
  operand,
  columnOptions,
  onChange,
  onRemove,
  canRemove,
}: {
  operand: ComputedColumnOperand;
  columnOptions: SingleValue[];
  onChange: (o: ComputedColumnOperand) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <Flex align="center" gap="1">
      <Box style={{ width: 110 }}>
        <SelectField
          value={operand.type}
          onChange={(v) =>
            onChange(
              v === "literal"
                ? { type: "literal", value: 0 }
                : { type: "column", column: "" },
            )
          }
          options={[
            { label: "Column", value: "column" },
            { label: "Number", value: "literal" },
          ]}
          sort={false}
        />
      </Box>
      {operand.type === "column" ? (
        <Box style={{ minWidth: 180 }}>
          <SelectField
            value={operand.column}
            onChange={(column) => onChange({ type: "column", column })}
            options={columnOptions}
            placeholder="Select column..."
            required
          />
        </Box>
      ) : (
        <Field
          type="number"
          step="any"
          value={operand.value}
          onChange={(e) =>
            onChange({ type: "literal", value: e.target.valueAsNumber || 0 })
          }
          style={{ maxWidth: 120 }}
        />
      )}
      {canRemove && (
        <Button variant="ghost" color="red" onClick={onRemove}>
          <PiX />
        </Button>
      )}
    </Flex>
  );
}

// Editor for a single term: operands combined with × / ÷.
function TermEditor({
  term,
  columnOptions,
  setTerm,
}: {
  term: ComputedColumnTerm;
  columnOptions: SingleValue[];
  setTerm: (t: ComputedColumnTerm) => void;
}) {
  const updateOperand = (i: number, operand: ComputedColumnOperand) => {
    const operands = [...term.operands];
    operands[i] = operand;
    setTerm({ ...term, operands });
  };
  const removeOperand = (i: number) => {
    const operands = [...term.operands];
    operands.splice(i, 1);
    const operators = [...term.operators];
    // The operator that joined this operand to the previous one is dropped.
    operators.splice(Math.max(0, i - 1), 1);
    setTerm({ ...term, operands, operators });
  };
  const addOperand = () => {
    setTerm({
      ...term,
      operands: [...term.operands, newOperand()],
      operators: [...term.operators, "*"],
    });
  };
  const setOperator = (i: number, op: "*" | "/") => {
    const operators = [...term.operators];
    operators[i] = op;
    setTerm({ ...term, operators });
  };

  return (
    <Box
      style={{
        border: "1px solid var(--slate-a4)",
        borderRadius: 6,
        padding: "8px",
      }}
    >
      <Flex direction="column" gap="2">
        {term.operands.map((operand, i) => (
          <Flex align="center" gap="1" key={i}>
            {i > 0 && (
              <Box style={{ width: 70 }}>
                <SelectField
                  value={term.operators[i - 1] || "*"}
                  onChange={(v) => setOperator(i - 1, v as "*" | "/")}
                  options={MULTIPLICATIVE_OPERATORS}
                  sort={false}
                />
              </Box>
            )}
            <OperandEditor
              operand={operand}
              columnOptions={columnOptions}
              onChange={(o) => updateOperand(i, o)}
              onRemove={() => removeOperand(i)}
              canRemove={term.operands.length > 1}
            />
          </Flex>
        ))}
      </Flex>
      <Box mt="2">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            addOperand();
          }}
        >
          <PiPlus /> Multiply / divide by another column
        </a>
      </Box>
    </Box>
  );
}

function NumericComputedColumnEditor({
  value,
  factTable,
  setValue,
}: {
  value: NumericComputedColumn;
  factTable: Pick<FactTableInterface, "columns" | "userIdTypes">;
  setValue: (v: NumericComputedColumn) => void;
}) {
  const columnOptions = getNumericColumnOptions(factTable);

  const setTerm = (i: number, term: ComputedColumnTerm) => {
    const terms = [...value.terms];
    terms[i] = term;
    setValue({ ...value, terms });
  };
  const removeTerm = (i: number) => {
    const terms = [...value.terms];
    terms.splice(i, 1);
    const termOperators = [...value.termOperators];
    termOperators.splice(Math.max(0, i - 1), 1);
    setValue({ ...value, terms, termOperators });
  };
  const addTerm = () => {
    setValue({
      ...value,
      terms: [...value.terms, newTerm()],
      termOperators: [...value.termOperators, "+"],
    });
  };
  const setTermOperator = (i: number, op: "+" | "-") => {
    const termOperators = [...value.termOperators];
    termOperators[i] = op;
    setValue({ ...value, termOperators });
  };

  return (
    <Flex direction="column" gap="2">
      {value.terms.map((term, i) => (
        <Flex direction="column" gap="2" key={i}>
          {i > 0 && (
            <Flex align="center" gap="2">
              <Box style={{ width: 70 }}>
                <SelectField
                  value={value.termOperators[i - 1] || "+"}
                  onChange={(v) => setTermOperator(i - 1, v as "+" | "-")}
                  options={ADDITIVE_OPERATORS}
                  sort={false}
                />
              </Box>
              {value.terms.length > 1 && (
                <Button
                  variant="ghost"
                  color="red"
                  onClick={() => removeTerm(i)}
                >
                  <PiX /> Remove term
                </Button>
              )}
            </Flex>
          )}
          <TermEditor
            term={term}
            columnOptions={columnOptions}
            setTerm={(t) => setTerm(i, t)}
          />
        </Flex>
      ))}
      <Box>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            addTerm();
          }}
        >
          <PiPlus /> Add / subtract another term
        </a>
      </Box>

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
  setValue,
}: {
  value: StringComputedColumn;
  factTable: Pick<FactTableInterface, "columns" | "userIdTypes">;
  setValue: (v: StringComputedColumn) => void;
}) {
  const columnOptions = getStringColumnOptions(factTable);

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
      {value.parts.map((part, i) => (
        <Flex align="center" gap="1" key={i}>
          {i > 0 && <Text size="small">+</Text>}
          <Box style={{ width: 110 }}>
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
            <Box style={{ minWidth: 180 }}>
              <SelectField
                value={part.column}
                onChange={(column) => updatePart(i, { type: "column", column })}
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
      <Flex gap="3">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            addPart(newStringPart());
          }}
        >
          <PiPlus /> Add column
        </a>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            addPart({ type: "literal", value: "" });
          }}
        >
          <PiPlus /> Add text
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
      <strong>Computed Columns</strong>
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
              setValue={(v) => updateColumn(i, v)}
            />
          ) : (
            <StringComputedColumnEditor
              value={column}
              factTable={factTable}
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
