import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiBracketsCurly, PiMagicWand } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
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
import Tooltip from "@/components/Tooltip/Tooltip";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
// eslint-disable-next-line no-restricted-imports
import Modal from "@/components/Modal";
import { ResolvedField } from "@/components/Configs/fieldSchema";

// Non-`json` ids match the converter ids (also a projection's `language`), so
// one dispatch map serves both the schema buffer and projections.
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

// Go's Ace mode is `golang`.
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
  resolvedFields: ResolvedField[];
  effectiveSchema: SchemaField[];
  schemaType: SimpleSchema["type"];
  // Family extensibility ("Allow extra fields"); drives the schema's
  // `additionalProperties`. Draft-aware (reflects the displayed revision).
  extensible: boolean;
  constantContext: { project?: string; excludeKeys?: string[] };
  canEdit: boolean;
  // "preview" is read-only and driven entirely by props (resolved value +
  // effective schema).
  view?: "edit" | "preview";
  // Parent config (when this is a child), used to clarify the empty-schema state
  // ("inherits base schema from …") rather than the bare "No schema defined."
  parentKey?: string | null;
  parentName?: string | null;
  // Captured per-source render projections (source id → named-type projection).
  // On a draft they're editable: editing the source re-derives the schema and
  // recaptures that source's names.
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

function parseSchemaText(
  text: string,
  lang: SchemaLang,
): SchemaConversionResult {
  return (CODE_PARSERS[lang] ?? jsonSchemaStringToFields)(text);
}

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

// A projection is edited in its own captured language; parse recaptures the
// projection's named-type structure alongside the fields.
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

