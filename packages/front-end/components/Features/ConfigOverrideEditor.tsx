import React, { useMemo, useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { SchemaField } from "shared/types/feature";
import {
  PiInfo,
  PiPlusBold,
  PiTrash,
  PiArrowCounterClockwise,
} from "react-icons/pi";
import useApi from "@/hooks/useApi";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import {
  ResolvedField,
  fieldIsNullable,
  fieldTypeLabel,
  fieldValueType,
  normalizeField,
  typeDefault,
  valueToDisplayString,
} from "@/components/Configs/fieldSchema";

type ResolvedResponse = {
  effectiveSchema: SchemaField[];
  fields: ResolvedField[];
  extensible?: boolean;
};

const GRID_TEMPLATE = "minmax(120px, 220px) minmax(160px, 1fr) 110px 90px";

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
        onChange={(v) => onChange(v)}
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
          <Text size="small" color="text-mid">
            {jsonError}
          </Text>
        )}
      </Box>
    );
  }

  // Numbers can't carry a `@const:` ref, so they stay a plain numeric input.
  if (vt === "number") {
    return (
      <Field
        type="number"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const n = Number(t);
          onChange(t.trim() !== "" && Number.isFinite(n) ? n : t);
        }}
      />
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

function OverrideRow({
  field,
  fieldKey,
  base,
  overridden,
  value,
  onStart,
  onSet,
  onRemove,
  sparse,
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
  sparse: boolean;
  constantContext?: { project?: string; excludeKeys?: string[] };
  disabled?: boolean;
}): React.ReactElement {
  const nf = field ? normalizeField(field) : null;
  const vt = fieldValueType(nf);
  const nullable = fieldIsNullable(nf);
  const description = nf?.description?.trim();
  const isNull = overridden && value === null;

  return (
    <Grid
      columns={GRID_TEMPLATE}
      align="start"
      gapX="4"
      gapY="0"
      py="2"
      style={{ borderTop: "1px solid var(--slate-a4)" }}
    >
      <Flex align="center" gap="1" style={{ minHeight: 32, minWidth: 0 }}>
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
                field={field}
                fieldKey={fieldKey}
                value={value}
                onChange={onSet}
                constantContext={constantContext}
                disabled={disabled}
              />
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
                  <code>{JSON.stringify(typeDefault(nf))}</code> (default)
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
        <code style={{ color: "var(--slate-9)", fontSize: "0.8em" }}>
          {fieldTypeLabel(nf)}
        </code>
      </Flex>

      <Flex align="center" justify="end" style={{ minHeight: 32 }}>
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
              {sparse ? (
                <>
                  <PiTrash /> Remove
                </>
              ) : (
                <>
                  <PiArrowCounterClockwise /> Reset
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

  // Schema fields first, then any patch keys not present in the schema (stray
  // overrides) so they remain visible and removable.
  const rows = useMemo(() => {
    const schema = data?.effectiveSchema ?? [];
    const schemaKeys = new Set(schema.map((f) => f.key));
    const out: { key: string; field: SchemaField | null }[] = schema.map(
      (f) => ({ key: f.key, field: f }),
    );
    Object.keys(overrides ?? {}).forEach((k) => {
      if (!schemaKeys.has(k)) out.push({ key: k, field: null });
    });
    return out;
  }, [data, overrides]);

  const seedValue = (key: string, field: SchemaField | null): unknown => {
    const base = baseByKey.get(key);
    return base !== undefined
      ? base
      : typeDefault(field ? normalizeField(field) : null);
  };

  // Purely visual — the patch is already sparse. Start in the overrides-only
  // view so users add fields from the picker instead of scrolling.
  const [showAll, setShowAll] = useState(false);
  const sparse = !showAll;
  // Extensible families tolerate override keys beyond the declared schema.
  const extensible = data?.extensible ?? true;
  const overrideKeys = new Set(Object.keys(overrides ?? {}));
  const visibleRows = sparse
    ? rows.filter((r) => overrideKeys.has(r.key))
    : rows;
  const addableFields = (data?.effectiveSchema ?? []).filter(
    (f) => !overrideKeys.has(f.key),
  );

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
          ) : rows.length === 0 ? (
            <Text color="text-low">This config defines no fields.</Text>
          ) : (
            <Box>
              <Box
                className="rounded"
                p="3"
                style={{ background: "var(--color-panel-solid)" }}
              >
                <Grid columns={GRID_TEMPLATE} gapX="4" pb="1" align="center">
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
                {visibleRows.map(({ key, field }) => {
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
                      sparse={sparse}
                      constantContext={constantContext}
                      disabled={disabled}
                    />
                  );
                })}
              </Box>
              {sparse && (addableFields.length > 0 || extensible) && (
                <Box mt="2" style={{ maxWidth: 260 }}>
                  <SelectField
                    value=""
                    placeholder={
                      extensible
                        ? "Add or create a field…"
                        : "Add field to override…"
                    }
                    // Extensible families tolerate keys beyond the declared
                    // schema, so allow free-form new keys; strict families are
                    // limited to declared fields.
                    createable={extensible}
                    formatCreateLabel={(v) => `Add "${v}"`}
                    options={addableFields.map((f) => ({
                      value: f.key,
                      label: f.key,
                    }))}
                    onChange={(key) => {
                      if (!key) return;
                      const field =
                        data?.effectiveSchema.find((x) => x.key === key) ??
                        null;
                      setOverride(key, seedValue(key, field));
                    }}
                    disabled={disabled}
                  />
                </Box>
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
