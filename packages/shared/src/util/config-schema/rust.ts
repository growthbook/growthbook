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

// Rust (serde) structs <-> SchemaField[] over the JSON Schema pivot. Best-effort:
// handles scalars, `Vec<T>`, `Option<T>`, `HashMap`/`BTreeMap`, and nested structs;
// anything else degrades to a permissive type.
//
// A field is optional if it's `Option<...>`. A preceding `#[serde(rename = "key")]`
// supplies the json key. `enum` bodies aren't modeled, so enums degrade to `string`.

const MAX_NEST_DEPTH = 6;

const RUST_SCALARS: Record<string, Record<string, unknown>> = {
  i8: { type: "integer" },
  i16: { type: "integer" },
  i32: { type: "integer" },
  i64: { type: "integer" },
  i128: { type: "integer" },
  isize: { type: "integer" },
  u8: { type: "integer" },
  u16: { type: "integer" },
  u32: { type: "integer" },
  u64: { type: "integer" },
  u128: { type: "integer" },
  usize: { type: "integer" },
  f32: { type: "number" },
  f64: { type: "number" },
  String: { type: "string" },
  "&str": { type: "string" },
  str: { type: "string" },
  bool: { type: "boolean" },
};

type RustStruct = { name: string; body: string };

function collectStructs(text: string): RustStruct[] {
  const out: RustStruct[] = [];
  const re = /\bstruct\s+([A-Za-z_]\w*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = re.lastIndex - 1;
    const { body } = matchBraces(text, open);
    out.push({ name: m[1], body });
    re.lastIndex = open + 1;
  }
  return out;
}

type ParsedRustField = {
  type: string;
  key: string;
  optional: boolean;
};

// A preceding `#[serde(rename = "KEY")]` supplies the json key for the next field.
function rustFieldLines(body: string): ParsedRustField[] {
  const out: ParsedRustField[] = [];
  let pendingRename: string | null = null;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("//")) continue;
    if (line.startsWith("#[")) {
      const rename = line.match(/rename\s*=\s*"([^"]*)"/);
      if (rename) pendingRename = rename[1];
      continue;
    }
    if (line.includes("{") || line.includes("}")) {
      pendingRename = null;
      continue;
    }
    const field = parseRustField(line, pendingRename);
    pendingRename = null;
    if (field) out.push(field);
  }
  return out;
}

function parseRustField(
  line: string,
  rename: string | null,
): ParsedRustField | null {
  const m = line.match(/^(?:pub\s+)?([A-Za-z_]\w*)\s*:\s*(.+?),?$/);
  if (!m) return null;
  const fieldName = m[1];
  const rawType = m[2].trim();
  const optional = /^Option\s*<.+>$/.test(rawType);
  return { type: rawType, key: rename ?? fieldName, optional };
}

function unwrapOption(token: string): string {
  const m = token.match(/^Option\s*<(.+)>$/);
  return m ? m[1].trim() : token;
}

