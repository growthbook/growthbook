import { SchemaField } from "shared/types/feature";
import { simpleSchemaFieldToJSONSchema } from "../features";
import { normalizeField } from "./fields";
import {
  isIntegerSchemaNode,
  jsonPointerEscape,
  pascalCaseTypeName,
} from "./naming";
import { matchBraces, stripSlashComments } from "./parse-utils";
import { jsonSchemaStringToFields } from "./json-schema";
import {
  SchemaConversionResult,
  SchemaConverter,
  SchemaProjection,
  SchemaWarning,
} from "./types";

// Go structs <-> SchemaField[], a thin layer over the JSON Schema pivot — same
// strategy as the Protobuf converter. Best-effort parser for the common subset
// found in config-shaped structs: scalar fields, `[]T` slices, `*T` pointers
// (optional/nullable), `map[K]V`, and nested struct references. Anything outside
// that (interfaces, channels, embedded structs, generics) degrades to a
// permissive type WITH a warning rather than failing.
//
// Conventions: a field is required unless it's a pointer (`*T`) or its json tag
// carries `,omitempty`. The json tag supplies the key (falling back to the field
// name); a `json:"-"` field is skipped. Go has no enum type, so an enum renders
// as `string` with a documenting comment.

const MAX_NEST_DEPTH = 6;

const GO_SCALARS: Record<string, Record<string, unknown>> = {
  int: { type: "integer" },
  int8: { type: "integer" },
  int16: { type: "integer" },
  int32: { type: "integer" },
  int64: { type: "integer" },
  uint: { type: "integer" },
  uint8: { type: "integer" },
  uint16: { type: "integer" },
  uint32: { type: "integer" },
  uint64: { type: "integer" },
  float32: { type: "number" },
  float64: { type: "number" },
  string: { type: "string" },
  bool: { type: "boolean" },
};

type GoStruct = { name: string; body: string };

function collectStructs(text: string): GoStruct[] {
  const out: GoStruct[] = [];
  const re = /\btype\s+([A-Za-z_]\w*)\s+struct\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = re.lastIndex - 1;
    const { body } = matchBraces(text, open);
    out.push({ name: m[1], body });
    re.lastIndex = open + 1;
  }
  return out;
}

type ParsedGoField = {
  type: string; // raw type token, e.g. `*Foo`, `[]string`, `map[string]int`
  key: string; // json key (from tag, else field name)
  optional: boolean; // pointer or `,omitempty`
};

// `Name Type` optionally followed by a backtick struct tag, one per line.
function parseGoField(line: string): ParsedGoField | null {
  const m = line.match(/^([A-Za-z_]\w*)\s+([^\s`]+)(?:\s+`([^`]*)`)?$/);
  if (!m) return null;
  const fieldName = m[1];
  const rawType = m[2];
  const tag = m[3] ?? "";
  const jsonTag = tag.match(/json:"([^"]*)"/);
  const parts = jsonTag ? jsonTag[1].split(",") : [];
  const tagKey = parts[0] ?? "";
  if (tagKey === "-") return null;
  const optional = parts.includes("omitempty") || rawType.startsWith("*");
  return { type: rawType, key: tagKey || fieldName, optional };
}

function goFieldLines(body: string): string[] {
  return (
    body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      // Skip nested anonymous-struct braces and embedded-struct lines we can't model.
      .filter((l) => !l.includes("{") && !l.includes("}"))
  );
}

function typeTokenToNode(
  token: string,
  byName: Map<string, GoStruct>,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  let t = token;
  let nullable = false;
  if (t.startsWith("*")) {
    nullable = true;
    t = t.slice(1);
  }
  if (t.startsWith("[]")) {
    const items = typeTokenToNode(
      t.slice(2),
      byName,
      seen,
      depth + 1,
      path,
      warnings,
    );
    if (!items) {
      warnings.push({
        code: "unresolved-type",
        path,
        message: `${path}: slice item type "${t.slice(2)}" couldn't be resolved; items left untyped.`,
      });
      return { type: "array" };
    }
    return { type: "array", items };
  }
  const mapMatch = t.match(/^map\[[^\]]+\](.+)$/);
  if (mapMatch) {
    const valueNode = typeTokenToNode(
      mapMatch[1],
      byName,
      seen,
      depth + 1,
      path,
      warnings,
    );
    return {
      type: "object",
      ...(valueNode ? { additionalProperties: valueNode } : {}),
    };
  }
  let node: Record<string, unknown> | null = null;
  if (t in GO_SCALARS) node = { ...GO_SCALARS[t] };
  else {
    const decl = byName.get(t);
    if (decl && !seen.has(t) && depth <= MAX_NEST_DEPTH) {
      node = structBodyToNode(
        decl.body,
        byName,
        new Set([...seen, t]),
        depth + 1,
        path,
        warnings,
      );
    }
  }
  if (node && nullable && typeof node.type === "string") {
    node = { ...node, type: [node.type, "null"] };
  }
  return node;
}

function structBodyToNode(
  body: string,
  byName: Map<string, GoStruct>,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  if (depth > MAX_NEST_DEPTH) return null;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const line of goFieldLines(body)) {
    const field = parseGoField(line);
    if (!field) continue;
    const childPath = path ? `${path}.${field.key}` : field.key;
    const node = typeTokenToNode(
      field.type,
      byName,
      seen,
      depth,
      childPath,
      warnings,
    );
    if (!node) {
      warnings.push({
        code: "unresolved-type",
        path: childPath,
        message: `${childPath}: unresolved type "${field.type}"`,
      });
      properties[field.key] = {};
    } else {
      properties[field.key] = node;
    }
    if (!field.optional) required.push(field.key);
  }
  if (!Object.keys(properties).length) return null;
  const schema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length) schema.required = required;
  return schema;
}

