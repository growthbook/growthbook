import React, { useState } from "react";
import { SchemaField } from "shared/types/feature";
import { simpleSchemaFieldToJSONSchema } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import {
  FIELD_COLS,
  FIELD_TYPE_OPTIONS,
  JSON_SCHEMA_PRESETS,
  PresetKey,
  fieldTypeLabel,
  normalizeField,
  presetKeyFromField,
  presetSchemaString,
  typeDefault,
} from "@/components/Configs/fieldSchema";

// Inline field editor with two layouts:
//  - Create (default): a single row (key + value + type) with a collapsed
//    "Configure" disclosure for the rest.
//  - schemaOnly (editing an existing field's definition): no value input, key
//    shown as a read-only heading, type locked, options expanded.
// Either way the body is a simple surface (description, nullable, opt-in min/max)
// or a raw per-field JSON Schema (`jsonSchema`); both compile to a JSON Schema.
export default function FieldDefForm({
  initial,
  existingKeys,
  withValue = false,
  isNew = false,
  schemaOnly = false,
  onCancel,
  onSave,
}: {
  initial: SchemaField;
  // Other field keys in scope, to block duplicates.
  existingKeys: string[];
  // When inserting, also offer a value input to set it in the same step.
  withValue?: boolean;
  // Type is editable only when creating; locked thereafter.
  isNew?: boolean;
  // Edit an existing field's definition only (no create row, no value).
  schemaOnly?: boolean;
  onCancel: () => void;
  onSave: (field: SchemaField, value?: unknown) => void | Promise<void>;
}): React.ReactElement {
  // Normalize so a raw schema that's really a simple type opens in Simple mode.
  const [field, setField] = useState<SchemaField>(() =>
    normalizeField(initial),
  );
  const [valueText, setValueText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // `isJson` = any jsonSchema-backed field (presets + raw). `preset` is the
  // friendly pick it represents, if any. `rawMode` is the hand-edited raw
  // schema surface — presets are jsonSchema-backed but edited via the simple
  // surface, so they are not "raw".
  const isJson = field.jsonSchema !== undefined;
  const preset = presetKeyFromField(field);
  const [rawMode, setRawMode] = useState(isJson && preset === null);
  const advanced = rawMode;

  // Validation is opt-in; open it only when a bound already exists.
  const hasBound = field.min !== undefined || field.max !== undefined;
  const [showValidation, setShowValidation] = useState(hasBound);

  // schemaOnly is always expanded; existing fields with extra definition open
  // expanded; new fields stay a single row.
  const [configureOpen, setConfigureOpen] = useState(
    schemaOnly ||
      (!isNew &&
        (isJson || !!field.description || field.nullable === true || hasBound)),
  );

  const trimmedKey = field.key.trim();
  const duplicate =
    trimmedKey !== initial.key && existingKeys.includes(trimmedKey);

  const [typeTouched, setTypeTouched] = useState(false);
  const typeLocked = rawMode || !isNew;

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

  // A type pick is either a simple primitive or a jsonSchema-backed preset.
  const onTypeChange = (token: string) => {
    setTypeTouched(true);
    setRawMode(false);
    if (token in JSON_SCHEMA_PRESETS) {
      const key = token as PresetKey;
      // Presets carry no simple bounds; "any" already subsumes null.
      setField((f) => ({
        ...f,
        jsonSchema: presetSchemaString(key),
        min: undefined,
        max: undefined,
        nullable: key === "any" ? false : f.nullable,
      }));
      setShowValidation(false);
      return;
    }
    const type = token as SchemaField["type"];
    setField((f) =>
      type === "boolean"
        ? { ...f, type, jsonSchema: undefined, min: undefined, max: undefined }
        : { ...f, type, jsonSchema: undefined },
    );
    if (type === "boolean") setShowValidation(false);
  };

  // Blank clears the bound.
  const onBound = (which: "min" | "max", raw: string) => {
    const t = raw.trim();
    setField((f) => ({ ...f, [which]: t === "" ? undefined : Number(t) }));
  };

  // Toggle the raw JSON Schema surface. Entering seeds from the current
  // definition (preset schema, or compiled simple prefs); leaving drops the
  // raw schema back to the simple type.
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
    // Every new field gets a concrete value — blank falls back to the type
    // default (string "", boolean false, number 0, JSON {}, array [], any null).
    // jsonSchema-backed fields parse the value as raw JSON.
    let value: unknown = undefined;
    if (withValue) {
      const t = valueText.trim();
      if (isJson) {
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
      } else if (field.type === "boolean") {
        value = t === "true";
      } else if (field.type === "integer" || field.type === "float") {
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
      // Collapse a raw schema that's really just a simple type before saving.
      await onSave(normalizeField({ ...field, key: trimmedKey }), value);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save field");
      setSaving(false);
    }
  };

  const numeric = field.type === "integer" || field.type === "float";

  // Mode toggle (simple ↔ raw JSON Schema), shared by both layouts.
  const modeToggle = (
    <Link size="1" onClick={() => setMode(advanced ? "simple" : "schema")}>
      {advanced ? "Use simple editor" : "Edit as JSON Schema"}
    </Link>
  );

  // The configure body: raw JSON Schema, or the simple surface.
  const body = advanced ? (
    <Box mt="2">
      <Field
        textarea
        minRows={5}
        value={field.jsonSchema ?? ""}
        onChange={(e) => setField({ ...field, jsonSchema: e.target.value })}
        containerStyle={{ marginBottom: 0 }}
      />
      <Text size="small" color="text-low">
        Raw JSON Schema for this field&apos;s value — supersedes the simple
        type. Use this for nullable/optional unions and nested shapes.
      </Text>
    </Box>
  ) : (
    <Box mt="2">
      <Field
        label="Description"
        value={field.description}
        onChange={(e) => setField({ ...field, description: e.target.value })}
        maxLength={256}
      />
      {preset !== "any" && (
        <Box mb="3">
          <Checkbox
            value={field.nullable === true}
            setValue={(v) => setField({ ...field, nullable: v })}
            label="Nullable"
            description="Allow the value to be null"
          />
        </Box>
      )}
      {!isJson &&
        field.type !== "boolean" &&
        (showValidation ? (
          <Box>
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
            </Flex>
            <Box mt="1">
              <Link
                size="1"
                color="red"
                onClick={() => {
                  setShowValidation(false);
                  setField({ ...field, min: undefined, max: undefined });
                }}
              >
                Remove validation
              </Link>
            </Box>
          </Box>
        ) : (
          <Link size="1" onClick={() => setShowValidation(true)}>
            + Add validation
          </Link>
        ))}
    </Box>
  );

  const saveCancel = (
    <Flex gap="2">
      <Button size="sm" onClick={save} disabled={saving}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
    </Flex>
  );

  return (
    <Box
      mt={schemaOnly ? "2" : "6"}
      p="3"
      style={{
        background: "var(--violet-a2)",
        borderRadius: "var(--radius-3)",
      }}
    >
      {schemaOnly ? (
        // Editing an existing field: key is fixed (heading), no value, type
        // locked, options always expanded.
        <>
          <Flex align="center" justify="between" gap="2">
            <Flex align="baseline" gap="2" style={{ minWidth: 0 }}>
              <Text weight="medium">{field.key}</Text>
              <Text size="small" color="text-low">
                {fieldTypeLabel(field)}
              </Text>
            </Flex>
            <Flex gap="3" align="center">
              {modeToggle}
              {saveCancel}
            </Flex>
          </Flex>
          {body}
        </>
      ) : (
        <>
          {/* Fixed-width columns so the row lines up with the tab header/rows. */}
          <Flex gap="2" align="center" wrap="wrap">
            <Box style={{ width: FIELD_COLS.key, flexShrink: 0 }}>
              <Field
                autoFocus
                placeholder="key"
                value={field.key}
                onChange={(e) => setField({ ...field, key: e.target.value })}
                containerStyle={{ marginBottom: 0 }}
              />
            </Box>
            {withValue && (
              <Box style={{ width: FIELD_COLS.value, flexShrink: 0 }}>
                {!isJson && field.type === "boolean" ? (
                  <SelectField
                    value={valueText}
                    onChange={setValueText}
                    options={[
                      { value: "true", label: "true" },
                      { value: "false", label: "false" },
                    ]}
                    initialOption="value…"
                    sort={false}
                  />
                ) : (
                  <Field
                    placeholder={isJson ? "value (JSON)" : "value"}
                    value={valueText}
                    onChange={(e) => onValueChange(e.target.value)}
                    containerStyle={{ marginBottom: 0 }}
                  />
                )}
              </Box>
            )}
            <Box style={{ width: FIELD_COLS.type, flexShrink: 0 }}>
              <SelectField
                value={preset ?? field.type}
                onChange={onTypeChange}
                options={FIELD_TYPE_OPTIONS}
                sort={false}
                disabled={typeLocked}
              />
            </Box>
            <Box style={{ marginLeft: "auto" }}>{saveCancel}</Box>
          </Flex>

          <Flex mt="2" align="center" justify="between">
            <Link
              color="dark"
              onClick={() => setConfigureOpen((o) => !o)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              {configureOpen ? <FaAngleDown /> : <FaAngleRight />}
              Configure
            </Link>
            {configureOpen && modeToggle}
          </Flex>

          {configureOpen && body}
        </>
      )}
      {err && (
        <Callout status="error" mt="2" size="sm">
          {err}
        </Callout>
      )}
    </Box>
  );
}
