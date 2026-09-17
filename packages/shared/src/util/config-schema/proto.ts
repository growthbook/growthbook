import { SchemaField } from "shared/types/feature";
import { simpleSchemaFieldToJSONSchema } from "../features";
import { normalizeField } from "./fields";
import { isIntegerSchemaNode, pascalCaseTypeName } from "./naming";
import { matchBraces, stripSlashComments } from "./parse-utils";
import { jsonSchemaStringToFields } from "./json-schema";
import {
  SchemaConversionResult,
  SchemaConverter,
  SchemaProjection,
  SchemaWarning,
} from "./types";

// Protobuf (proto3) <-> SchemaField[], a thin layer over the JSON Schema pivot —
// the same strategy as the TypeScript converter. A pragmatic parser for the
// common proto3 subset found in config-shaped messages: scalar fields, nested
// `message` references, `enum` references, `repeated`, `optional`, and `map`.
// Anything outside that subset (oneof, groups, services, well-known types,
// extensions) degrades to a permissive type WITH a warning rather than failing.
//
// Conventions (proto3 has no `required`): a field is treated as required unless
// it carries the `optional` keyword. Nullable scalars use the well-known wrapper
// types (`google.protobuf.StringValue` etc.) since proto3 has no null — these
// round-trip, whereas `optional` would conflate nullable with not-required.
// Scalar/enum/message round-trip; `bytes` maps to string with a warning;
// `map<K,V>` becomes an open object keyed by V.

const MAX_NEST_DEPTH = 6;

const SCALARS: Record<string, Record<string, unknown>> = {
  double: { type: "number" },
  float: { type: "number" },
  int32: { type: "integer" },
  int64: { type: "integer" },
  uint32: { type: "integer" },
  uint64: { type: "integer" },
  sint32: { type: "integer" },
  sint64: { type: "integer" },
  fixed32: { type: "integer" },
  fixed64: { type: "integer" },
  sfixed32: { type: "integer" },
  sfixed64: { type: "integer" },
  bool: { type: "boolean" },
  string: { type: "string" },
};

type ProtoDecl = { kind: "message" | "enum"; name: string; body: string };

// Collect every `message`/`enum` declaration (nested included, flattened by
// simple name — proto scoping is ignored, good enough for resolving refs).
function collectDecls(text: string): ProtoDecl[] {
  const out: ProtoDecl[] = [];
  const re = /\b(message|enum)\s+([A-Za-z_]\w*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = re.lastIndex - 1;
    const { body } = matchBraces(text, open);
    out.push({ kind: m[1] as "message" | "enum", name: m[2], body });
    // Continue scanning from just inside the brace so nested decls are found too.
    re.lastIndex = open + 1;
  }
  return out;
}