// Strip every leading `*`, `[]`, and `map[...]` wrapper to the base type name,
// in any order/combination (e.g. `[]*Foo`, `*[]Foo`, `map[string]*Foo` → `Foo`).
function goBaseType(token: string): string {
  let prev: string;
  let t = token;
  do {
    prev = t;
    t = t
      .replace(/^\*/, "")
      .replace(/^\[\]/, "")
      .replace(/^map\[[^\]]+\]/, "");
  } while (t !== prev);
  return t;
}

function referencesIn(decl: GoStruct, byName: Map<string, GoStruct>): string[] {
  const refs: string[] = [];
  for (const line of goFieldLines(decl.body)) {
    const f = parseGoField(line);
    if (!f) continue;
    const token = goBaseType(f.type);
    if (byName.has(token) && token !== decl.name) refs.push(token);
  }
  return refs;
}

function selectRoot(
  structs: GoStruct[],
  byName: Map<string, GoStruct>,
): GoStruct | null {
  const referenced = new Set<string>();
  for (const d of structs)
    for (const r of referencesIn(d, byName)) referenced.add(r);
  return structs.find((d) => !referenced.has(d.name)) ?? structs[0] ?? null;
}

// JSON-Pointer path -> the Go struct name declared there (for round-trip render).
function captureStructNames(
  body: string,
  byName: Map<string, GoStruct>,
  pointer: string,
  seen: Set<string>,
  depth: number,
  out: Record<string, string>,
): void {
  if (depth > MAX_NEST_DEPTH) return;
  for (const line of goFieldLines(body)) {
    const field = parseGoField(line);
    if (!field) continue;
    const isArray = field.type.replace(/^\*/, "").startsWith("[]");
    const token = goBaseType(field.type);
    const decl = byName.get(token);
    if (!decl || seen.has(token)) continue;
    const seg = `/properties/${jsonPointerEscape(field.key)}`;
    const at = isArray ? `${pointer}${seg}/items` : `${pointer}${seg}`;
    out[at] = token;
    captureStructNames(
      decl.body,
      byName,
      at,
      new Set([...seen, token]),
      depth + 1,
      out,
    );
  }
}

export function golangToFields(text: string): SchemaConversionResult {
  const clean = stripSlashComments(text);
  const structs = collectStructs(clean);
  const byName = new Map(structs.map((d) => [d.name, d]));
  const root = selectRoot(structs, byName);
  if (!root) {
    return { fields: [], error: "No Go struct found", warnings: [] };
  }

  const warnings: SchemaWarning[] = [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const line of goFieldLines(root.body)) {
    const field = parseGoField(line);
    if (!field) continue;
    const node = typeTokenToNode(
      field.type,
      byName,
      new Set([root.name]),
      1,
      field.key,
      warnings,
    );
    if (!node) {
      warnings.push({
        code: "unresolved-type",
        path: field.key,
        message: `${field.key}: unresolved type "${field.type}"`,
      });
      properties[field.key] = {};
    } else {
      properties[field.key] = node;
    }
    if (!field.optional) required.push(field.key);
  }

  const doc: Record<string, unknown> = { type: "object", properties };
  if (required.length) doc.required = required;
  const result = jsonSchemaStringToFields(JSON.stringify(doc));

  const typeNames: Record<string, string> = {};
  captureStructNames(root.body, byName, "", new Set([root.name]), 1, typeNames);

  return {
    fields: result.fields,
    error: result.error,
    warnings: [...warnings, ...result.warnings],
    projection: { language: "go", rootName: root.name, typeNames },
  };
}

// =========================================================================
// Export: SchemaField[] -> Go structs. Inverse of the import; lossy where Go is
// more rigid than JSON Schema (enums become a documented `string`; nested
// objects become generated nested structs).
// =========================================================================

type GoRenderCtx = {
  pointer: string;
  projection?: SchemaProjection;
  emitted: Set<string>;
};

function childCtx(ctx: GoRenderCtx, seg: string): GoRenderCtx {
  return {
    pointer: ctx.pointer + seg,
    projection: ctx.projection,
    emitted: ctx.emitted,
  };
}