function typeTokenToNode(
  token: string,
  byName: Map<string, RustStruct>,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  let t = token.trim();
  let nullable = false;
  const optMatch = t.match(/^Option\s*<(.+)>$/);
  if (optMatch) {
    nullable = true;
    t = optMatch[1].trim();
  }
  const vecMatch = t.match(/^Vec\s*<(.+)>$/);
  if (vecMatch) {
    const items = typeTokenToNode(
      vecMatch[1].trim(),
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
        message: `${path}: vec item type "${vecMatch[1].trim()}" couldn't be resolved; items left untyped.`,
      });
      return { type: "array" };
    }
    return { type: "array", items };
  }
  const mapMatch = t.match(/^(?:HashMap|BTreeMap)\s*<[^,]+,(.+)>$/);
  if (mapMatch) {
    const valueToken = mapMatch[1].trim();
    const valueNode = typeTokenToNode(
      valueToken,
      byName,
      seen,
      depth + 1,
      path,
      warnings,
    );
    // `HashMap<String, serde_json::Value>` is the permissive open-object
    // construct — `{type:"object"}` captures it losslessly, so no warning. A
    // TYPED value that can't be resolved genuinely loses its constraint.
    if (
      !valueNode &&
      valueToken !== "serde_json::Value" &&
      valueToken !== "Value"
    ) {
      warnings.push({
        code: "unresolved-type",
        path,
        message: `${path}: map value type "${valueToken}" couldn't be resolved; values left untyped.`,
      });
    }
    return {
      type: "object",
      ...(valueNode ? { additionalProperties: valueNode } : {}),
    };
  }
  let node: Record<string, unknown> | null = null;
  if (t in RUST_SCALARS) node = { ...RUST_SCALARS[t] };
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
  byName: Map<string, RustStruct>,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  if (depth > MAX_NEST_DEPTH) return null;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of rustFieldLines(body)) {
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

function referencesIn(
  decl: RustStruct,
  byName: Map<string, RustStruct>,
): string[] {
  const refs: string[] = [];
  for (const f of rustFieldLines(decl.body)) {
    const token = unwrapOption(f.type)
      .replace(/^Vec\s*<(.+)>$/, "$1")
      .replace(/^(?:HashMap|BTreeMap)\s*<[^,]+,(.+)>$/, "$1")
      .trim();
    if (byName.has(token) && token !== decl.name) refs.push(token);
  }
  return refs;
}

function selectRoot(
  structs: RustStruct[],
  byName: Map<string, RustStruct>,
): RustStruct | null {
  const referenced = new Set<string>();
  for (const d of structs)
    for (const r of referencesIn(d, byName)) referenced.add(r);
  return structs.find((d) => !referenced.has(d.name)) ?? structs[0] ?? null;
}

// JSON-Pointer path -> the Rust struct name declared there, for round-trip render.
function captureStructNames(
  body: string,
  byName: Map<string, RustStruct>,
  pointer: string,
  seen: Set<string>,
  depth: number,
  out: Record<string, string>,
): void {
  if (depth > MAX_NEST_DEPTH) return;
  for (const field of rustFieldLines(body)) {
    const inner = unwrapOption(field.type);
    const isArray = /^Vec\s*<.+>$/.test(inner);
    const token = inner
      .replace(/^Vec\s*<(.+)>$/, "$1")
      .replace(/^(?:HashMap|BTreeMap)\s*<[^,]+,(.+)>$/, "$1")
      .trim();
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

export function rustToFields(text: string): SchemaConversionResult {
  const clean = stripSlashComments(text);
  const structs = collectStructs(clean);
  const byName = new Map(structs.map((d) => [d.name, d]));
  const root = selectRoot(structs, byName);
  if (!root) {
    return { fields: [], error: "No Rust struct found", warnings: [] };
  }

  const warnings: SchemaWarning[] = [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of rustFieldLines(root.body)) {
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
    projection: { language: "rust", rootName: root.name, typeNames },
  };
}

// Export: SchemaField[] -> Rust structs. Lossy where Rust is more rigid than JSON
// Schema (enums become a documented `String`; nested objects become structs).

type RustRenderCtx = {
  pointer: string;
  projection?: SchemaProjection;
  emitted: Set<string>;
};

function childCtx(ctx: RustRenderCtx, seg: string): RustRenderCtx {
  return {
    pointer: ctx.pointer + seg,
    projection: ctx.projection,
    emitted: ctx.emitted,
  };
}

function snakeCaseIdent(key: string): string {
  const ident = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ident || "field";
}

function rustTypeFor(
  node: Record<string, unknown>,
  key: string,
  nested: string[],
  depth: number,
  ctx: RustRenderCtx,
): { token: string; comment?: string } {
  if (depth > MAX_NEST_DEPTH) return { token: "String", comment: "unknown" };
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
    return { token: "String", comment: `one of: ${allowed}` };
  }
  if (t === "object") {
    const props = node.properties;
    if (!props || typeof props !== "object" || !Object.keys(props).length) {
      return { token: "serde_json::Value", comment: "free-form object" };
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
    return { token: "i64" };
  }
  if (t === "number") return { token: "f64" };
  if (t === "string") return { token: "String" };
  if (t === "boolean") return { token: "bool" };
  return { token: "serde_json::Value", comment: "unknown" };
}

function renderField(
  node: Record<string, unknown>,
  key: string,
  required: boolean,
  nested: string[],
  depth: number,
  ctx: RustRenderCtx,
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
    ({ token, comment } = rustTypeFor(
      items,
      key,
      nested,
      depth,
      childCtx(ctx, "/items"),
    ));
    token = `Vec<${token}>`;
  } else {
    ({ token, comment } = rustTypeFor(node, key, nested, depth, ctx));
  }
  if (isNullable || !required) {
    token = `Option<${token}>`;
  }
  const ident = snakeCaseIdent(key);
  const lines: string[] = [];
  if (ident !== key) lines.push(`#[serde(rename = "${key}")]`);
  const fieldLine = `pub ${ident}: ${token},`;
  lines.push(comment ? `${fieldLine} // ${comment}` : fieldLine);
  return lines.join("\n    ");
}

function renderStruct(
  name: string,
  props: Record<string, unknown>,
  parent: Record<string, unknown>,
  nested: string[],
  depth: number,
  ctx: RustRenderCtx,
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
  return `#[derive(Serialize, Deserialize)]\npub struct ${name} {\n${lines
    .map((l) => `    ${l}`)
    .join("\n")}\n}`;
}

export function fieldsToRust(
  fields: SchemaField[],
  opts?: {
    name?: string;
    additionalProperties?: boolean;
    projection?: SchemaProjection;
  },
): string {
  const rootName = opts?.projection?.rootName ?? opts?.name ?? "ConfigSchema";
  const nested: string[] = [];
  const baseCtx: RustRenderCtx = {
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
  return [root, ...nested].join("\n\n");
}

export const rustConverter: SchemaConverter = {
  id: "rust",
  label: "Rust",
  toFields: rustToFields,
  fromFields: fieldsToRust,
};