// Enum value identifiers (proto enum values are the config's allowed strings).
function enumValues(body: string): string[] {
  const out: string[] = [];
  const re = /([A-Za-z_]\w*)\s*=\s*-?\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

// A message body minus nested type decls + oneof/reserved, leaving field lines.
function fieldStatements(body: string): string[] {
  let s = body;
  // Drop nested message/enum/oneof blocks (brace-matched).
  const blockRe = /\b(message|enum|oneof)\s+[A-Za-z_]?\w*\s*\{/;
  let mm: RegExpMatchArray | null;
  while ((mm = s.match(blockRe))) {
    const open = (mm.index ?? 0) + mm[0].length - 1;
    const { end } = matchBraces(s, open);
    s = s.slice(0, mm.index) + s.slice(end);
  }
  return s
    .split(";")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(reserved|option|extensions)\b/.test(l));
}

type ParsedField = {
  modifier: "repeated" | "optional" | "";
  rawType: string;
  name: string;
  num: number;
};

function parseField(stmt: string): ParsedField | null {
  const m = stmt.match(
    /^(repeated|optional)?\s*(map\s*<[^>]+>|[A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*=\s*(\d+)(?:\s*\[[^\]]*\])?$/,
  );
  if (!m) return null;
  return {
    modifier: (m[1] as "repeated" | "optional" | undefined) ?? "",
    rawType: m[2].replace(/\s+/g, ""),
    name: m[3],
    num: parseInt(m[4]),
  };
}

function typeTokenToNode(
  token: string,
  byName: Map<string, ProtoDecl>,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  if (token in SCALARS) return { ...SCALARS[token] };
  // Well-known wrapper types model a nullable scalar in proto3.
  if (token in WRAPPER_TO_SCALAR) {
    return { type: [WRAPPER_TO_SCALAR[token], "null"] };
  }
  if (token === "bytes") {
    warnings.push({
      code: "unresolved-type",
      path,
      message: `${path}: \`bytes\` has no JSON equivalent; treated as a (base64) string.`,
    });
    return { type: "string" };
  }
  const decl = byName.get(token);
  if (decl?.kind === "enum") {
    return { type: "string", enum: enumValues(decl.body) };
  }
  if (decl?.kind === "message") {
    if (seen.has(token) || depth > MAX_NEST_DEPTH) return null;
    return messageBodyToNode(
      decl.body,
      byName,
      new Set([...seen, token]),
      depth + 1,
      path,
      warnings,
    );
  }
  return null; // unknown / qualified / well-known type — caller falls back
}

function fieldNode(
  field: ParsedField,
  byName: Map<string, ProtoDecl>,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  const mapMatch = field.rawType.match(/^map<[^,]+,(.+)>$/);
  if (mapMatch) {
    const valueNode = typeTokenToNode(
      mapMatch[1],
      byName,
      seen,
      depth + 1,
      path,
      warnings,
    );
    // `map<string, google.protobuf.Value/Struct>` is the permissive
    // open-object construct — `{type:"object"}` captures it losslessly, so no
    // warning. A TYPED value that can't be resolved genuinely loses its
    // constraint.
    if (
      !valueNode &&
      mapMatch[1] !== "google.protobuf.Value" &&
      mapMatch[1] !== "google.protobuf.Struct"
    ) {
      warnings.push({
        code: "unresolved-type",
        path,
        message: `${path}: map value type "${mapMatch[1]}" couldn't be resolved; values left untyped.`,
      });
    }
    return {
      type: "object",
      ...(valueNode ? { additionalProperties: valueNode } : {}),
    };
  }
  if (field.modifier === "repeated") {
    const items = typeTokenToNode(
      field.rawType,
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
        message: `${path}: repeated item type "${field.rawType}" couldn't be resolved; items left untyped.`,
      });
      return { type: "array" };
    }
    return { type: "array", items };
  }
  return typeTokenToNode(field.rawType, byName, seen, depth, path, warnings);
}

