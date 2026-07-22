import React, { useState } from "react";
import { SchemaField } from "shared/types/feature";
import { simpleSchemaFieldToJSONSchema } from "shared/util";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiCaretDownFill,
  PiCaretRightFill,
  PiPlus,
  PiTrash,
} from "react-icons/pi";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Field from "@/components/Forms/Field";
import CodeTextArea, {
  FIVE_LINES_HEIGHT,
} from "@/components/Forms/CodeTextArea";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import {
  FIELD_GRID_TEMPLATE,
  FIELD_TYPE_OPTIONS,
  JSON_SCHEMA_PRESETS,
  OTHER_TYPE_VALUE,
  PresetKey,
  fieldTypeSelectValue,
  fieldValueType,
  fieldIsNullable,
  normalizeField,
  presetKeyFromField,
  presetSchemaString,
  typeDefault,
} from "@/components/Configs/fieldSchema";

// Inline editor for creating or editing a field (editing locks the key). The
// simple surface and the raw JSON Schema surface both compile to a JSON Schema.
export default function FieldDefForm({
  initial,
  existingKeys,
  withValue = false,
  isNew = false,
  initialValue = "",
  initialNull = false,
  initialUndefined = false,
  constantContext,
  onCancel,
  onSave,
}: {
  initial: SchemaField;
  // Block duplicates against other field keys in scope.
  existingKeys: string[];
  // Offer a value input to set/override the field's value in the same step.
  withValue?: boolean;
  isNew?: boolean;
  initialValue?: string;
  initialNull?: boolean;
  // The field currently has no value; keep it unset unless the user sets one.
  initialUndefined?: boolean;
  constantContext?: { project?: string; excludeKeys?: string[] };
  onCancel: () => void;
  // `unset` = explicitly remove the field's value (distinct from "leave as-is").
  onSave: (
    field: SchemaField,
    value?: unknown,
    unset?: boolean,
  ) => void | Promise<void>;
}): React.ReactElement {
  // Normalize so a raw schema that's really a simple type opens in simple mode.
  // Pretty-print a raw schema once on open so imported/minified schemas show with
  // readable whitespace in the code editor (typing afterward is preserved as-is).
  const [field, setField] = useState<SchemaField>(() => {
    const nf = normalizeField(initial);
    if (nf.jsonSchema === undefined) return nf;
    try {
      return {
        ...nf,
        jsonSchema: JSON.stringify(JSON.parse(nf.jsonSchema), null, 2),
      };
    } catch {
      return nf;
    }
  });
  const [valueText, setValueText] = useState(initialValue);
  const [valueIsNull, setValueIsNull] = useState(initialNull);
  const [valueIsUndefined, setValueIsUndefined] = useState(initialUndefined);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A raw schema can still resolve to a simple value surface (e.g. {type:string}).
  const isJson = field.jsonSchema !== undefined;
  const valueType = fieldValueType(field);
  const valueIsJson = valueType === "json";
  const preset = presetKeyFromField(field);
  const [rawMode, setRawMode] = useState(isJson && preset === null);
  const advanced = rawMode;

  const hasBound = field.min !== undefined || field.max !== undefined;
  const [showValidation, setShowValidation] = useState(hasBound);
  const [showEnum, setShowEnum] = useState(field.enum.length > 0);

  // Expand when an existing field already has extra definition to show.
  const [configureOpen, setConfigureOpen] = useState(
    !isNew &&
      (isJson ||
        !!field.description ||
        field.nullable === true ||
        hasBound ||
        field.enum.length > 0),
  );

  const trimmedKey = field.key.trim();
  const duplicate =
    trimmedKey !== initial.key && existingKeys.includes(trimmedKey);

  const [typeTouched, setTypeTouched] = useState(false);

  const detectType = (v: string): SchemaField["type"] => {
    const t = v.trim();
    if (t === "true" || t === "false") return "boolean";
    if (/^-?\d+$/.test(t)) return "integer";
    if (/^-?\d*\.\d+$/.test(t) || /^-?\d+\.\d*$/.test(t)) return "float";
    return "string";
  };

  const onValueChange = (v: string) => {
    setValueText(v);
    if (isNew && !typeTouched && !isJson && v.trim() !== "") {
      setField((f) => ({ ...f, type: detectType(v) }));
    }
  };

  const onTypeChange = (token: string) => {
    setTypeTouched(true);
    setRawMode(false);
    if (token in JSON_SCHEMA_PRESETS) {
      const key = token as PresetKey;
      // Presets carry no bounds or allow-list; "any" subsumes null.
      setField((f) => ({
        ...f,
        jsonSchema: presetSchemaString(key),
        min: undefined,
        max: undefined,
        enum: [],
        nullable: key === "any" ? false : f.nullable,
      }));
      setShowValidation(false);
      setShowEnum(false);
      return;
    }
    const type = token as SchemaField["type"];
    setField((f) =>
      type === "boolean"
        ? {
            ...f,
            type,
            jsonSchema: undefined,
            min: undefined,
            max: undefined,
            enum: [],
          }
        : { ...f, type, jsonSchema: undefined },
    );
    if (type === "boolean") {
      setShowValidation(false);
      setShowEnum(false);
    }
  };

  const onBound = (which: "min" | "max", raw: string) => {
    const t = raw.trim();
    setField((f) => ({ ...f, [which]: t === "" ? undefined : Number(t) }));
  };

  // Entering schema mode seeds from the current definition; leaving drops it.
  const setMode = (mode: "simple" | "schema") => {
    if (mode === "schema") {
      if (field.jsonSchema === undefined) {
        let seeded: string;
        try {
          seeded = JSON.stringify(
            simpleSchemaFieldToJSONSchema(field),
            null,
            2,
          );
        } catch {
          const base =
            field.type === "integer" || field.type === "float"
              ? "number"
              : field.type;
          seeded = `{\n  "type": "${base}"\n}`;
        }
        setField({ ...field, jsonSchema: seeded });
      }
      setRawMode(true);
    } else {
      setField({ ...field, jsonSchema: undefined });
      setRawMode(false);
    }
  };

  const save = async () => {
    if (!trimmedKey) {
      setErr("A field key is required");
      return;
    }
    if (duplicate) {
      setErr(`A field named "${trimmedKey}" already exists`);
      return;
    }
    if (isJson) {
      try {
        JSON.parse(field.jsonSchema || "");
      } catch (e) {
        setErr(
          `Invalid JSON Schema — ${
            e instanceof Error ? e.message : "could not parse"
          }`,
        );
        return;
      }
    }
    // Parse against the value surface so {type:string} saves a string, not JSON.
    // `undefined` + the unset flag tells the caller to delete the value key.
    const unset = withValue && valueIsUndefined;
    let value: unknown = undefined;
    if (unset) {
      value = undefined;
    } else if (withValue && valueIsNull) {
      value = null;
    } else if (withValue) {
      const t = valueText.trim();
      if (valueIsJson) {
        if (t === "") {
          value = typeDefault(field);
        } else {
          try {
            value = JSON.parse(t);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Value must be valid JSON");
            return;
          }
        }
      } else if (valueType === "boolean") {
        value = t === "true";
      } else if (valueType === "number") {
        if (t === "") {
          value = 0;
        } else {
          const n = field.type === "integer" ? parseInt(t, 10) : parseFloat(t);
          if (Number.isNaN(n)) {
            setErr("Value must be a number");
            return;
          }
          value = n;
        }
      } else {
        value = valueText;
      }
    }
    setErr(null);
    setSaving(true);
    try {
      await onSave(normalizeField({ ...field, key: trimmedKey }), value, unset);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save field");
    } finally {
      // Reset even on success: callers normally unmount the form after save, but
      // don't leave Save/Cancel permanently disabled if one keeps it mounted.
      setSaving(false);
    }
  };

  const numeric = field.type === "integer" || field.type === "float";

  // An irreducible raw schema surfaces a read-only "Other" option.
  const typeValue = fieldTypeSelectValue(field);
  const typeOptions =
    typeValue === OTHER_TYPE_VALUE
      ? [
          ...FIELD_TYPE_OPTIONS,
          { value: OTHER_TYPE_VALUE, label: "Other", isDisabled: true },
        ]
      : FIELD_TYPE_OPTIONS;
  const typeSelect = (
    <SelectField
      value={typeValue}
      onChange={onTypeChange}
      options={typeOptions}
      sort={false}
    />
  );

  const enumValues = !valueIsJson && valueType !== "boolean" ? field.enum : [];
  const valueInput =
    valueType === "boolean" ? (
      <SelectField
        value={valueText === "true" ? "true" : "false"}
        onChange={setValueText}
        options={[
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
        sort={false}
      />
    ) : enumValues.length > 0 ? (
      <SelectField
        value={valueText}
        onChange={setValueText}
        options={enumValues.map((v) => ({ value: v, label: v }))}
        initialOption="value…"
        sort={false}
      />
    ) : (
      <FeatureValueField
        id="config-field-value"
        value={valueText}
        setValue={onValueChange}
        valueType={valueType}
        useCodeInput={valueIsJson}
        showFullscreenButton={valueIsJson}
        codeInputDefaultHeight={FIVE_LINES_HEIGHT}
        constantContext={constantContext}
        inlineConstantButton
      />
    );

  const modeToggle = (
    <Link size="1" onClick={() => setMode(advanced ? "simple" : "schema")}>
      {advanced ? "Use simple editor" : "Edit as JSON Schema"}
    </Link>
  );

  // Description lives outside the schema, so it's edited in both modes.
  const descriptionField = (
    <Field
      label="Description"
      value={field.description}
      onChange={(e) => setField({ ...field, description: e.target.value })}
      maxLength={256}
      containerStyle={{ marginBottom: "var(--space-3)" }}
    />
  );

  const canNullable = preset !== "any";
  const canEnum = !isJson && field.type !== "boolean";
  const hasEnum = field.enum.length > 0;
  // Bounds and an allow-list are mutually exclusive (an enum already restricts).
  const canValidate = canEnum && !hasEnum;

  const body = advanced ? (
    <Box mt="2">
      {descriptionField}
      <CodeTextArea
        language="json"
        value={field.jsonSchema ?? ""}
        setValue={(v) => setField({ ...field, jsonSchema: v })}
        minLines={8}
        maxLines={30}
        resizable
        showCopyButton
        showFullscreenButton
        containerStyle={{ marginBottom: 0 }}
      />
      <Text size="small" color="text-low">
        Enter a JSON Schema for this field&apos;s value. See{" "}
        <Link href="https://json-schema.org/" target="_blank" rel="noreferrer">
          https://json-schema.org/
        </Link>{" "}
        for more information.
      </Text>
    </Box>
  ) : (
    <Box mt="2">
      {descriptionField}
      <Flex gap="4" align="center" wrap="wrap">
        <Checkbox
          size="sm"
          weight="regular"
          value={field.required === false}
          setValue={(v) => setField({ ...field, required: !v })}
          label="Optional"
        />
        {canNullable && (
          <Checkbox
            size="sm"
            weight="regular"
            value={field.nullable === true}
            setValue={(v) => setField({ ...field, nullable: v })}
            label="Nullable"
          />
        )}
        {canEnum && !showEnum && (
          <Button
            variant="ghost"
            size="xs"
            icon={<PiPlus />}
            onClick={() => {
              setShowEnum(true);
              setShowValidation(false);
            }}
          >
            Restrict to specific values
          </Button>
        )}
        {canValidate && !showValidation && (
          <Button
            variant="ghost"
            size="xs"
            icon={<PiPlus />}
            onClick={() => setShowValidation(true)}
          >
            Add validation
          </Button>
        )}
      </Flex>
      {canEnum && showEnum && (
        <Box mt="3">
          <Text as="label" size="small" weight="medium">
            Allowed values
          </Text>
          <Flex gap="3" align="start">
            <Box style={{ flex: 1 }}>
              <MultiSelectField
                placeholder="Add a value and press enter"
                value={field.enum}
                onChange={(vals) => {
                  const cleaned = vals
                    .filter((v) => v !== "" && v.length <= 256)
                    .slice(0, 256);
                  setField({ ...field, enum: cleaned });
                }}
                options={field.enum.map((v) => ({ value: v, label: v }))}
                creatable
                noMenu
                showCopyButton={false}
                containerStyle={{ marginBottom: 0 }}
              />
            </Box>
            <IconButton
              type="button"
              variant="ghost"
              color="red"
              radius="full"
              mt="2"
              style={{ marginLeft: 0, marginRight: 0 }}
              aria-label="Remove allowed values"
              onClick={() => {
                setShowEnum(false);
                setField({ ...field, enum: [] });
              }}
            >
              <PiTrash size={16} />
            </IconButton>
          </Flex>
        </Box>
      )}
      {canValidate && showValidation && (
        <Box mt="3">
          <Flex gap="3" align="end">
            <Box style={{ flex: 1 }}>
              <Field
                label={numeric ? "Minimum" : "Min length"}
                type="number"
                step={field.type === "float" ? "any" : 1}
                min={numeric ? undefined : 0}
                value={field.min ?? ""}
                onChange={(e) => onBound("min", e.target.value)}
                containerStyle={{ marginBottom: 0 }}
              />
            </Box>
            <Box style={{ flex: 1 }}>
              <Field
                label={numeric ? "Maximum" : "Max length"}
                type="number"
                step={field.type === "float" ? "any" : 1}
                value={field.max ?? ""}
                onChange={(e) => onBound("max", e.target.value)}
                containerStyle={{ marginBottom: 0 }}
              />
            </Box>
            <IconButton
              type="button"
              variant="ghost"
              color="red"
              radius="full"
              mb="2"
              style={{ marginLeft: 0, marginRight: 0 }}
              aria-label="Remove validation"
              onClick={() => {
                setShowValidation(false);
                setField({ ...field, min: undefined, max: undefined });
              }}
            >
              <PiTrash size={16} />
            </IconButton>
          </Flex>
        </Box>
      )}
    </Box>
  );

  const saveCancel = (
    <Flex gap="3" align="center">
      <Button size="sm" onClick={save} disabled={saving}>
        Save
      </Button>
      <Link size="2" onClick={saving ? undefined : onCancel}>
        Cancel
      </Link>
    </Flex>
  );

  return (
    <Box
      p="3"
      style={{
        background: "var(--violet-a2)",
        borderRadius: 8,
        borderBottom: "1px solid var(--slate-a3)",
      }}
    >
      {/* Same grid template as the header/rows so the columns line up. The JSON
          value editor floats its "Insert constant" button just above itself, so
          add headroom to keep it inside the panel. */}
      <Grid
        columns={FIELD_GRID_TEMPLATE}
        gapX="5"
        align="start"
        pt={withValue && valueIsJson && !valueIsNull ? "6" : "0"}
      >
        <Box style={{ minWidth: 0 }}>
          <Flex align="center" style={{ minHeight: 32 }}>
            <Box style={{ width: "100%" }}>
              <Field
                autoFocus={isNew}
                placeholder="key"
                value={field.key}
                disabled={!isNew}
                onChange={(e) => setField({ ...field, key: e.target.value })}
                containerStyle={{ marginBottom: 0 }}
              />
            </Box>
          </Flex>
        </Box>
        {withValue && (
          <Box style={{ minWidth: 0 }}>
            <Flex align="center" style={{ minHeight: 32 }}>
              <Box style={{ width: "100%", minWidth: 0 }}>
                {valueIsUndefined ? (
                  <Text color="text-low">
                    <code>undefined</code>
                  </Text>
                ) : valueIsNull ? (
                  <Text color="text-low">
                    <code>null</code>
                  </Text>
                ) : (
                  valueInput
                )}
              </Box>
            </Flex>
            {(() => {
              const nullable = fieldIsNullable(field) && !valueIsJson;
              // Keep the checkbox visible while checked so a required field
              // seeded from a valueless state can still be given a value.
              const optional = field.required === false || valueIsUndefined;
              if (!nullable && !optional) return null;
              return (
                <Flex mt="1" gap="4" align="center">
                  {nullable && (
                    <Checkbox
                      size="sm"
                      weight="regular"
                      disabled={valueIsUndefined}
                      value={valueIsNull}
                      setValue={(v) => {
                        setValueIsNull(v);
                        if (v) setValueIsUndefined(false);
                      }}
                      label={<code>null</code>}
                    />
                  )}
                  {optional && (
                    <Checkbox
                      size="sm"
                      weight="regular"
                      value={valueIsUndefined}
                      setValue={(v) => {
                        setValueIsUndefined(v);
                        if (v) setValueIsNull(false);
                      }}
                      label={<code>undefined</code>}
                    />
                  )}
                </Flex>
              );
            })()}
          </Box>
        )}
        <Box style={{ minWidth: 0 }}>
          <Flex align="center" style={{ minHeight: 32 }}>
            <Box style={{ width: "100%" }}>{typeSelect}</Box>
          </Flex>
        </Box>
        <Flex
          align="center"
          justify="between"
          gap="2"
          style={{ gridColumn: "4 / -1", minHeight: 32 }}
        >
          <Link
            onClick={() => setConfigureOpen((o) => !o)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            {configureOpen ? <PiCaretDownFill /> : <PiCaretRightFill />}
            Configure
          </Link>
          {saveCancel}
        </Flex>
      </Grid>

      {configureOpen && (
        <Box>
          {body}
          <Flex justify="end" mt="2">
            {modeToggle}
          </Flex>
        </Box>
      )}
      {err && (
        <Callout status="error" mt="2" size="sm">
          {err}
        </Callout>
      )}
    </Box>
  );
}
