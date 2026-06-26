import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiBracketsCurly } from "react-icons/pi";
import { FaMagic } from "react-icons/fa";
import clsx from "clsx";
import { SchemaField, SimpleSchema } from "shared/types/feature";
import {
  fieldsToTsType,
  inferJsonSchemaForValue,
  jsonSchemaStringToFields,
  reconcileSchemaFields,
  SchemaConversionResult,
  simpleToJSONSchema,
  stripConfigExtends,
  tsTypesToFields,
} from "shared/util";
import { formatJSON } from "@/services/features";
import FeatureValueField from "@/components/Features/FeatureValueField";
import ValueDisplay from "@/components/Features/ValueDisplay";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import SplitButton from "@/ui/SplitButton";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { ResolvedField } from "@/components/Configs/fieldSchema";

// The schema editor speaks JSON Schema or TypeScript; both compile to the same
// SchemaField[]. JSON Schema stays the canonical/default surface.
type SchemaLang = "json" | "typescript";

type Props = {
  // Stable saved strings — local state reseeds whenever these change (after a
  // save/mutate or a revision switch), but not on unrelated parent re-renders.
  valueJson: string;
  schemaJson: string;
  // Schema field keys owned by an ancestor; declaring these is a "base wins"
  // collision (blocked), and values for them are overrides (not own fields).
  ancestorOwnedKeys: string[];
  // For the read-only preview of the fully-resolved value + effective schema.
  resolvedFields: ResolvedField[];
  effectiveSchema: SchemaField[];
  schemaType: SimpleSchema["type"];
  // Family extensibility ("Allow extra fields"); drives the schema's
  // `additionalProperties`. Draft-aware (reflects the displayed revision).
  extensible: boolean;
  constantContext: { project?: string; excludeKeys?: string[] };
  canEdit: boolean;
  // Which surface to render. The page owns the Form/JSON/Preview tab bar, so the
  // editor no longer carries its own Edit/Preview tabs. "preview" is read-only
  // and driven entirely by props (resolved value + effective schema).
  view?: "edit" | "preview";
  onSave: (
    value: Record<string, unknown>,
    fields: SchemaField[],
  ) => Promise<void>;
};

function prettyValue(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json || "{}"), null, 2);
  } catch {
    return json || "{}";
  }
}

function parseFields(json: string): SchemaField[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as SchemaField[]) : [];
  } catch {
    return [];
  }
}

function parsePlainObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function emptySchemaText(additionalProperties: boolean): string {
  return JSON.stringify(
    { type: "object", properties: {}, additionalProperties },
    null,
    2,
  );
}

// Compile a set of fields into the editable schema buffer for the active
// language. JSON Schema is pretty-printed; TypeScript emits a `.d.ts`-style
// interface. `additionalProperties` reflects family extensibility.
function compileFieldsToText(
  fields: SchemaField[],
  type: SimpleSchema["type"],
  additionalProperties: boolean,
  lang: SchemaLang,
): string {
  if (lang === "typescript") {
    return fieldsToTsType(fields, { additionalProperties });
  }
  if (!fields.length) return emptySchemaText(additionalProperties);
  try {
    return JSON.stringify(
      JSON.parse(simpleToJSONSchema({ type, fields, additionalProperties })),
      null,
      2,
    );
  } catch {
    return emptySchemaText(additionalProperties);
  }
}

// Parse the editable buffer back to fields for the active language. Both
// converters return the uniform `SchemaConversionResult` shape.
function parseSchemaText(
  text: string,
  lang: SchemaLang,
): SchemaConversionResult {
  return lang === "typescript"
    ? tsTypesToFields(text)
    : jsonSchemaStringToFields(text);
}

// Seed the editable schema buffer from the config's declared own fields (or an
// empty object schema for a config that declares none yet).
function seedSchemaText(
  schemaJson: string,
  type: SimpleSchema["type"],
  additionalProperties: boolean,
  lang: SchemaLang,
): string {
  return compileFieldsToText(
    parseFields(schemaJson),
    type,
    additionalProperties,
    lang,
  );
}

