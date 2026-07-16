import React, { useMemo, useState } from "react";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import { SchemaField } from "shared/types/feature";
import { deepMergePatch } from "shared/util";
import { isEqual } from "lodash";
import {
  PiArrowCounterClockwise,
  PiInfo,
  PiPlusBold,
  PiTrash,
} from "react-icons/pi";
import useApi from "@/hooks/useApi";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Checkbox from "@/ui/Checkbox";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import {
  ResolvedField,
  FIELD_TYPE_OPTIONS,
  fieldForTypeToken,
  fieldIsNullable,
  fieldTypeLabel,
  fieldValueType,
  normalizeField,
  typeDefault,
  typeTokenFromValue,
  valueToDisplayString,
} from "@/components/Configs/fieldSchema";

type ResolvedResponse = {
  effectiveSchema: SchemaField[];
  fields: ResolvedField[];
  extensible?: boolean;
};

// Key (150px) / Value (minmax(180px, 1fr)) / Type (110px) / action (120px).
// Every column is fixed except Value (1fr, absorbs slack) so the column header
// and every row share identical geometry. An `auto` action column resolved to
// 0 in the empty header cell but ~the CTA width in rows, which shifted the Type
// column out of alignment; 120px fits the widest CTA ("+ Override") without
// clipping. The modest Value min keeps the grid from overflowing narrow
// containers (e.g. an experiment variation arm).
const GRID_TEMPLATE = "150px minmax(180px, 1fr) 110px 120px";