// `simpleToJSONSchema` already returns JSON text, so hand it straight to the
// renderer — never re-stringify it.
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
  const [schemaCodeMode, setSchemaCodeMode] = useState(true);
  // Held in a ref too so the reseed effect (which must not re-run on a language
  // switch) can read the current language.
  const [schemaLang, setSchemaLang] = useState<SchemaLang>("json");
  // Display-only schema format for the read-only views, kept separate from the
  // editable buffer's language so viewing as e.g. TS never desyncs the edit
  // buffer. Per-column so a projection selection doesn't leak across views.
  const [ownSchemaSel, setOwnSchemaSel] = useState<string>("json");
  const [resolvedSchemaSel, setResolvedSchemaSel] = useState<string>("json");
  // Non-null means a read-only preview (Protobuf etc.) of the current fields —
  // the editable buffer is left untouched.
  const [schemaPreviewSel, setSchemaPreviewSel] = useState<string | null>(null);
  const [projectionText, setProjectionText] = useState<string>("");
  const [showNewProjection, setShowNewProjection] = useState(false);
  const [newProjSource, setNewProjSource] = useState("");
  const [newProjLang, setNewProjLang] = useState<ProjectionLang>("typescript");
  const schemaLangRef = useRef<SchemaLang>(schemaLang);
  useEffect(() => {
    schemaLangRef.current = schemaLang;
  }, [schemaLang]);

  // Value keys we've already auto-seeded into the schema; each is added once,
  // then the author fully owns the schema text (no clobber/re-add).
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
  // splice a best-guess property into the schema once. Keys the author removed,
  // and ancestor-owned override keys, are left alone. JSON Schema only.
  useEffect(() => {
    if (!canEdit || view === "preview") return;
    const valueObj = parsePlainObject(valueText);
    if (!valueObj) {
      setParseError(valueText.trim() ? "Value must be a JSON object" : null);
      return;
    }
    setParseError(null);
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

  // Recompile the current fields into the target language so existing
  // definitions carry over (no blank slate / lost work).
  const switchSchemaLang = (next: SchemaLang) => {
    if (next === schemaLang) return;
    // A buffer with a parse error yields empty fields — switching now would
    // wipe the draft. Keep the current language until the error is fixed.
    if (schemaError) return;
    setSchemaText(compileFieldsToText(fields, schemaType, extensible, next));
    setSchemaLang(next);
    seededKeys.current = new Set();
  };

  // JSON Schema + every typed-code language edit in place; a `proj:<source>`
  // selection is a named projection (its own editable buffer / preview).
  const onEditorFormatSelect = (v: string) => {
    if (v === "json" || v in CODE_RENDERERS) {
      setSchemaPreviewSel(null);
      switchSchemaLang(v as SchemaLang);
    } else {
      // Save ignores the schema buffer while a projection is active, so
      // switching with unsaved schema edits would silently drop them.
      if (!schemaPreviewSel && schemaText !== pristineSchema) return;
      setSchemaPreviewSel(v);
    }
  };

  // The config's own stored fields, independent of the editable buffer — drives
  // the read-only schema display so its language toggle flips only the rendering.
  const ownFields = useMemo(() => parseFields(schemaJson), [schemaJson]);
  const ownSchemaString = useMemo(
    () => schemaToJsonString(schemaType, ownFields, extensible),
    [schemaType, ownFields, extensible],
  );
  const effectiveSchemaString = useMemo(
    () => schemaToJsonString(schemaType, effectiveSchema, extensible),
    [schemaType, effectiveSchema, extensible],
  );

  // Projection editing (draft only): editing the selected source re-derives the
  // config schema and recaptures that source's named types — staged together.
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
  // Keystrokes update `projectionText` directly, so this never clobbers edits.
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

  // Fields backing the active surface: projection buffer or schema buffer.
  const activeFields =
    editingProjection && parsedProjection ? parsedProjection.fields : fields;
  const conflictKeys = useMemo(
    () => activeFields.map((f) => f.key).filter((k) => ancestorOwned.has(k)),
    [activeFields, ancestorOwned],
  );

  // Conversion is lossy-by-design; the resulting warnings are informational and
  // never block a save (only a hard parse error does).
  const resolvedValueString = useMemo(() => {
    const obj: Record<string, unknown> = {};
    for (const f of resolvedFields) obj[f.key] = f.value;
    return JSON.stringify(obj);
  }, [resolvedFields]);

  // What Cancel reverts to. A clean language switch round-trips to the same
  // text, so it doesn't read as a change.
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
      // Reuse stored field objects for unchanged keys so a no-op save doesn't
      // rewrite them into canonical form (no spurious diff).
      const reconciled = reconcileSchemaFields(
        parseFields(schemaJson),
        activeFields,
      );
      if (editingProjection && projectionSource && parsedProjection) {
        // A language with no names yields an empty projection.
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

  // Menu actions operate on the saved value, not the editable buffer, so they
  // never drag in unrelated value edits.
  const savedValueObject = (): Record<string, unknown> =>
    parsePlainObject(valueJson) ?? {};

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

  const readonlyJsonSchema = (jsonString: string): ReactNode => (
    <ValueDisplay
      value={jsonString}
      type="json"
      showFullscreenButton
      fullStyle={{ maxHeight: 320, overflowY: "auto", maxWidth: "100%" }}
      fontSize="0.75rem"
    />
  );

  // Uses the syntax highlighter rather than a disabled code editor. A projection
  // reproduces named types.
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

  // A child with no own schema still inherits its parent's; say so rather than
  // the bare "No schema defined."
  const ownSchemaEmptyState: ReactNode =
    parentKey && parentName ? (
      <Text size="medium" color="text-low" as="div">
        No additional schema defined — inherits the base schema from{" "}
        <Link href={`/configs/${parentKey}`}>{parentName}</Link>.
      </Text>
    ) : undefined;

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
          // Fall back so a legacy projection never renders "(undefined)".
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
                      <Tooltip
                        flipTheme={false}
                        body={
                          <Text size="small" color="text-high">
                            Differs from the published version
                          </Text>
                        }
                        style={{
                          position: "relative",
                          zIndex: 1000,
                          display: "inline-flex",
                          alignItems: "center",
                          flexShrink: 0,
                          padding: 6,
                          margin: -6,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: "var(--amber-9)",
                          }}
                        />
                      </Tooltip>
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

  // Format JSON only applies to the JSON Schema surface.
  const formattedSchema = schemaLang === "json" ? formatJSON(schemaText) : null;
  const formatDisabled = !formattedSchema || formattedSchema === schemaText;
  const schemaCtas = (
    <Flex gap="3" justify="end" width="100%">
      <Link
        style={{ whiteSpace: "nowrap" }}
        onClick={(e) => {
          e.preventDefault();
          setSchemaCodeMode((on) => !on);
        }}
      >
        <PiBracketsCurly />{" "}
        {schemaCodeMode ? "Use text editor" : "Use code editor"}
      </Link>
      {schemaLang === "json" && (
        <Link
          color={formatDisabled ? "gray" : undefined}
          style={{
            whiteSpace: "nowrap",
            cursor: formatDisabled ? "default" : undefined,
          }}
          onClick={(e) => {
            e.preventDefault();
            if (formattedSchema && formattedSchema !== schemaText) {
              setSchemaText(formattedSchema);
            }
          }}
        >
          <PiMagicWand /> Format JSON
        </Link>
      )}
    </Flex>
  );

  const schemaHeader = (
    <Flex
      justify="between"
      align="center"
      mb="1"
      gap="3"
      // Fixed label-row height so it lines up with the value editor's.
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
        <HelperText status="error">{parsedProjection.error}</HelperText>
      )}
      {!!parsedProjection?.warnings.length && (
        <HelperText status="warning" mt="2">
          {parsedProjection.warnings.map((w) => w.message).join("; ")}
        </HelperText>
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
            // Fixed-height label row so both editors start at the same y.
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
          {parseError && <HelperText status="error">{parseError}</HelperText>}
        </>,
        <>
          {schemaHeader}
          {editingProjection ? (
            // Editable named-source projection — derives the schema on save.
            projectionEditor
          ) : schemaPreviewSel ? (
            // Read-only preview of the current fields (e.g. a projection that's
            // since been removed); typed-code languages otherwise edit in place.
            renderReadonlySchema(
              schemaPreviewSel,
              fields,
              schemaToJsonString(schemaType, fields, extensible) ?? "",
              renderProjections,
            )
          ) : (
            <>
              {schemaCodeMode ? (
                // Remount per language: swapping Ace's mode in place can leave
                // the session unable to register keystrokes (TS most often).
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
                <HelperText status="error">{schemaError}</HelperText>
              )}
              {schemaWarnings.length > 0 && (
                <HelperText status="warning" mt="2">
                  {schemaWarnings.map((w) => w.message).join("; ")}
                </HelperText>
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

  if (view === "preview") {
    return <Box mt="3">{previewContent}</Box>;
  }

  // Off-draft: read-only view of this config's own stored value + schema.
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