// Compile fields to a JSON Schema string for read-only display. `simpleToJSONSchema`
// already returns JSON text (and throws on an empty/invalid schema), so we hand
// that string straight to the renderer — never re-stringify it.
function schemaToJsonString(
  type: SimpleSchema["type"],
  fields: SchemaField[],
  additionalProperties: boolean,
): string | null {
  if (!fields.length) return null;
  try {
    return simpleToJSONSchema({ type, fields, additionalProperties });
  } catch {
    return null;
  }
}

export default function ConfigJsonEditor({
  valueJson,
  schemaJson,
  ancestorOwnedKeys,
  resolvedFields,
  effectiveSchema,
  schemaType,
  extensible,
  constantContext,
  canEdit,
  view = "edit",
  onSave,
}: Props) {
  const [valueText, setValueText] = useState<string>(() =>
    prettyValue(valueJson),
  );
  const [schemaText, setSchemaText] = useState<string>(() =>
    seedSchemaText(schemaJson, schemaType, extensible, "json"),
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Schema editor surface: Ace code editor (default) vs. a plain textarea, with
  // a Format JSON action — mirrors the value editor's CTAs.
  const [schemaCodeMode, setSchemaCodeMode] = useState(true);
  // Active schema language. Held in a ref too so the reseed effect (which must
  // not re-run on a language switch) can read the current language.
  const [schemaLang, setSchemaLang] = useState<SchemaLang>("json");
  const schemaLangRef = useRef<SchemaLang>(schemaLang);
  useEffect(() => {
    schemaLangRef.current = schemaLang;
  }, [schemaLang]);

  // Value keys we've already auto-seeded into the schema. Each new key is added
  // once; after that the author fully owns the schema text (no clobber/re-add).
  const seededKeys = useRef<Set<string>>(new Set());

  const ancestorOwnedSig = ancestorOwnedKeys.join(",");
  const ancestorOwned = useMemo(
    () => new Set(ancestorOwnedKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ancestorOwnedSig],
  );

  // Reseed when the saved value/schema changes (post-save mutate, revision switch).
  useEffect(() => {
    setValueText(prettyValue(valueJson));
  }, [valueJson]);
  useEffect(() => {
    setSchemaText(
      seedSchemaText(schemaJson, schemaType, extensible, schemaLangRef.current),
    );
    seededKeys.current = new Set();
  }, [schemaJson, schemaType, extensible]);

  // Live assist (draft only): when the value introduces a brand-new own key,
  // splice a best-guess property into the schema once. Existing properties — and
  // any key the author already removed — are left alone. Override keys
  // (ancestor-owned) are never added; they belong to a parent. Only JSON Schema
  // is auto-grown (TS is hand-edited; reconciliation keeps saves clean).
  useEffect(() => {
    if (!canEdit || view === "preview") return;
    const valueObj = parsePlainObject(valueText);
    if (!valueObj) {
      setParseError(valueText.trim() ? "Value must be a JSON object" : null);
      return;
    }
    setParseError(null);
    // Auto-grow only applies to JSON Schema; TS schemas are hand-edited.
    if (schemaLang !== "json") return;
    const valueKeys = Object.keys(valueObj).filter((k) => k !== "$extends");
    setSchemaText((prev) => {
      const schemaObj = parsePlainObject(prev);
      if (!schemaObj) return prev; // mid-edit / invalid — don't touch
      const props =
        schemaObj.properties &&
        typeof schemaObj.properties === "object" &&
        !Array.isArray(schemaObj.properties)
          ? { ...(schemaObj.properties as Record<string, unknown>) }
          : {};
      const required = new Set(
        Array.isArray(schemaObj.required)
          ? (schemaObj.required as unknown[]).filter(
              (r): r is string => typeof r === "string",
            )
          : [],
      );
      let changed = false;
      for (const k of valueKeys) {
        if (k in props || seededKeys.current.has(k) || ancestorOwned.has(k)) {
          continue;
        }
        props[k] = inferJsonSchemaForValue(valueObj[k]);
        required.add(k);
        seededKeys.current.add(k);
        changed = true;
      }
      if (!changed) return prev;
      const next = {
        ...schemaObj,
        type: schemaObj.type ?? "object",
        properties: props,
        required: [...required],
      };
      return JSON.stringify(next, null, 2);
    });
  }, [valueText, ancestorOwned, canEdit, schemaLang, view]);

  const parsedSchema = useMemo(
    () => parseSchemaText(schemaText, schemaLang),
    [schemaText, schemaLang],
  );
  const fields = parsedSchema.fields;
  const schemaError = parsedSchema.error;
  const schemaWarnings = parsedSchema.warnings;

  // Switch the schema language: recompile the current fields into the target
  // language so existing definitions carry over (no blank slate / lost work).
  const switchSchemaLang = (next: SchemaLang) => {
    if (next === schemaLang) return;
    setSchemaText(compileFieldsToText(fields, schemaType, extensible, next));
    setSchemaLang(next);
    seededKeys.current = new Set();
  };

  const conflictKeys = useMemo(
    () => fields.map((f) => f.key).filter((k) => ancestorOwned.has(k)),
    [fields, ancestorOwned],
  );

  const ownSchemaString = useMemo(
    () => schemaToJsonString(schemaType, fields, extensible),
    [schemaType, fields, extensible],
  );
  const effectiveSchemaString = useMemo(
    () => schemaToJsonString(schemaType, effectiveSchema, extensible),
    [schemaType, effectiveSchema, extensible],
  );
  const resolvedValueString = useMemo(() => {
    const obj: Record<string, unknown> = {};
    for (const f of resolvedFields) obj[f.key] = f.value;
    return JSON.stringify(obj);
  }, [resolvedFields]);

  const canSave =
    canEdit &&
    !parseError &&
    !schemaError &&
    conflictKeys.length === 0 &&
    !saving;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const stripped = stripConfigExtends(valueText) ?? valueText;
      const obj = JSON.parse(stripped) as Record<string, unknown>;
      // Reuse stored field objects for keys whose meaning is unchanged so a
      // no-op save doesn't rewrite them into canonical form (no spurious diff).
      const reconciled = reconcileSchemaFields(parseFields(schemaJson), fields);
      await onSave(obj, reconciled);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const columnHeader = (text: string) => (
    <Text weight="semibold" size="medium" as="div" mb="1">
      {text}
    </Text>
  );

  // A read-only JSON panel rendered with the same formatter feature flag rules
  // use (json-stringify-pretty-compact + constant linkify + copy/fullscreen).
  const readonlySchema = (jsonString: string | null): ReactNode =>
    jsonString ? (
      <ValueDisplay
        value={jsonString}
        type="json"
        showFullscreenButton
        fullStyle={{ maxHeight: 320, overflowY: "auto", maxWidth: "100%" }}
      />
    ) : (
      <Text size="medium" color="text-low" as="div">
        No schema defined.
      </Text>
    );

  const readonlyValue = (jsonString: string): ReactNode => (
    <ValueDisplay
      value={jsonString}
      type="json"
      showFullscreenButton
      fullStyle={{ maxHeight: 320, overflowY: "auto", maxWidth: "100%" }}
    />
  );

  const twoColumns = (left: ReactNode, right: ReactNode): ReactNode => (
    <Flex gap="5" align="start">
      <Box style={{ flex: "1 1 0", minWidth: 0 }}>{left}</Box>
      <Box style={{ flex: "1 1 0", minWidth: 0 }}>{right}</Box>
    </Flex>
  );

  // Schema editor CTAs (toggle Ace/textarea + Format JSON), styled to match the
  // value editor's links and rendered as the editor's helpText. Format JSON only
  // applies to the JSON Schema surface.
  const formattedSchema = schemaLang === "json" ? formatJSON(schemaText) : null;
  const schemaCtas = (
    <Flex gap="3" justify="end" width="100%">
      <a
        href="#"
        className="text-purple"
        style={{ whiteSpace: "nowrap" }}
        onClick={(e) => {
          e.preventDefault();
          setSchemaCodeMode((on) => !on);
        }}
      >
        <PiBracketsCurly />{" "}
        {schemaCodeMode ? "Use text editor" : "Use code editor"}
      </a>
      {schemaLang === "json" && (
        <a
          href="#"
          className={clsx("text-purple", {
            "text-muted cursor-default no-underline":
              !formattedSchema || formattedSchema === schemaText,
          })}
          style={{ whiteSpace: "nowrap" }}
          onClick={(e) => {
            e.preventDefault();
            if (formattedSchema && formattedSchema !== schemaText) {
              setSchemaText(formattedSchema);
            }
          }}
        >
          <FaMagic /> Format JSON
        </a>
      )}
    </Flex>
  );

  // Small split toggle that sets the schema language. Gray (not the primary
  // accent) so it reads as a subordinate, editor-local control.
  const schemaLangToggle = (
    <SplitButton variant="outline">
      {(["json", "typescript"] as const).map((lang) => (
        <Button
          key={lang}
          size="xs"
          color="gray"
          variant={schemaLang === lang ? "solid" : "outline"}
          onClick={() => switchSchemaLang(lang)}
        >
          {lang === "json" ? "JSON Schema" : "TypeScript"}
        </Button>
      ))}
    </SplitButton>
  );

  const schemaHeader = (
    <Flex justify="between" align="center" mb="1" gap="3">
      <Text weight="semibold" size="medium" as="div">
        Schema
      </Text>
      {schemaLangToggle}
    </Flex>
  );

  const editContent = (
    <>
      {conflictKeys.length > 0 && (
        <Callout status="warning" mb="3">
          {conflictKeys.map((k) => `"${k}"`).join(", ")}{" "}
          {conflictKeys.length === 1 ? "is" : "are"} already defined by a parent
          config. A parent always wins, so remove{" "}
          {conflictKeys.length === 1 ? "it" : "them"} from the schema to save.
        </Callout>
      )}
      {saveError && (
        <Callout status="error" mb="3">
          {saveError}
        </Callout>
      )}
      {twoColumns(
        <>
          <FeatureValueField
            id="config-json-value"
            label="Value"
            value={valueText}
            setValue={setValueText}
            valueType="json"
            useCodeInput
            showFullscreenButton
            codeInputDefaultHeight={320}
            constantContext={constantContext}
          />
          {parseError && (
            <div style={{ color: "var(--red-11)", fontSize: 12, marginTop: 4 }}>
              {parseError}
            </div>
          )}
        </>,
        <>
          {schemaHeader}
          {schemaCodeMode ? (
            <CodeTextArea
              language={schemaLang === "typescript" ? "typescript" : "json"}
              value={schemaText}
              setValue={setSchemaText}
              minLines={12}
              maxLines={40}
              fontSize="0.75em"
              helpText={schemaCtas}
            />
          ) : (
            <Field
              textarea
              minRows={12}
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              helpText={schemaCtas}
            />
          )}
          {schemaError && (
            <div style={{ color: "var(--red-11)", fontSize: 12, marginTop: 4 }}>
              {schemaError}
            </div>
          )}
          {schemaWarnings.length > 0 && (
            <div
              style={{ color: "var(--amber-11)", fontSize: 12, marginTop: 4 }}
            >
              {schemaWarnings.map((w) => w.message).join("; ")}
            </div>
          )}
        </>,
      )}
    </>
  );

  const previewContent = twoColumns(
    <>
      {columnHeader("Resolved value")}
      {readonlyValue(resolvedValueString)}
    </>,
    <>
      {columnHeader("Effective schema")}
      {readonlySchema(effectiveSchemaString)}
    </>,
  );

  // Resolved (read-only) view — resolved value + effective schema. Available on
  // every revision (draft or not) and driven entirely by props, so "Resolved"
  // always means the same thing.
  if (view === "preview") {
    return <Box mt="3">{previewContent}</Box>;
  }

  // Off-draft: read-only view of this config's own stored value + schema. "JSON"
  // always means the config's own definition; here it just isn't editable.
  if (!canEdit) {
    return (
      <Box mt="3">
        {twoColumns(
          <>
            {columnHeader("Value")}
            {readonlyValue(prettyValue(valueJson))}
          </>,
          <>
            {columnHeader("Schema")}
            {readonlySchema(ownSchemaString)}
          </>,
        )}
      </Box>
    );
  }

  // Editable value + schema, with Save anchored top-right.
  return (
    <Box mt="3">
      <Flex justify="end" mb="3">
        <Button onClick={handleSave} disabled={!canSave} loading={saving}>
          Save
        </Button>
      </Flex>
      {editContent}
    </Box>
  );
}
