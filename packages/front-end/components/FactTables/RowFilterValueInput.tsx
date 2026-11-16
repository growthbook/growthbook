import { RowFilter } from "shared/types/fact-table";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/ui/MultiSelectField";
import SelectField from "@/components/Forms/SelectField";
import StringArrayField from "@/ui/StringArrayField";
import {
  NUMBER_PATTERN,
  NUMBER_PARTIAL_PATTERN,
  type RowFilterInputState,
} from "./rowFilterUtils";
import { DateColumnFilterInput } from "./DateColumnFilterInput";

/**
 * The value half of a row filter: which input a filter gets is decided by its
 * operator and its column's datatype, identically everywhere row filters are
 * edited. Layout and commit timing are the caller's business — `commit` is
 * false while text is still being typed and true once it settles, which the
 * explorer uses to avoid re-running a warehouse query per keystroke.
 */
export function RowFilterValueInput({
  state,
  operator,
  values,
  onChange,
  autoFocus,
  dateInputWidth,
}: {
  state: RowFilterInputState;
  operator: RowFilter["operator"];
  values: string[] | undefined;
  onChange: (values: string[], commit: boolean) => void;
  autoFocus?: boolean;
  dateInputWidth?: number;
}) {
  const { inputType, isDateColumn, multiValueInput, useValueOptions } = state;
  const isSqlExpr = operator === "sql_expr";
  const numberPattern = inputType === "number" ? NUMBER_PATTERN : undefined;

  if (isDateColumn && !multiValueInput) {
    return (
      <DateColumnFilterInput
        operator={operator}
        values={values}
        onChange={(v) => onChange(v, true)}
        inputWidth={dateInputWidth}
      />
    );
  }

  if (multiValueInput) {
    return useValueOptions ? (
      <MultiSelectField
        size="md"
        value={values || []}
        onChange={(v) => onChange(v, true)}
        options={state.valueOptions}
        creatable
        sort={false}
        autoFocus={autoFocus}
        pattern={numberPattern}
        placeholder="Select values..."
        required
      />
    ) : (
      <StringArrayField
        size="md"
        value={values || []}
        onChange={(v) => onChange(v, true)}
        delimiters={["Enter", "Tab"]}
        autoFocus={autoFocus}
        pattern={numberPattern}
        required
      />
    );
  }

  if (useValueOptions) {
    return (
      <SelectField
        size="md"
        value={values?.[0] || ""}
        onChange={(v) => onChange([v], true)}
        options={state.valueOptions}
        createable
        sort={false}
        autoFocus={autoFocus}
        pattern={numberPattern}
        placeholder="Select value..."
        required
      />
    );
  }

  return (
    <Field
      size="md"
      value={values?.[0] || ""}
      onChange={(e) => {
        const v = e.target.value;
        // `type="number"` would reject a half-typed number outright, so this is
        // a text input that accepts the in-progress shapes and validates the
        // finished value with `pattern` instead.
        if (
          inputType === "number" &&
          v !== "" &&
          !NUMBER_PARTIAL_PATTERN.test(v)
        )
          return;
        onChange([v], false);
      }}
      onBlur={(e) => onChange([e.target.value], true)}
      onKeyDown={(e) => {
        // A SQL expression is a textarea, where Enter means newline.
        if (e.key !== "Enter" || isSqlExpr) return;
        e.preventDefault();
        const el = e.target as HTMLInputElement;
        onChange([el.value], true);
        el.blur();
      }}
      textarea={isSqlExpr}
      placeholder={isSqlExpr ? "SQL..." : undefined}
      minRows={1}
      autoFocus={autoFocus}
      type="text"
      inputMode={inputType === "number" ? "decimal" : undefined}
      pattern={numberPattern}
      required
    />
  );
}
