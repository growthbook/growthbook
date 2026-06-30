import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiBracketsCurly } from "react-icons/pi";
import { FaMagic } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import clsx from "clsx";
import { SchemaField, SimpleSchema } from "shared/types/feature";
import {
  fieldsToTsType,
  fieldsToProto,
  fieldsToGolang,
  golangToFields,
  fieldsToRust,
  rustToFields,
  fieldsToPython,
  pythonToFields,
  inferJsonSchemaForValue,
  jsonSchemaStringToFields,
  protoToFields,
  reconcileSchemaFields,
  SchemaConversionResult,
  SchemaProjection,
  simpleToJSONSchema,
  stripConfigExtends,
  tsTypesToFields,
} from "shared/util";
import { formatJSON } from "@/services/features";
import FeatureValueField from "@/components/Features/FeatureValueField";
import ValueDisplay from "@/components/Features/ValueDisplay";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
// eslint-disable-next-line no-restricted-imports
import Modal from "@/components/Modal";
import { ResolvedField } from "@/components/Configs/fieldSchema";

// The schema editor speaks JSON Schema or one of the typed-code languages; all
// compile to the same SchemaField[]. JSON Schema stays the canonical/default
// surface. The non-`json` ids match the converter ids (also a projection's
// `language`), so one dispatch map serves both the schema buffer and projections.
type SchemaLang = "json" | "typescript" | "protobuf" | "python" | "go" | "rust";

type CodeRenderer = (
  fields: SchemaField[],
  opts: { additionalProperties: boolean; projection?: SchemaProjection },
) => string;

const CODE_RENDERERS: Record<string, CodeRenderer> = {
  typescript: fieldsToTsType,
  protobuf: fieldsToProto,
  python: fieldsToPython,
  go: fieldsToGolang,
  rust: fieldsToRust,
};

const CODE_PARSERS: Record<string, (text: string) => SchemaConversionResult> = {
  typescript: tsTypesToFields,
  protobuf: protoToFields,
  python: pythonToFields,
  go: golangToFields,
  rust: rustToFields,
};