function messageBodyToNode(
  body: string,
  byName: Map<string, ProtoDecl>,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  if (depth > MAX_NEST_DEPTH) return null;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const stmt of fieldStatements(body)) {
    const field = parseField(stmt);
    if (!field) continue;
    const childPath = path ? `${path}.${field.name}` : field.name;
    const node = fieldNode(field, byName, seen, depth, childPath, warnings);
    if (!node) return null;
    properties[field.name] = node;
    if (field.modifier !== "optional") required.push(field.name);
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

// Names referenced by a message's field types (for DAG root selection).
function referencesIn(
  decl: ProtoDecl,
  byName: Map<string, ProtoDecl>,
): string[] {
  if (decl.kind !== "message") return [];
  const refs: string[] = [];
  for (const stmt of fieldStatements(decl.body)) {
    const f = parseField(stmt);
    if (!f) continue;
    const token = f.rawType.replace(/^map<[^,]+,(.+)>$/, "$1");
    if (byName.has(token) && token !== decl.name) refs.push(token);
  }
  return refs;
}

// The root message is the one no other declaration references (top of the DAG).
function selectRoot(
  decls: ProtoDecl[],
  byName: Map<string, ProtoDecl>,
): ProtoDecl | null {
  const referenced = new Set<string>();
  for (const d of decls)
    for (const r of referencesIn(d, byName)) referenced.add(r);
  const messages = decls.filter((d) => d.kind === "message");
  return messages.find((d) => !referenced.has(d.name)) ?? messages[0] ?? null;
}

// Capture the source's named-message structure (for round-trip rendering): a
// map of JSON-Pointer path → the proto message name declared there. Mirrors the
// TypeScript converter's name capture (a repeated message records under `/items`).
function captureMessageNames(
  body: string,
  byName: Map<string, ProtoDecl>,
  pointer: string,
  seen: Set<string>,
  depth: number,
  out: Record<string, string>,
): void {
  if (depth > MAX_NEST_DEPTH) return;
  for (const stmt of fieldStatements(body)) {
    const field = parseField(stmt);
    if (!field || field.rawType.startsWith("map<")) continue;
    const decl = byName.get(field.rawType);
    if (decl?.kind !== "message" || seen.has(field.rawType)) continue;
    const at =
      field.modifier === "repeated"
        ? `${pointer}/properties/${field.name}/items`
        : `${pointer}/properties/${field.name}`;
    out[at] = field.rawType;
    captureMessageNames(
      decl.body,
      byName,
      at,
      new Set([...seen, field.rawType]),
      depth + 1,
      out,
    );
  }
}

// JSON-Pointer path → the source's wire number for that field, so a later
// export can replay the numbering instead of reassigning by position.
function captureFieldNumbers(
  body: string,
  byName: Map<string, ProtoDecl>,
  pointer: string,
  seen: Set<string>,
  depth: number,
  out: Record<string, number>,
): void {
  if (depth > MAX_NEST_DEPTH) return;
  for (const stmt of fieldStatements(body)) {
    const field = parseField(stmt);
    if (!field) continue;
    const at = `${pointer}/properties/${field.name}`;
    out[at] = field.num;
    if (field.rawType.startsWith("map<")) continue;
    const decl = byName.get(field.rawType);
    if (decl?.kind !== "message" || seen.has(field.rawType)) continue;
    captureFieldNumbers(
      decl.body,
      byName,
      field.modifier === "repeated" ? `${at}/items` : at,
      new Set([...seen, field.rawType]),
      depth + 1,
      out,
    );
  }
}

export function protoToFields(text: string): SchemaConversionResult {
  const clean = stripSlashComments(text);
  const decls = collectDecls(clean);
  const byName = new Map(decls.map((d) => [d.name, d]));
  const root = selectRoot(decls, byName);
  if (!root) {
    return {
      fields: [],
      error: "No proto message found",
      warnings: [],
    };
  }

  const warnings: SchemaWarning[] = [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const stmt of fieldStatements(root.body)) {
    const field = parseField(stmt);
    if (!field) continue;
    let node = fieldNode(
      field,
      byName,
      new Set([root.name]),
      1,
      field.name,
      warnings,
    );
    if (!node) {
      node = field.modifier === "repeated" ? { type: "array" } : {};
      warnings.push({
        code: "unresolved-type",
        path: field.name,
        message: `${field.name}: unresolved type "${field.rawType}"`,
      });
    }
    properties[field.name] = node;
    if (field.modifier !== "optional") required.push(field.name);
  }

  const doc: Record<string, unknown> = { type: "object", properties };
  if (required.length) doc.required = required;
  const result = jsonSchemaStringToFields(JSON.stringify(doc));

  const typeNames: Record<string, string> = {};
  captureMessageNames(
    root.body,
    byName,
    "",
    new Set([root.name]),
    1,
    typeNames,
  );
  const fieldNumbers: Record<string, number> = {};
  captureFieldNumbers(
    root.body,
    byName,
    "",
    new Set([root.name]),
    1,
    fieldNumbers,
  );

  return {
    fields: result.fields,
    error: result.error,
    warnings: [...warnings, ...result.warnings],
    projection: {
      language: "protobuf",
      rootName: root.name,
      typeNames,
      fieldNumbers,
    },
  };
}

// =========================================================================
// Export: SchemaField[] -> proto3. Inverse of the import; lossy where proto is
// more rigid than JSON Schema (enums become a documented string; nested objects
// become generated nested messages).
// =========================================================================

const SCALAR_OUT: Record<string, string> = {
  string: "string",
  boolean: "bool",
};

// proto3 has no null. The idiomatic way to express a nullable scalar is a
// well-known wrapper type, which (unlike the `optional` keyword) round-trips
// losslessly. Keyed by the proto scalar token we'd otherwise emit.
const NULLABLE_WRAPPER_FOR: Record<string, string> = {
  string: "google.protobuf.StringValue",
  bool: "google.protobuf.BoolValue",
  int32: "google.protobuf.Int32Value",
  double: "google.protobuf.DoubleValue",
};

const WRAPPER_TO_SCALAR: Record<
  string,
  "string" | "boolean" | "integer" | "number"
> = {
  "google.protobuf.StringValue": "string",
  "google.protobuf.BytesValue": "string",
  "google.protobuf.BoolValue": "boolean",
  "google.protobuf.Int32Value": "integer",
  "google.protobuf.Int64Value": "integer",
  "google.protobuf.UInt32Value": "integer",
  "google.protobuf.UInt64Value": "integer",
  "google.protobuf.FloatValue": "number",
  "google.protobuf.DoubleValue": "number",
};

// Render context: the JSON-Pointer of the node being rendered + the projection.
// A nested message uses the projection's captured name at its pointer, else a
// name generated from the field key.
type ProtoRenderCtx = {
  pointer: string;
  projection?: SchemaProjection;
  // Message names already emitted this render, so colliding object fields get a
  // distinct name instead of producing duplicate `message X {}` definitions
  // (invalid proto3). Shared by reference across the whole render.
  emitted: Set<string>;
};

function childCtx(
  ctx: ProtoRenderCtx | undefined,
  seg: string,
): ProtoRenderCtx {
  return {
    pointer: (ctx?.pointer ?? "") + seg,
    projection: ctx?.projection,
    emitted: ctx?.emitted ?? new Set<string>(),
  };
}

// Render the proto type for a node, generating nested messages into `nested`.
// Returns the type token plus an optional trailing line comment (e.g. enum
// allowed values). Arrays/optionality are handled by the caller.
function protoTypeFor(
  node: Record<string, unknown>,
  key: string,
  nested: string[],
  depth: number,
  ctx: ProtoRenderCtx,
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
      // An open object keyed by a value schema is a proto map — the inverse of
      // the import's `map<K,V>` handling, so maps round-trip instead of
      // degrading to a JSON string.
      const ap = node.additionalProperties;
      if (ap && typeof ap === "object" && !Array.isArray(ap)) {
        const value = protoTypeFor(
          ap as Record<string, unknown>,
          key,
          nested,
          depth + 1,
          childCtx(ctx, "/additionalProperties"),
        );
        return {
          token: `map<string, ${value.token}>`,
          comment: value.comment,
        };
      }
      return { token: "string", comment: "free-form object (JSON string)" };
    }
    let name =
      ctx.projection?.typeNames?.[ctx.pointer] ?? pascalCaseTypeName(key);
    // Disambiguate name collisions so each object field keeps its own message
    // (two `message X {}` blocks would be invalid proto3). Reserve before
    // recursing so nested fields can't reclaim the same name.
    if (ctx.emitted.has(name)) {
      let n = 2;
      while (ctx.emitted.has(`${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    ctx.emitted.add(name);
    nested.push(
      renderMessage(
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
    return { token: "int32" };
  }
  if (t === "number") return { token: "double" };
  if (typeof t === "string" && t in SCALAR_OUT) {
    return { token: SCALAR_OUT[t] };
  }
  return { token: "string", comment: "unknown" };
}

function renderField(
  node: Record<string, unknown>,
  key: string,
  num: number,
  required: boolean,
  nested: string[],
  depth: number,
  ctx: ProtoRenderCtx,
): string {
  const rawType = node.type;
  const isNullable = Array.isArray(rawType) && rawType.includes("null");
  const isArray =
    (Array.isArray(rawType) ? rawType : [rawType]).filter(
      (x) => x !== "null",
    )[0] === "array";

  let token: string;
  let comment: string | undefined;
  let modifier = "";
  if (isArray) {
    const items =
      node.items && typeof node.items === "object"
        ? (node.items as Record<string, unknown>)
        : { type: "string" };
    ({ token, comment } = protoTypeFor(
      items,
      key,
      nested,
      depth,
      childCtx(ctx, "/items"),
    ));
    // `repeated map<…>` is invalid proto3 — degrade the item to a JSON string.
    if (token.startsWith("map<")) {
      token = "string";
      comment = "free-form object (JSON string)";
    }
    modifier = "repeated ";
  } else {
    ({ token, comment } = protoTypeFor(node, key, nested, depth, ctx));
    // Nullable scalars → a wrapper type (round-trips). For nullable objects,
    // enums (which carry a `// one of` comment), and anything else a wrapper
    // can't represent, fall back to presence (`optional`), which is lossy —
    // except maps, where any label is invalid proto3.
    if (isNullable && comment === undefined && NULLABLE_WRAPPER_FOR[token]) {
      token = NULLABLE_WRAPPER_FOR[token];
      if (!required) modifier = "optional ";
    } else if ((isNullable || !required) && !token.startsWith("map<")) {
      modifier = "optional ";
    }
  }
  const line = `${modifier}${token} ${key} = ${num};`;
  return comment ? `${line} // ${comment}` : line;
}

// Wire numbers for one message's fields: replay the numbers captured on import
// (keyed by JSON pointer under `basePointer`); fields without a captured number
// (new since import, or no projection) get max+1 in declaration order.
function assignFieldNumbers(
  keys: string[],
  basePointer: string,
  projection?: SchemaProjection,
): Map<string, number> {
  const out = new Map<string, number>();
  const captured = projection?.fieldNumbers ?? {};
  let max = 0;
  for (const k of keys) {
    const n = captured[`${basePointer}/properties/${k}`];
    if (typeof n === "number") {
      out.set(k, n);
      if (n > max) max = n;
    }
  }
  for (const k of keys) {
    if (!out.has(k)) out.set(k, ++max);
  }
  return out;
}

function renderMessage(
  name: string,
  props: Record<string, unknown>,
  parent: Record<string, unknown>,
  nested: string[],
  depth: number,
  ctx: ProtoRenderCtx,
): string {
  const required = new Set(
    Array.isArray(parent.required)
      ? parent.required.filter((x): x is string => typeof x === "string")
      : [],
  );
  const nums = assignFieldNumbers(
    Object.keys(props),
    ctx.pointer,
    ctx.projection,
  );
  const lines = Object.entries(props).map(([k, v]) =>
    renderField(
      (v && typeof v === "object" ? v : {}) as Record<string, unknown>,
      k,
      nums.get(k) ?? 1,
      required.has(k),
      nested,
      depth + 1,
      childCtx(ctx, `/properties/${k}`),
    ),
  );
  return `message ${name} {\n${lines.map((l) => `  ${l}`).join("\n")}\n}`;
}

export function fieldsToProto(
  fields: SchemaField[],
  opts?: {
    name?: string;
    additionalProperties?: boolean;
    projection?: SchemaProjection;
  },
): string {
  const rootName = opts?.projection?.rootName ?? opts?.name ?? "ConfigSchema";
  const nested: string[] = [];
  // Seed with the root name so a nested message never duplicates it.
  const baseCtx: ProtoRenderCtx = {
    pointer: "",
    projection: opts?.projection,
    emitted: new Set<string>([rootName]),
  };
  const nums = assignFieldNumbers(
    fields.map((f) => f.key),
    "",
    opts?.projection,
  );
  const lines = fields.map((raw) => {
    const f = normalizeField(raw);
    let node: Record<string, unknown>;
    try {
      node =
        f.jsonSchema !== undefined
          ? JSON.parse(f.jsonSchema)
          : simpleSchemaFieldToJSONSchema(f);
    } catch {
      node = { type: "string" };
    }
    return renderField(
      node,
      f.key,
      nums.get(f.key) ?? 1,
      f.required,
      nested,
      1,
      childCtx(baseCtx, `/properties/${f.key}`),
    );
  });
  const root = `message ${rootName} {\n${lines
    .map((l) => `  ${l}`)
    .join("\n")}\n}`;
  const usesWrappers =
    root.includes("google.protobuf.") ||
    nested.some((s) => s.includes("google.protobuf."));
  const header = usesWrappers
    ? `syntax = "proto3";\nimport "google/protobuf/wrappers.proto";`
    : `syntax = "proto3";`;
  // Nested messages first (deterministic), then the root.
  return [header, ...nested.reverse(), root].join("\n\n");
}

export const protoConverter: SchemaConverter = {
  id: "protobuf",
  label: "Protobuf",
  toFields: protoToFields,
  fromFields: fieldsToProto,
};
