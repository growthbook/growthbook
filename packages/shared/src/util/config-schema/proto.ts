import { SchemaField } from "shared/types/feature";
import { simpleSchemaFieldToJSONSchema } from "../features";
import { normalizeField } from "./fields";
import { jsonSchemaStringToFields } from "./json-schema";
import {
  SchemaConversionResult,
  SchemaConverter,
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
// it carries the `optional` keyword. Scalar/enum/message round-trip; `bytes` maps
// to string with a warning; `map<K,V>` becomes an open object keyed by V.

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

function stripComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < text.length) {
        out += text[i];
        if (text[i] === "\\") {
          out += text[i + 1] ?? "";
          i++;
        } else if (text[i] === quote) break;
        i++;
      }
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

// Body between a `{` at `open` and its matching `}` (string-aware). Returns the
// inner text and the index just past the closing brace.
function matchBraces(
  text: string,
  open: number,
): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return { body: text.slice(open + 1), end: text.length };
}

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
};

function parseField(stmt: string): ParsedField | null {
  const m = stmt.match(
    /^(repeated|optional)?\s*(map\s*<[^>]+>|[A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*=\s*\d+(?:\s*\[[^\]]*\])?$/,
  );
  if (!m) return null;
  return {
    modifier: (m[1] as "repeated" | "optional" | undefined) ?? "",
    rawType: m[2].replace(/\s+/g, ""),
    name: m[3],
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

export function protoToFields(text: string): SchemaConversionResult {
  const clean = stripComments(text);
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
  return {
    fields: result.fields,
    error: result.error,
    warnings: [...warnings, ...result.warnings],
  };
}

// =========================================================================
// Export: SchemaField[] -> proto3. Inverse of the import; lossy where proto is
// more rigid than JSON Schema (enums become a documented string; nested objects
// become generated nested messages).
// =========================================================================

function pascalCase(key: string): string {
  return (
    key
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("") || "Nested"
  );
}

const SCALAR_OUT: Record<string, string> = {
  string: "string",
  boolean: "bool",
};

// Render the proto type for a node, generating nested messages into `nested`.
// Returns the type token plus an optional trailing line comment (e.g. enum
// allowed values). Arrays/optionality are handled by the caller.
function protoTypeFor(
  node: Record<string, unknown>,
  key: string,
  nested: string[],
  depth: number,
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
      return { token: "string", comment: "free-form object (JSON string)" };
    }
    const name = pascalCase(key);
    nested.push(
      renderMessage(
        name,
        props as Record<string, unknown>,
        node,
        nested,
        depth,
      ),
    );
    return { token: name };
  }
  // Integers ride JSON Schema as `{type:"number", multipleOf:1}` (or `integer`);
  // everything else `number` is a double.
  if (t === "integer") return { token: "int32" };
  if (t === "number") {
    const isInt = node.multipleOf === 1 || node.format === "number";
    return { token: isInt ? "int32" : "double" };
  }
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
    ({ token, comment } = protoTypeFor(items, key, nested, depth));
    modifier = "repeated ";
  } else {
    ({ token, comment } = protoTypeFor(node, key, nested, depth));
    // proto3: presence (optional) approximates nullable / not-required.
    if (isNullable || !required) modifier = "optional ";
  }
  const line = `${modifier}${token} ${key} = ${num};`;
  return comment ? `${line} // ${comment}` : line;
}

function renderMessage(
  name: string,
  props: Record<string, unknown>,
  parent: Record<string, unknown>,
  nested: string[],
  depth: number,
): string {
  const required = new Set(
    Array.isArray(parent.required)
      ? parent.required.filter((x): x is string => typeof x === "string")
      : [],
  );
  const lines = Object.entries(props).map(([k, v], i) =>
    renderField(
      (v && typeof v === "object" ? v : {}) as Record<string, unknown>,
      k,
      i + 1,
      required.has(k),
      nested,
      depth + 1,
    ),
  );
  return `message ${name} {\n${lines.map((l) => `  ${l}`).join("\n")}\n}`;
}

export function fieldsToProto(
  fields: SchemaField[],
  opts?: { name?: string; additionalProperties?: boolean },
): string {
  const rootName = opts?.name ?? "ConfigSchema";
  const nested: string[] = [];
  const lines = fields.map((raw, i) => {
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
    return renderField(node, f.key, i + 1, f.required, nested, 1);
  });
  const root = `message ${rootName} {\n${lines
    .map((l) => `  ${l}`)
    .join("\n")}\n}`;
  // Nested messages first (deterministic), then the root.
  return [`syntax = "proto3";`, ...nested.reverse(), root].join("\n\n");
}

export const protoConverter: SchemaConverter = {
  id: "protobuf",
  label: "Protobuf",
  toFields: protoToFields,
  fromFields: fieldsToProto,
};