// The CodeTextArea (Ace) mode for a typed-code language; Go's Ace mode is
// `golang`. JSON Schema is edited as `json`.
function aceMode(
  lang: string,
): "json" | "typescript" | "protobuf" | "golang" | "rust" | "python" {
  if (lang === "go") return "golang";
  if (
    lang === "typescript" ||
    lang === "protobuf" ||
    lang === "rust" ||
    lang === "python"
  ) {
    return lang;
  }
  return "json";
}

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
  // Parent config (when this is a child), used to clarify the empty-schema state
  // ("inherits base schema from …") rather than the bare "No schema defined."
  parentKey?: string | null;
  parentName?: string | null;
  // Captured per-source render projections (source id → named-type projection),
  // offered as named output options for this config's own schema. On a draft
  // they're editable: editing the named source re-derives the schema (which
  // projects into the Config) and recaptures that source's names.
  renderProjections?: Record<string, SchemaProjection>;
  // Schema-format option values (`json`/`typescript`/`protobuf`/`proj:<source>`)
  // whose backing data differs between this draft and the published config — the
  // editor renders an amber dot on those dropdown options.
  unpublishedFormats?: Set<string>;
  onSave: (
    value: Record<string, unknown>,
    fields: SchemaField[],
    // When provided, replaces the config's per-source projections (set/clear).
    renderProjections?: Record<string, SchemaProjection>,
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
  const render = CODE_RENDERERS[lang];
  if (render) return render(fields, { additionalProperties });
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
  return (CODE_PARSERS[lang] ?? jsonSchemaStringToFields)(text);
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

// A projection is edited in its own captured language. Seed renders the current
// fields with that source's named types; parse compiles the edited source back
// to fields AND recaptures the projection (named-type structure).
type ProjectionLang = SchemaProjection["language"];

function seedProjectionText(
  fields: SchemaField[],
  type: SimpleSchema["type"],
  additionalProperties: boolean,
  projection: SchemaProjection,
): string {
  const render = CODE_RENDERERS[projection.language];
  if (render) return render(fields, { additionalProperties, projection });
  return compileFieldsToText(fields, type, additionalProperties, "json");
}

function parseProjectionText(
  text: string,
  lang: ProjectionLang,
): SchemaConversionResult {
  return (CODE_PARSERS[lang] ?? jsonSchemaStringToFields)(text);
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
  parentKey,
  parentName,
  renderProjections,
  unpublishedFormats,
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
  // Display-only schema format for the read-only views, kept separate from the
  // editable buffer's language so viewing as TS never desyncs the JSON-seeded
  // edit buffer. A value of `proj:<source>` selects a named projection (own
  // schema only). Per-column so selecting a projection on the own schema doesn't
  // leak to the Resolved/effective view (different pointers).
  const [ownSchemaSel, setOwnSchemaSel] = useState<string>("json");
  const [resolvedSchemaSel, setResolvedSchemaSel] = useState<string>("json");
  // In the editable editor, JSON Schema / TypeScript are edited in place; other
  // formats (Protobuf, named projections) are read-only previews of the current
  // fields. Non-null means "previewing" — the editable buffer is left untouched.
  const [schemaPreviewSel, setSchemaPreviewSel] = useState<string | null>(null);
  // Editable buffer for the named-source projection currently selected (in its
  // captured language). Only used on a draft; reseeded from the saved fields +
  // projection whenever the selection or saved state changes.
  const [projectionText, setProjectionText] = useState<string>("");
  // "New projection" modal (source name + language).
  const [showNewProjection, setShowNewProjection] = useState(false);
  const [newProjSource, setNewProjSource] = useState("");
  const [newProjLang, setNewProjLang] = useState<ProjectionLang>("typescript");
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

  // Editor format selector: JSON Schema / TypeScript / Protobuf edit in place; a
  // named projection (`proj:<source>`) edits in its own buffer with name capture.
  const onEditorFormatSelect = (v: string) => {
    // JSON Schema + every typed-code language edit in place; a `proj:<source>`
    // selection is a named projection (its own editable buffer / preview).
    if (v === "json" || v in CODE_RENDERERS) {
      setSchemaPreviewSel(null);
      switchSchemaLang(v as SchemaLang);
    } else {
      setSchemaPreviewSel(v);
    }
  };

  // The config's own stored fields, independent of the editable buffer /
  // language toggle — drives the read-only (off-draft) schema display so the
  // language toggle there can flip purely the rendering, not the parse.
  const ownFields = useMemo(() => parseFields(schemaJson), [schemaJson]);
  const ownSchemaString = useMemo(
    () => schemaToJsonString(schemaType, ownFields, extensible),
    [schemaType, ownFields, extensible],
  );
  const effectiveSchemaString = useMemo(
    () => schemaToJsonString(schemaType, effectiveSchema, extensible),
    [schemaType, effectiveSchema, extensible],
  );

  // Projection editing (draft only): when a `proj:<source>` format is selected,
  // the named source becomes editable in its captured language. Editing it
  // re-derives the config schema (which projects into the value) and recaptures
  // that source's named-type structure — both staged together on the draft.
  const projectionSource = schemaPreviewSel?.startsWith("proj:")
    ? schemaPreviewSel.slice("proj:".length)
    : null;
  const activeProjection = projectionSource
    ? renderProjections?.[projectionSource]
    : undefined;
  const editingProjection =
    view === "edit" && canEdit && !!projectionSource && !!activeProjection;
  const projectionLang: ProjectionLang =
    activeProjection?.language ?? "typescript";
  const projectionSeed = useMemo(
    () =>
      activeProjection
        ? seedProjectionText(
            ownFields,
            schemaType,
            extensible,
            activeProjection,
          )
        : "",
    [activeProjection, ownFields, schemaType, extensible],
  );
  // Reseed when entering a projection or after the saved state changes (mutate);
  // keystrokes update `projectionText` directly, so this never clobbers edits.
  useEffect(() => {
    if (editingProjection) setProjectionText(projectionSeed);
  }, [editingProjection, projectionSeed]);
  const parsedProjection = useMemo(
    () =>
      editingProjection
        ? parseProjectionText(projectionText, projectionLang)
        : null,
    [editingProjection, projectionText, projectionLang],
  );

  // Fields backing the active surface: the projection buffer when editing one,
  // otherwise the JSON/TS schema buffer.
  const activeFields =
    editingProjection && parsedProjection ? parsedProjection.fields : fields;
  const conflictKeys = useMemo(
    () => activeFields.map((f) => f.key).filter((k) => ancestorOwned.has(k)),
    [activeFields, ancestorOwned],
  );

  // Conversion is lossy-by-design: unresolved/unrepresentable types degrade to a
  // permissive type (`any`/object), index signatures are skipped, etc. These are
  // all INFORMATIONAL — they never block the save (only a hard parse error does).
  // The schema saves with the degraded field; the warning tells you what was lost.
  const resolvedValueString = useMemo(() => {
    const obj: Record<string, unknown> = {};
    for (const f of resolvedFields) obj[f.key] = f.value;
    return JSON.stringify(obj);
  }, [resolvedFields]);

  // The value/schema exactly as they exist on this revision, in the active
  // schema language — what Cancel reverts the buffers to. A clean language
  // switch round-trips to the same text, so it doesn't read as a change.
  const pristineValue = prettyValue(valueJson);
  const pristineSchema = seedSchemaText(
    schemaJson,
    schemaType,
    extensible,
    schemaLang,
  );
  const projectionDirty =
    editingProjection && projectionText !== projectionSeed;
  const dirty =
    valueText !== pristineValue ||
    (editingProjection ? projectionDirty : schemaText !== pristineSchema);

  // Save mirrors Cancel: both only apply when there are unsaved edits. With
  // nothing changed there's nothing to save (or cancel).
  const canSave =
    canEdit &&
    dirty &&
    !parseError &&
    (editingProjection ? !parsedProjection?.error : !schemaError) &&
    conflictKeys.length === 0 &&
    !saving;

  const handleCancel = () => {
    setValueText(pristineValue);
    setSchemaText(pristineSchema);
    setProjectionText(projectionSeed);
    seededKeys.current = new Set();
    setParseError(null);
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const stripped = stripConfigExtends(valueText) ?? valueText;
      const obj = JSON.parse(stripped) as Record<string, unknown>;
      // Reuse stored field objects for keys whose meaning is unchanged so a
      // no-op save doesn't rewrite them into canonical form (no spurious diff).
      const reconciled = reconcileSchemaFields(
        parseFields(schemaJson),
        activeFields,
      );
      if (editingProjection && projectionSource && parsedProjection) {
        // The edited source derives the schema (above) AND recaptures its own
        // named types; a language with no names yields an empty projection.
        const captured = parsedProjection.projection ?? {
          language: projectionLang,
          typeNames: {},
        };
        await onSave(obj, reconciled, {
          ...(renderProjections ?? {}),
          [projectionSource]: captured,
        });
      } else {
        await onSave(obj, reconciled);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Menu actions operate on the config's saved value (not the editable buffer),
  // so creating/removing a projection never drags in unrelated value edits.
  const savedValueObject = (): Record<string, unknown> =>
    parsePlainObject(valueJson) ?? {};

  // Drop one source's projection (schema untouched). Routes through the same
  // save path with `renderProjections` cleared of that source.
  const handleRemoveProjection = async () => {
    if (!projectionSource) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = { ...(renderProjections ?? {}) };
      delete next[projectionSource];
      await onSave(savedValueObject(), parseFields(schemaJson), next);
      setSchemaPreviewSel(null);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Failed to remove projection",
      );
    } finally {
      setSaving(false);
    }
  };

  // Add a new named projection (empty named types = the default rendering in the
  // chosen language), then select it for editing. Schema is untouched.
  const handleNewProjection = async () => {
    const source = newProjSource.trim();
    if (!source) throw new Error("Enter a source name");
    if (renderProjections?.[source]) {
      throw new Error(`A projection for "${source}" already exists`);
    }
    await onSave(savedValueObject(), parseFields(schemaJson), {
      ...(renderProjections ?? {}),
      [source]: { language: newProjLang, typeNames: {} },
    });
    setSchemaPreviewSel(`proj:${source}`);
    setNewProjSource("");
    setNewProjLang("typescript");
  };

  const columnHeader = (text: string) => (
    <Text weight="semibold" size="medium" as="div" mb="1">
      {text}
    </Text>
  );

  // A read-only JSON panel rendered with the same formatter feature flag rules
  // use (json-stringify-pretty-compact + constant linkify + copy/fullscreen).
  const readonlyJsonSchema = (jsonString: string): ReactNode => (
    <ValueDisplay
      value={jsonString}
      type="json"
      showFullscreenButton
      fullStyle={{ maxHeight: 320, overflowY: "auto", maxWidth: "100%" }}
      fontSize="0.75rem"
    />
  );

  // Read-only rendering of a field set in a typed-code language, using the
  // standard syntax highlighter (the same renderer ValueDisplay uses for JSON)
  // rather than a disabled code editor. A projection reproduces named types.
  const readonlyCodeSchema = (
    lang: string,
    schemaFields: SchemaField[],
    projection?: SchemaProjection,
  ): ReactNode => {
    const render = CODE_RENDERERS[lang] ?? fieldsToTsType;
    return (
      <Box style={{ maxHeight: 320, overflowY: "auto", maxWidth: "100%" }}>
        <InlineCode
          language={lang === "go" ? "go" : (lang as "typescript")}
          code={render(schemaFields, {
            additionalProperties: extensible,
            projection,
          })}
          fontSize="0.75rem"
        />
      </Box>
    );
  };

  // A child config with no own schema still inherits its parent's; say so rather
  // than the bare "No schema defined." (which reads as "no schema at all").
  const ownSchemaEmptyState: ReactNode =
    parentKey && parentName ? (
      <Text size="medium" color="text-low" as="div">
        No additional schema defined — inherits the base schema from{" "}
        <Link href={`/configs/${parentKey}`}>{parentName}</Link>.
      </Text>
    ) : undefined;

  // Schema format picker for the read-only views: the generic conversions
  // (JSON Schema / TypeScript) sit ungrouped at the top (the defaults, no label),
  // and — when the config has captured projections — a labelled "Named
  // projections" group follows, each labelled with its source and language.
  // Selecting `proj:<source>` renders that consumer's named types.
  const LANG_LABELS: Record<string, string> = {
    typescript: "TypeScript",
    "json-schema": "JSON Schema",
    protobuf: "Protobuf",
    python: "Python",
    go: "Go",
    rust: "Rust",
  };
  const schemaFormatSelect = (
    sel: string,
    setSel: (v: string) => void,
    projections?: Record<string, SchemaProjection>,
    // Option values with unpublished (staged-but-not-published) changes; each
    // gets an amber dot. Only meaningful for the editable own-schema picker.
    dirtyValues?: Set<string>,
  ): ReactNode => {
    const options: Parameters<typeof SelectField>[0]["options"] = [
      { label: "JSON Schema", value: "json" },
      { label: "TypeScript", value: "typescript" },
      { label: "Protobuf", value: "protobuf" },
      { label: "Python", value: "python" },
      { label: "Go", value: "go" },
      { label: "Rust", value: "rust" },
    ];
    const entries = Object.entries(projections ?? {});
    if (entries.length) {
      options.push({
        label: "Named projections",
        options: entries.map(([source, p]) => ({
          // `language` is always set on capture; fall back defensively so a
          // legacy projection never renders "(undefined)".
          label: `${source} (${
            LANG_LABELS[p.language] ?? p.language ?? "TypeScript"
          })`,
          value: `proj:${source}`,
        })),
      });
    }
    return (
      <Box style={{ minWidth: 200 }}>
        <SelectField
          value={sel}
          onChange={setSel}
          options={options}
          sort={false}
          containerStyle={{ marginBottom: 0 }}
          formatOptionLabel={
            dirtyValues?.size
              ? (option) => (
                  <Flex align="center" justify="between" gap="2">
                    <span>{option.label}</span>
                    {dirtyValues.has(option.value) && (
                      <span
                        title="Unpublished changes"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "var(--amber-9)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </Flex>
                )
              : undefined
          }
        />
      </Box>
    );
  };

  const renderReadonlySchema = (
    sel: string,
    schemaFields: SchemaField[],
    jsonString: string,
    projections?: Record<string, SchemaProjection>,
  ): ReactNode => {
    if (sel.startsWith("proj:")) {
      const projection = projections?.[sel.slice("proj:".length)];
      if (projection) {
        return readonlyCodeSchema(
          projection.language,
          schemaFields,
          projection,
        );
      }
      return readonlyCodeSchema("typescript", schemaFields); // projection gone
    }
    if (sel in CODE_RENDERERS) return readonlyCodeSchema(sel, schemaFields);
    return readonlyJsonSchema(jsonString);
  };

  // Read-only schema column: heading + format picker + the schema rendered in
  // the chosen format. Used off-draft (own schema, with projections) and on the
  // Resolved tab (effective schema, generic conversions only).
  const readonlySchemaColumn = (
    sel: string,
    setSel: (v: string) => void,
    schemaFields: SchemaField[],
    jsonString: string | null,
    heading: string,
    opts?: {
      projections?: Record<string, SchemaProjection>;
      emptyState?: ReactNode;
    },
  ): ReactNode => (
    <>
      <Flex justify="between" align="center" mb="1" gap="3">
        <Text weight="semibold" size="medium" as="div">
          {heading}
        </Text>
        {schemaFields.length > 0 &&
          schemaFormatSelect(sel, setSel, opts?.projections)}
      </Flex>
      {schemaFields.length === 0 || jsonString === null
        ? (opts?.emptyState ?? (
            <Text size="medium" color="text-low" as="div">
              No schema defined.
            </Text>
          ))
        : renderReadonlySchema(
            sel,
            schemaFields,
            jsonString,
            opts?.projections,
          )}
    </>
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

  const schemaHeader = (
    <Flex
      justify="between"
      align="center"
      mb="1"
      gap="3"
      // Fixed label-row height so the schema editor lines up with the value
      // editor (the value column's label row uses the same height).
      style={{ minHeight: 40 }}
    >
      <Text weight="semibold" size="medium" as="div">
        Schema
      </Text>
      <Flex align="center" gap="1">
        {schemaFormatSelect(
          schemaPreviewSel ?? schemaLang,
          onEditorFormatSelect,
          renderProjections,
          unpublishedFormats,
        )}
        <DropdownMenu
          variant="soft"
          menuPlacement="end"
          triggerStyle={{ marginLeft: 0, marginRight: 0 }}
          trigger={
            <IconButton
              variant="ghost"
              color="gray"
              radius="full"
              size="2"
              highContrast
            >
              <BsThreeDotsVertical size={16} />
            </IconButton>
          }
        >
          <DropdownMenuItem onClick={() => setShowNewProjection(true)}>
            New projection
          </DropdownMenuItem>
          {editingProjection && (
            <DropdownMenuItem
              color="red"
              onClick={() => {
                if (!saving) handleRemoveProjection();
              }}
            >
              Remove projection
            </DropdownMenuItem>
          )}
        </DropdownMenu>
      </Flex>
    </Flex>
  );

  // Editable named-source projection, in its captured language.
  const projectionEditor = (
    <>
      <CodeTextArea
        key={`proj:${projectionSource}:${projectionLang}`}
        language={aceMode(projectionLang)}
        value={projectionText}
        setValue={setProjectionText}
        minLines={12}
        maxLines={40}
        fontSize="0.75em"
        showCopyButton
        showFullscreenButton
      />
      <HelperText status="info" size="sm" mt="1">
        <span>
          Editing <code>{projectionSource}</code>
          {
            " updates the config’s schema and recaptures this projection’s named types."
          }
        </span>
      </HelperText>
      {parsedProjection?.error && (
        <div style={{ color: "var(--red-11)", fontSize: 12, marginTop: 4 }}>
          {parsedProjection.error}
        </div>
      )}
      {!!parsedProjection?.warnings.length && (
        <div style={{ color: "var(--amber-11)", fontSize: 12, marginTop: 4 }}>
          {parsedProjection.warnings.map((w) => w.message).join("; ")}
        </div>
      )}
    </>
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
            // Fixed-height label row matching the schema column's so both
            // editors start at the same y.
            label={
              <Box
                style={{ display: "flex", alignItems: "center", minHeight: 40 }}
              >
                Value
              </Box>
            }
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
          {editingProjection ? (
            // Editable named-source projection — derives the schema on save.
            projectionEditor
          ) : schemaPreviewSel ? (
            // Read-only preview (Protobuf, or a projection that's since been
            // removed) of the current fields — JSON Schema / TypeScript edit
            // in place.
            renderReadonlySchema(
              schemaPreviewSel,
              fields,
              schemaToJsonString(schemaType, fields, extensible) ?? "",
              renderProjections,
            )
          ) : (
            <>
              {schemaCodeMode ? (
                // Remount on language switch: swapping Ace's mode in place can
                // leave the session unable to register keystrokes (TS most
                // often), so a fresh editor per language keeps it editable.
                <CodeTextArea
                  key={schemaLang}
                  language={aceMode(schemaLang)}
                  value={schemaText}
                  setValue={setSchemaText}
                  minLines={12}
                  maxLines={40}
                  fontSize="0.75em"
                  showCopyButton
                  showFullscreenButton
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
                <div
                  style={{ color: "var(--red-11)", fontSize: 12, marginTop: 4 }}
                >
                  {schemaError}
                </div>
              )}
              {schemaWarnings.length > 0 && (
                <div
                  style={{
                    color: "var(--amber-11)",
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  {schemaWarnings.map((w) => w.message).join("; ")}
                </div>
              )}
            </>
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
    readonlySchemaColumn(
      resolvedSchemaSel,
      setResolvedSchemaSel,
      effectiveSchema,
      effectiveSchemaString,
      "Effective schema",
    ),
  );

  const newProjectionModal = showNewProjection ? (
    <Modal
      open
      trackingEventModalType="config-new-projection"
      header="New projection"
      cta="Create"
      submit={handleNewProjection}
      close={() => {
        setShowNewProjection(false);
        setNewProjSource("");
        setNewProjLang("typescript");
      }}
    >
      <Field
        label="Source"
        placeholder="e.g. checkout-service"
        value={newProjSource}
        onChange={(e) => setNewProjSource(e.target.value)}
        helpText="A consumer/service name that identifies this projection."
      />
      <SelectField
        label="Language"
        value={newProjLang}
        onChange={(v) => setNewProjLang(v as ProjectionLang)}
        sort={false}
        options={[
          { label: "TypeScript", value: "typescript" },
          { label: "Protobuf", value: "protobuf" },
          { label: "Python", value: "python" },
          { label: "Go", value: "go" },
          { label: "Rust", value: "rust" },
        ]}
      />
    </Modal>
  ) : null;

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
          readonlySchemaColumn(
            ownSchemaSel,
            setOwnSchemaSel,
            ownFields,
            ownSchemaString,
            "Schema",
            { projections: renderProjections, emptyState: ownSchemaEmptyState },
          ),
        )}
      </Box>
    );
  }

  // Editable value + schema, with Save anchored top-right.
  return (
    <Box mt="3">
      <Flex justify="end" gap="2" mb="3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!canSave}
          loading={saving}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCancel}
          disabled={!dirty || saving}
        >
          Cancel
        </Button>
      </Flex>
      {editContent}
      {newProjectionModal}
    </Box>
  );
}
