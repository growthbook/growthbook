import React, { useEffect, useRef, useState } from "react";
import { SchemaField } from "shared/types/feature";
import { simpleSchemaFieldToJSONSchema } from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiCaretDownBold,
  PiCaretUpBold,
  PiPlus,
  PiTrash,
} from "react-icons/pi";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Collapse from "@/ui/Collapse";
import { inPlaceEditor } from "@/components/Features/EditableValueFrame";
import ConfigEditActions from "@/components/Configs/ConfigEditActions";
import {
  TableCell,
  TableRow,
  TableViewportCell,
  revealTableCell,
} from "@/ui/Table";
import MarkdownLinks from "@/components/Markdown/MarkdownLinks";
import Checkbox from "@/ui/Checkbox";
import Field from "@/components/Forms/Field";
import CodeTextArea, {
  FIVE_LINES_HEIGHT,
} from "@/components/Forms/CodeTextArea";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import FormatJsonAction from "@/components/Features/FormatJsonAction";
import {
  pinnedCellBackground,
  FIELD_TYPE_OPTIONS,
  JSON_SCHEMA_PRESETS,
  OTHER_TYPE_VALUE,
  PresetKey,
  fieldRowTransitionProps,
  fieldTypeSelectValue,
  fieldValueType,
  fieldIsNullable,
  normalizeField,
  parseFieldValueInput,
  presetKeyFromField,
  presetSchemaString,
} from "@/components/Configs/fieldSchema";
import styles from "./FieldDefForm.module.scss";