// The Go type for a node, generating nested structs into `nested`. Returns the
// type token + an optional trailing comment (e.g. enum values).
function goTypeFor(
  node: Record<string, unknown>,
  key: string,
  nested: string[],
  depth: number,
  ctx: GoRenderCtx,
): { token: string; comment?: string } {
  if (depth > MAX_NEST_DEPTH) return { token: "string", comment: "unknown" };
  const rawType = node.type;
  const types = (Array.isArray(rawType) ? rawType : [rawType]).filter(
    (t) => t !== "null",
  );
  const t = types.length === 1 ? types[0] : undefined;

  if (Array.isArray(node.enum) && node.enum.length) {
    const allowed = node.enum
      .filter((v) => v !== null)
      .map((v) => JSON.stringify(v))
      .join(", ");
    return { token: "string", comment: `one of: ${allowed}` };
  }
  if (t === "object") {
    const props = node.properties;
    if (!props || typeof props !== "object" || !Object.keys(props).length) {
      return { token: "map[string]interface{}", comment: "free-form object" };
    }
    let name =
      ctx.projection?.typeNames?.[ctx.pointer] ?? pascalCaseTypeName(key);
    if (ctx.emitted.has(name)) {
      let n = 2;
      while (ctx.emitted.has(`${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    ctx.emitted.add(name);
    nested.push(
      renderStruct(
        name,
        props as Record<string, unknown>,
        node,
        nested,
        depth,
        ctx,
      ),
    );
    return { token: name };
  }
  if (isIntegerSchemaNode(node, typeof t === "string" ? t : undefined)) {
    return { token: "int" };
  }
  if (t === "number") return { token: "float64" };
  if (t === "string") return { token: "string" };
  if (t === "boolean") return { token: "bool" };
  return { token: "interface{}", comment: "unknown" };
}

function renderField(
  node: Record<string, unknown>,
  key: string,
  required: boolean,
  nested: string[],
  depth: number,
  ctx: GoRenderCtx,
): string {
  const rawType = node.type;
  const isNullable = Array.isArray(rawType) && rawType.includes("null");
  const isArray =
    (Array.isArray(rawType) ? rawType : [rawType]).filter(
      (x) => x !== "null",
    )[0] === "array";

  let token: string;
  let comment: string | undefined;
  if (isArray) {
    const items =
      node.items && typeof node.items === "object"
        ? (node.items as Record<string, unknown>)
        : { type: "string" };
    ({ token, comment } = goTypeFor(
      items,
      key,
      nested,
      depth,
      childCtx(ctx, "/items"),
    ));
    token = `[]${token}`;
  } else {
    ({ token, comment } = goTypeFor(node, key, nested, depth, ctx));
    // Optional/nullable scalars & structs become pointers so absence is nil.
    if ((isNullable || !required) && !token.startsWith("map[")) {
      token = `*${token}`;
    }
  }
  const omit = isNullable || !required ? ",omitempty" : "";
  const line = `${pascalCaseTypeName(key)} ${token} \`json:"${key}${omit}"\``;
  return comment ? `${line} // ${comment}` : line;
}

function renderStruct(
  name: string,
  props: Record<string, unknown>,
  parent: Record<string, unknown>,
  nested: string[],
  depth: number,
  ctx: GoRenderCtx,
): string {
  const required = new Set(
    Array.isArray(parent.required)
      ? parent.required.filter((x): x is string => typeof x === "string")
      : [],
  );
  const lines = Object.entries(props).map(([k, v]) =>
    renderField(
      (v && typeof v === "object" ? v : {}) as Record<string, unknown>,
      k,
      required.has(k),
      nested,
      depth + 1,
      childCtx(ctx, `/properties/${jsonPointerEscape(k)}`),
    ),
  );
  return `type ${name} struct {\n${lines.map((l) => `\t${l}`).join("\n")}\n}`;
}

export function fieldsToGolang(
  fields: SchemaField[],
  opts?: {
    name?: string;
    additionalProperties?: boolean;
    projection?: SchemaProjection;
  },
): string {
  const rootName = opts?.projection?.rootName ?? opts?.name ?? "ConfigSchema";
  const nested: string[] = [];
  const baseCtx: GoRenderCtx = {
    pointer: "",
    projection: opts?.projection,
    emitted: new Set<string>([rootName]),
  };
  const requiredSet = new Set(
    fields.filter((f) => f.required).map((f) => f.key),
  );
  const props: Record<string, unknown> = {};
  for (const raw of fields) {
    const f = normalizeField(raw);
    try {
      props[f.key] =
        f.jsonSchema !== undefined
          ? JSON.parse(f.jsonSchema)
          : simpleSchemaFieldToJSONSchema(f);
    } catch {
      props[f.key] = { type: "string" };
    }
  }
  const root = renderStruct(
    rootName,
    props,
    { required: [...requiredSet] },
    nested,
    0,
    baseCtx,
  );
  return ["package config", root, ...nested].join("\n\n");
}

export const golangConverter: SchemaConverter = {
  id: "go",
  label: "Go",
  toFields: golangToFields,
  fromFields: fieldsToGolang,
};