// A custom key picks how to enter a concrete value, so the schema-authoring
// "Any" type (no value editor of its own) is dropped from its type picker.
const CUSTOM_FIELD_TYPE_OPTIONS = FIELD_TYPE_OPTIONS.filter(
  (o) => o.value !== "any",
);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseOverrides(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Internal composition directive carried in a config-backed value's patch (its
// `@const:`/`@config:` refs). Not a user-editable override field, so it's hidden
// from the override rows while preserved verbatim on write-back.
const DIRECTIVE_KEY = "$extends";

function textForValue(value: unknown, vt: string): string {
  if (value === undefined || value === null) return "";
  if (vt === "json") return JSON.stringify(value, null, 2);
  return String(value);
}

// Free-text/JSON inputs own their draft text so typing isn't clobbered by the
// parse → re-serialize round-trip. Booleans/enums commit discrete values
// directly. Mounted only while a field is overridden, so it re-seeds correctly
// each time an override starts.
function OverrideValueInput({
  field,
  fieldKey,
  value,
  onChange,
  constantContext,
  disabled,
}: {
  field: SchemaField | null;
  fieldKey: string;
  value: unknown;
  onChange: (value: unknown) => void;
  constantContext?: { project?: string; excludeKeys?: string[] };
  disabled?: boolean;
}): React.ReactElement {
  const nf = field ? normalizeField(field) : null;
  const vt = fieldValueType(nf);
  const enumValues = vt !== "json" && vt !== "boolean" ? (nf?.enum ?? []) : [];

  const [text, setText] = useState<string>(() => textForValue(value, vt));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [numError, setNumError] = useState<string | null>(null);

  if (vt === "boolean") {
    return (
      <SelectField
        value={value ? "true" : "false"}
        onChange={(v) => onChange(v === "true")}
        options={[
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
        sort={false}
        disabled={disabled}
      />
    );
  }

  if (enumValues.length > 0) {
    return (
      <SelectField
        value={value === null || value === undefined ? "" : String(value)}
        // enum options are strings; coerce back to a number for numeric fields
        // so a numeric enum override isn't persisted as a string (config-backed
        // values skip the flag's own JSON-schema validation).
        onChange={(v) =>
          onChange(
            vt === "number" && v !== "" && Number.isFinite(Number(v))
              ? Number(v)
              : v,
          )
        }
        options={enumValues.map((v) => ({ value: v, label: v }))}
        initialOption="value…"
        sort={false}
        disabled={disabled}
      />
    );
  }

  if (vt === "json") {
    return (
      <Box>
        <FeatureValueField
          id={`override-val-${fieldKey}`}
          value={text}
          setValue={(t) => {
            setText(t);
            try {
              onChange(JSON.parse(t));
              setJsonError(null);
            } catch {
              setJsonError("Invalid JSON");
            }
          }}
          valueType="json"
          useCodeInput
          showFullscreenButton
          codeInputDefaultHeight={120}
          constantContext={constantContext}
          inlineConstantButton
          disabled={disabled}
        />
        {jsonError && (
          <HelperText status="error" size="sm">
            {jsonError}
          </HelperText>
        )}
      </Box>
    );
  }

  // Numbers can't carry a `@const:` ref, so they stay a plain numeric input.
  // The draft text stays local; only finite numbers are committed to the patch.
  if (vt === "number") {
    return (
      <Box>
        <Field
          type="number"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            const n = Number(t);
            if (t.trim() !== "" && Number.isFinite(n)) {
              onChange(n);
              setNumError(null);
            } else {
              setNumError("Enter a valid number");
            }
          }}
        />
        {numError && (
          <HelperText status="error" size="sm">
            {numError}
          </HelperText>
        )}
      </Box>
    );
  }

  return (
    <FeatureValueField
      id={`override-val-${fieldKey}`}
      value={text}
      setValue={(t) => {
        setText(t);
        onChange(t);
      }}
      valueType="string"
      constantContext={constantContext}
      inlineConstantButton
      disabled={disabled}
    />
  );
}

// Inline editor for a CUSTOM (non-schema) override key. Declared fields keep a
// fixed key; a free-form key can be renamed. Renaming remounts the row (its
// React key includes the field key), so the draft is local and committed only
// on blur/Enter — never per keystroke — and a rename onto an existing key is
// rejected (reverting to the current key).
function EditableKey({
  value,
  taken,
  onRename,
  disabled,
}: {
  value: string;
  taken: Set<string>;
  onRename: (newKey: string) => void;
  disabled?: boolean;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);
  const trimmed = draft.trim();
  const collision = trimmed !== value && taken.has(trimmed);
  const invalid = trimmed.length === 0 || collision;

  const commit = () => {
    if (trimmed === value) return;
    if (invalid) {
      setDraft(value);
      return;
    }
    onRename(trimmed);
  };

  return (
    <Box style={{ width: "100%", minWidth: 0 }}>
      <Field
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={disabled}
        title={collision ? `"${trimmed}" is already in use` : undefined}
        style={{
          fontFamily: "monospace",
          ...(invalid ? { borderColor: "var(--red-8)" } : {}),
        }}
      />
    </Box>
  );
}

function OverrideRow({
  field,
  fieldKey,
  base,
  overridden,
  value,
  onStart,
  onSet,
  onRemove,
  onRename,
  takenKeys,
  constantContext,
  disabled,
}: {
  field: SchemaField | null;
  fieldKey: string;
  base: unknown;
  overridden: boolean;
  value: unknown;
  onStart: () => void;
  onSet: (value: unknown) => void;
  onRemove: () => void;
  onRename: (newKey: string) => void;
  takenKeys: Set<string>;
  constantContext?: { project?: string; excludeKeys?: string[] };
  disabled?: boolean;
}): React.ReactElement {
  // A custom (non-schema) key carries no declared type, so it gets a selectable
  // one (default string) that drives the value editor and the value's stored
  // JSON shape. Declared fields use their schema type as before. Seeded from the
  // current value so an existing custom override re-opens with the right type.
  const isCustom = field === null;
  const [customType, setCustomType] = useState(() =>
    isCustom ? typeTokenFromValue(value) : "string",
  );
  const effectiveField = isCustom ? fieldForTypeToken(customType) : field;
  const nf = effectiveField ? normalizeField(effectiveField) : null;
  const vt = fieldValueType(nf);
  const nullable = fieldIsNullable(nf);
  const description = nf?.description?.trim();
  const isNull = overridden && value === null;
  // A JSON override renders a code editor whose "Insert constant" button floats
  // just above it; give the row extra headroom so the button doesn't crowd the
  // row above.
  const hasJsonEditor = overridden && !isNull && vt === "json";

  // Object patches deep-merge onto the base at resolve time, so the stored
  // patch isn't the delivered value. Preview the merged result when they differ.
  const merged =
    hasJsonEditor && isPlainObject(base) && isPlainObject(value)
      ? deepMergePatch(base, value)
      : null;
  const showMerged = merged !== null && !isEqual(merged, value);

  return (
    <Grid
      columns={GRID_TEMPLATE}
      align="start"
      gapX="5"
      gapY="0"
      pt={hasJsonEditor ? "6" : "2"}
      pb="2"
      style={{ borderTop: "1px solid var(--slate-a4)" }}
    >
      <Flex align="center" gap="1" style={{ minHeight: 32, minWidth: 0 }}>
        {field === null ? (
          // Custom (non-schema) key — editable; declared keys are fixed.
          <EditableKey
            value={fieldKey}
            taken={takenKeys}
            onRename={onRename}
            disabled={disabled}
          />
        ) : (
          <code
            style={{
              color: "var(--slate-12)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={fieldKey}
          >
            {fieldKey}
          </code>
        )}
        {description && (
          <Tooltip body={description}>
            <PiInfo style={{ flexShrink: 0, color: "var(--slate-9)" }} />
          </Tooltip>
        )}
      </Flex>

      <Box style={{ minWidth: 0 }}>
        {overridden ? (
          <>
            {isNull ? (
              <Flex align="center" style={{ minHeight: 32 }}>
                <code>null</code>
              </Flex>
            ) : (
              <OverrideValueInput
                // Remount on a custom key's type change so the editor re-seeds
                // from the coerced value.
                key={isCustom ? `custom:${customType}` : `field:${fieldKey}`}
                field={effectiveField}
                fieldKey={fieldKey}
                value={value}
                onChange={onSet}
                constantContext={constantContext}
                disabled={disabled}
              />
            )}
            {showMerged && (
              <Box mt="1">
                <Text as="p" size="small" color="text-low" mb="0">
                  Nested objects deep-merge onto the config; arrays and scalars
                  replace.
                </Text>
                <Text size="small" color="text-low">
                  Resolved:{" "}
                  <code style={{ overflowWrap: "anywhere" }}>
                    {JSON.stringify(merged)}
                  </code>
                </Text>
              </Box>
            )}
            {nullable && vt !== "json" && (
              <Box mt="1">
                <Checkbox
                  size="sm"
                  label={<code>null</code>}
                  value={isNull}
                  disabled={disabled}
                  setValue={(v) => onSet(v ? null : (base ?? typeDefault(nf)))}
                />
              </Box>
            )}
          </>
        ) : (
          <Flex align="center" gap="2" style={{ minHeight: 32, minWidth: 0 }}>
            <Box style={{ minWidth: 0, color: "var(--slate-11)" }}>
              {base === undefined ? (
                <Text color="text-low">
                  <code>undefined</code>
                </Text>
              ) : (
                <code
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "block",
                  }}
                  title={valueToDisplayString(base, vt)}
                >
                  {valueToDisplayString(base, vt)}
                </code>
              )}
            </Box>
          </Flex>
        )}
      </Box>

      <Flex align="center" style={{ minHeight: 32, minWidth: 0 }}>
        {isCustom ? (
          <Tooltip
            body="Sets how the value is emitted (its encoding), not a validation rule."
            style={{ display: "block", width: "100%" }}
          >
            <Box style={{ width: "100%" }}>
              <SelectField
                value={customType}
                options={CUSTOM_FIELD_TYPE_OPTIONS}
                sort={false}
                disabled={disabled}
                onChange={(t) => {
                  if (t === customType) return;
                  setCustomType(t);
                  // Coerce the value to the new type's default so it stays valid.
                  onSet(typeDefault(normalizeField(fieldForTypeToken(t))));
                }}
              />
            </Box>
          </Tooltip>
        ) : (
          <code style={{ color: "var(--slate-9)", fontSize: "0.8em" }}>
            {fieldTypeLabel(nf)}
          </code>
        )}
      </Flex>

      <Flex
        align="center"
        justify="end"
        style={{ minHeight: 32, whiteSpace: "nowrap" }}
      >
        {overridden ? (
          <Link
            size="1"
            color="red"
            onClick={(e) => {
              e.preventDefault();
              if (!disabled) onRemove();
            }}
          >
            <Flex align="center" gap="1">
              {field === null ? (
                <>
                  <PiTrash /> Delete
                </>
              ) : (
                <>
                  <PiArrowCounterClockwise /> Revert
                </>
              )}
            </Flex>
          </Link>
        ) : (
          <Link
            size="1"
            onClick={(e) => {
              e.preventDefault();
              if (!disabled) onStart();
            }}
          >
            <Flex align="center" gap="1">
              <PiPlusBold /> Override
            </Flex>
          </Link>
        )}
      </Flex>
    </Grid>
  );
}

// The "add a field to override" control: one combobox. Declared fields that
// aren't overridden yet are the options; an extensible config also lets you
// create a new key by typing it and pressing Enter (or picking the "Add …"
// entry). Createable commits only on select/Enter/Tab/blur, never per keystroke,
// and keepCreatableWhenEmpty keeps that behavior even with no options left
// (otherwise SelectField degrades to a per-keystroke plain input).
function AddFieldControl({
  addableFields,
  extensible,
  existingKeys,
  onAdd,
  disabled,
}: {
  addableFields: SchemaField[];
  extensible: boolean;
  existingKeys: Set<string>;
  onAdd: (key: string) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <Box mt="2" style={{ maxWidth: 260 }}>
      <SelectField
        value=""
        placeholder={
          extensible ? "Add or create a field…" : "Add a field to override…"
        }
        createable={extensible}
        keepCreatableWhenEmpty
        formatCreateLabel={(v) => `Add "${v}"`}
        options={addableFields.map((f) => ({ value: f.key, label: f.key }))}
        onChange={(key) => {
          const k = key.trim();
          // Ignore an empty pick or a key that already exists (declared field
          // already overridden, or an existing custom key).
          if (!k || existingKeys.has(k)) return;
          onAdd(k);
        }}
        disabled={disabled}
      />
    </Box>
  );
}

// The Key / Value / Type column labels, shown above each field group.
function ColumnHeaderRow(): React.ReactElement {
  return (
    <Grid columns={GRID_TEMPLATE} gapX="5" pb="1" align="center">
      {["Key", "Value", "Type"].map((l) => (
        <Box key={l} style={{ minWidth: 0 }}>
          <Text
            size="small"
            weight="medium"
            color="text-low"
            textTransform="uppercase"
          >
            {l}
          </Text>
        </Box>
      ))}
      <Box />
    </Grid>
  );
}

// Schema-aware editor for the override patch applied on top of a config-backed
// value. The Form tab lists the config's fields with typed controls; the JSON
// tab is the raw escape hatch.
export default function ConfigOverrideEditor({
  configKey,
  patch,
  setPatch,
  constantContext,
  disabled,
}: {
  configKey: string;
  patch: string;
  setPatch: (value: string) => void;
  constantContext?: { project?: string; excludeKeys?: string[] };
  disabled?: boolean;
}): React.ReactElement {
  const { data, error } = useApi<ResolvedResponse>(
    `/configs/${encodeURIComponent(configKey)}/resolved`,
  );

  const overrides = useMemo(() => parseOverrides(patch), [patch]);

  const baseByKey = useMemo(() => {
    const map = new Map<string, unknown>();
    (data?.fields ?? []).forEach((f) => map.set(f.key, f.value));
    return map;
  }, [data]);

  const setOverride = (key: string, value: unknown) => {
    const next = { ...(overrides ?? {}) };
    next[key] = value;
    setPatch(JSON.stringify(next, null, 2));
  };

  const removeOverride = (key: string) => {
    const next = { ...(overrides ?? {}) };
    delete next[key];
    setPatch(JSON.stringify(next, null, 2));
  };

  // Rename a custom (non-schema) override key in place, preserving its value and
  // the surrounding key order.
  const renameOverride = (oldKey: string, newKey: string) => {
    const src = overrides ?? {};
    const next: Record<string, unknown> = {};
    Object.keys(src).forEach((k) => {
      next[k === oldKey ? newKey : k] = src[k];
    });
    setPatch(JSON.stringify(next, null, 2));
  };

  // Schema fields first, then any patch keys not present in the schema (stray
  // overrides) so they remain visible and removable.
  const rows = useMemo(() => {
    const schema = data?.effectiveSchema ?? [];
    const schemaKeys = new Set(schema.map((f) => f.key));
    const out: { key: string; field: SchemaField | null }[] = schema.map(
      (f) => ({ key: f.key, field: f }),
    );
    Object.keys(overrides ?? {}).forEach((k) => {
      if (k !== DIRECTIVE_KEY && !schemaKeys.has(k)) {
        out.push({ key: k, field: null });
      }
    });
    return out;
  }, [data, overrides]);

  const seedValue = (key: string, field: SchemaField | null): unknown => {
    const base = baseByKey.get(key);
    if (base !== undefined) return base;
    // Custom (non-schema) keys default to an empty string; the row's type
    // selector changes the type afterward.
    if (!field) return "";
    return typeDefault(normalizeField(field));
  };

  // Purely visual — the patch is already sparse. Start in the overrides-only
  // view so users add fields from the picker instead of scrolling.
  const [showAll, setShowAll] = useState(false);
  const sparse = !showAll;
  // Extensible families tolerate override keys beyond the declared schema.
  const extensible = data?.extensible ?? true;
  const overrideKeys = new Set(
    Object.keys(overrides ?? {}).filter((k) => k !== DIRECTIVE_KEY),
  );
  const visibleRows = sparse
    ? rows.filter((r) => overrideKeys.has(r.key))
    : rows;
  const addableFields = (data?.effectiveSchema ?? []).filter(
    (f) => !overrideKeys.has(f.key),
  );
  // Keys a custom key can't be renamed onto: declared schema fields plus the
  // current override keys.
  const takenKeys = new Set<string>(overrideKeys);
  (data?.effectiveSchema ?? []).forEach((f) => takenKeys.add(f.key));

  // Declared schema fields render first; custom (non-schema) keys are grouped
  // under their own header since they aren't schema-validated.
  const declaredRows = visibleRows.filter((r) => r.field !== null);
  const customRows = visibleRows.filter((r) => r.field === null);
  const renderRow = ({
    key,
    field,
  }: {
    key: string;
    field: SchemaField | null;
  }) => {
    const overridden = overrides ? key in overrides : false;
    const base = baseByKey.get(key);
    return (
      <OverrideRow
        key={`${configKey}:${key}`}
        field={field}
        fieldKey={key}
        base={base}
        overridden={overridden}
        value={overridden ? overrides?.[key] : undefined}
        onStart={() => setOverride(key, seedValue(key, field))}
        onSet={(v) => setOverride(key, v)}
        onRemove={() => removeOverride(key)}
        onRename={(newKey) => renameOverride(key, newKey)}
        takenKeys={takenKeys}
        constantContext={constantContext}
        disabled={disabled}
      />
    );
  };

  return (
    <Tabs defaultValue="form">
      <TabsList size="1">
        <TabsTrigger value="form">Form</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
        {data && overrides !== null && rows.length > 0 && (
          <Box style={{ marginLeft: "auto", alignSelf: "center" }}>
            <Switch
              size="1"
              label="Show all fields"
              value={showAll}
              onChange={(c) => setShowAll(c)}
              disabled={disabled}
            />
          </Box>
        )}
      </TabsList>

      <TabsContent value="form">
        <Box mt="2">
          {error ? (
            <Callout status="error">Failed to load config schema.</Callout>
          ) : !data ? (
            <Flex align="center" gap="2" py="3">
              <LoadingSpinner /> Loading config fields…
            </Flex>
          ) : overrides === null ? (
            <Callout status="warning">
              The current override isn&apos;t a plain JSON object. Edit it on
              the JSON tab.
            </Callout>
          ) : rows.length === 0 && !extensible ? (
            <Text color="text-low">This config defines no fields.</Text>
          ) : (
            <Box>
              <Box
                className="rounded"
                p="3"
                style={{ background: "var(--color-panel-solid)" }}
              >
                {visibleRows.length === 0 ? (
                  <Flex align="center" justify="center" py="3">
                    <Text size="small" color="text-low" fontStyle="italic">
                      No overrides — the config&apos;s values apply as-is. Add a
                      field below to override one.
                    </Text>
                  </Flex>
                ) : (
                  <>
                    {declaredRows.length > 0 && (
                      <>
                        <Heading as="h4" size="x-small" mb="1">
                          Schema Fields
                        </Heading>
                        <ColumnHeaderRow />
                      </>
                    )}
                    {declaredRows.map(renderRow)}
                    {customRows.length > 0 && (
                      <>
                        <Box mt={declaredRows.length > 0 ? "4" : "0"}>
                          {declaredRows.length > 0 && (
                            <Separator size="4" mb="3" />
                          )}
                          <Heading as="h4" size="x-small" mb="1">
                            Custom Overrides
                          </Heading>
                          <Text as="div" size="small" color="text-low" mb="2">
                            Not validated
                          </Text>
                        </Box>
                        <ColumnHeaderRow />
                      </>
                    )}
                    {customRows.map(renderRow)}
                  </>
                )}
              </Box>
              {(addableFields.length > 0 || extensible) && (
                <AddFieldControl
                  addableFields={addableFields}
                  extensible={extensible}
                  existingKeys={overrideKeys}
                  onAdd={(key) => {
                    const field =
                      data?.effectiveSchema.find((x) => x.key === key) ?? null;
                    setOverride(key, seedValue(key, field));
                  }}
                  disabled={disabled}
                />
              )}
            </Box>
          )}
        </Box>
      </TabsContent>

      <TabsContent value="json">
        <Box mt="2">
          <FeatureValueField
            id={`${configKey}-override-json`}
            value={patch}
            setValue={setPatch}
            valueType="json"
            useCodeInput
            showFullscreenButton
            constantContext={constantContext}
            disabled={disabled}
          />
        </Box>
      </TabsContent>
    </Tabs>
  );
}