// Inline editor for creating or editing a field (editing locks the key). The
// simple surface and the raw JSON Schema surface both compile to a JSON Schema.
export default function FieldDefForm({
  initial,
  existingKeys,
  withValue = false,
  isNew = false,
  initialValue = "",
  initialNull = false,
  constantContext,
  onDirtyChange,
  onSavingChange,
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
  constantContext?: { project?: string; excludeKeys?: string[] };
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  onCancel: () => void;
  // No value leaves the field's value as it is.
  onSave: (field: SchemaField, value?: unknown) => void | Promise<void>;
}): React.ReactElement {
  // Normalize so a raw schema that's really a simple type opens in simple mode.
  // Pretty-print a raw schema once on open so imported/minified schemas show with
  // readable whitespace in the code editor (typing afterward is preserved as-is).
  const [initialField] = useState<SchemaField>(() => {
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
  const [field, setField] = useState(initialField);
  const [valueText, setValueText] = useState(initialValue);
  const [valueIsNull, setValueIsNull] = useState(initialNull);
  const valueTouched =
    valueText !== initialValue || valueIsNull !== initialNull;
  const dirty =
    valueTouched || JSON.stringify(field) !== JSON.stringify(initialField);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);
  useEffect(() => () => onSavingChange?.(false), [onSavingChange]);
  const [err, setErr] = useState<string | null>(null);

  // A raw schema can still resolve to a simple value surface (e.g. {type:string}).
  const isJson = field.jsonSchema !== undefined;
  const valueType = fieldValueType(field);
  const valueIsJson = valueType === "json";
  const preset = presetKeyFromField(field);
  const [rawMode, setRawMode] = useState(isJson && preset === null);

  const hasBound = field.min !== undefined || field.max !== undefined;
  const [showValidation, setShowValidation] = useState(hasBound);
  const [showEnum, setShowEnum] = useState(field.enum.length > 0);

  // The settings drawer opens only on request.
  const [configureOpen, setConfigureOpen] = useState(false);
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
    if (
      isNew &&
      type === "boolean" &&
      !["true", "false"].includes(valueText.trim())
    ) {
      setValueText("");
    }
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

  // An untouched value stays as it is, unless the field now holds another kind
  // of value. Parsed against the value surface, so {type:string} saves a
  // string, not JSON.
  const retyped =
    valueText !== "" && valueType !== fieldValueType(initialField);
  // A new required field takes a value now.
  const needsValue = field.required && isNew;
  const parsedValue =
    withValue && (valueTouched || retyped || needsValue)
      ? parseFieldValueInput(valueText, field, valueIsNull)
      : null;

  const saveBlockedReason = !trimmedKey
    ? "Enter a field key"
    : duplicate
      ? `A field named "${trimmedKey}" already exists`
      : parsedValue?.kind === "error"
        ? parsedValue.error
        : null;

  const save = async () => {
    if (!dirty) {
      onCancel();
      return;
    }
    if (saveBlockedReason) return;
    if (isJson) {
      try {
        JSON.parse(field.jsonSchema || "");
      } catch (e) {
        setErr(
          `Invalid JSON Schema: ${
            e instanceof Error ? e.message : "could not parse"
          }`,
        );
        return;
      }
    }
    const value = parsedValue?.kind === "value" ? parsedValue.value : undefined;
    setErr(null);
    setSaving(true);
    try {
      await onSave(normalizeField({ ...field, key: trimmedKey }), value);
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
      portalMenu
      size="md"
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
        portalMenu
        size="md"
        value={valueText}
        onChange={setValueText}
        options={[
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
        placeholder="Choose a value"
        sort={false}
      />
    ) : enumValues.length > 0 ? (
      <SelectField
        portalMenu
        size="md"
        value={valueText}
        onChange={setValueText}
        options={enumValues.map((v) => ({ value: v, label: v }))}
        placeholder="Choose a value"
        sort={false}
      />
    ) : (
      <FeatureValueField
        size="md"
        id="config-field-value"
        value={valueText}
        setValue={onValueChange}
        valueType={valueType}
        codeInputDefaultHeight={FIVE_LINES_HEIGHT}
        constantContext={constantContext}
        fullWidth
      />
    );

  const modeToggle = (
    <Link size="sm" onClick={() => setMode(rawMode ? "simple" : "schema")}>
      {rawMode ? "Use simple editor" : "Edit as JSON Schema"}
    </Link>
  );

  // Description lives outside the schema, so it's edited in both modes.
  const descriptionField = (
    <Field
      label="Description"
      labelWeight="medium"
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

  const body = rawMode ? (
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
        // The same editor as a JSON value's.
        slimGutter
        matchValueDisplay
        actions={
          <FormatJsonAction
            value={field.jsonSchema ?? ""}
            setValue={(v) => setField({ ...field, jsonSchema: v })}
          />
        }
        containerStyle={{ marginBottom: 0 }}
      />
      <Text size="sm" color="text-low">
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
            size="sm"
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
            size="sm"
            icon={<PiPlus />}
            onClick={() => setShowValidation(true)}
          >
            Add validation
          </Button>
        )}
      </Flex>
      {canEnum && showEnum && (
        <Box mt="3">
          <Flex gap="3" align="end">
            <Box style={{ flex: 1 }}>
              <MultiSelectField
                label="Allowed values"
                labelWeight="medium"
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
              mb="2"
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
                labelWeight="medium"
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
                labelWeight="medium"
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

  // A new field stays at its key, which takes focus.
  const valueCellRef = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    const valueCell = valueCellRef.current;
    if (isNew || !valueCell) return;
    return revealTableCell(valueCell);
  }, [isNew]);

  const tint = "var(--violet-a2)";
  return (
    <>
      <TableRow
        {...(isNew ? {} : fieldRowTransitionProps(initial.key))}
        align="start"
        className={styles.editRow}
        style={{ background: tint }}
      >
        <TableCell>
          <Flex align="center" style={{ minHeight: 32 }}>
            <Box flexGrow="1" className={inPlaceEditor}>
              <Field
                size="md"
                autoFocus={isNew}
                placeholder="key"
                value={field.key}
                disabled={!isNew}
                onChange={(e) => setField({ ...field, key: e.target.value })}
                containerStyle={{ marginBottom: 0 }}
              />
            </Box>
          </Flex>
        </TableCell>
        <TableCell
          ref={valueCellRef}
          // Keeps the code editor's scrollbar under the pinned column.
          style={valueIsJson ? { isolation: "isolate" } : undefined}
        >
          {withValue && (
            <>
              <Flex align="center" style={{ minHeight: 32 }}>
                <Box
                  flexGrow="1"
                  minWidth="0"
                  className={valueIsNull ? undefined : inPlaceEditor}
                >
                  {valueIsNull ? (
                    <Text color="text-low">
                      <code>null</code>
                    </Text>
                  ) : (
                    valueInput
                  )}
                </Box>
              </Flex>
              {fieldIsNullable(field) && !valueIsJson && (
                <Flex mt="1" align="center">
                  <Checkbox
                    size="sm"
                    weight="regular"
                    value={valueIsNull}
                    setValue={setValueIsNull}
                    label={<code>null</code>}
                  />
                </Flex>
              )}
            </>
          )}
        </TableCell>
        <TableCell>
          <Flex align="center" style={{ minHeight: 32 }}>
            <Box flexGrow="1" className={inPlaceEditor}>
              {typeSelect}
            </Box>
          </Flex>
        </TableCell>
        <TableCell colSpan={2} />
        <TableCell style={{ background: pinnedCellBackground(tint) }} />
      </TableRow>
      {/* The field's settings, in a drawer under the row. */}
      <TableRow style={{ background: tint }}>
        {/* No height of its own: shut, the drawer is only its toggle. */}
        <TableViewportCell colSpan={6} style={{ padding: 0, height: 0 }}>
          <Box position="relative">
            <Button
              variant="soft"
              color="gray"
              size="sm"
              className={styles.drawerToggle}
              aria-expanded={configureOpen}
              icon={
                configureOpen ? (
                  <PiCaretUpBold size={10} />
                ) : (
                  <PiCaretDownBold size={10} />
                )
              }
              iconPosition="right"
              onClick={() => setConfigureOpen((open) => !open)}
            >
              Field settings
            </Button>
            <Collapse open={configureOpen}>
              <Box className={styles.drawer}>
                {body}
                <Flex justify="end" mt="2">
                  {modeToggle}
                </Flex>
              </Box>
            </Collapse>
            {err && (
              <Box className={styles.drawerNote} mt={configureOpen ? "0" : "2"}>
                <Callout status="error" size="sm">
                  <MarkdownLinks text={err} />
                </Callout>
              </Box>
            )}
          </Box>
        </TableViewportCell>
      </TableRow>
      <ConfigEditActions
        colSpan={6}
        background={tint}
        saving={saving}
        saveBlockedReason={saveBlockedReason}
        onSave={save}
        onCancel={onCancel}
      />
    </>
  );
}
