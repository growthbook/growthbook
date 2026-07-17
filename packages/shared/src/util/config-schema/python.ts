import { SchemaField } from "shared/types/feature";
import { simpleSchemaFieldToJSONSchema } from "../features";
import { normalizeField } from "./fields";
import {
  isIntegerSchemaNode,
  jsonPointerEscape,
  pascalCaseTypeName,
} from "./naming";
import { jsonSchemaStringToFields } from "./json-schema";
import {
  SchemaConversionResult,
  SchemaConverter,
  SchemaProjection,
  SchemaWarning,
} from "./types";

// Python (Pydantic v2 / TypedDict) <-> SchemaField[] over the JSON Schema pivot.
// Best-effort: handles scalars, `List[T]`, `Optional[T]`, `Dict[...]`, `Literal[...]`
// enums, and nested classes; anything else degrades to a permissive type with a warning.
//
// Parsing is indentation-based (not brace-matching). A field is optional if it's
// `Optional[...]` or carries a default (`= ...`).

const MAX_NEST_DEPTH = 6;

const PY_SCALARS: Record<string, Record<string, unknown>> = {
  int: { type: "integer" },
  float: { type: "number" },
  str: { type: "string" },
  bool: { type: "boolean" },
};

type PyClass = { name: string; body: string[] };

function leadingSpaces(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].replace(/\t/g, "    ").length : 0;
}

// Strip `#` line comments (not inside strings) and triple-quoted docstrings.
function stripPythonComments(text: string): string {
  const withoutDocstrings = stripDocstrings(text);
  return withoutDocstrings.split("\n").map(stripLineComment).join("\n");
}

function stripDocstrings(text: string): string {
  let out = "";
  let i = 0;
  let inString: '"' | "'" | null = null;
  let triple: '"""' | "'''" | null = null;
  while (i < text.length) {
    if (triple) {
      if (text.startsWith(triple, i)) {
        i += 3;
        triple = null;
      } else {
        // Preserve newlines so line/indent structure is unaffected.
        if (text[i] === "\n") out += "\n";
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i] === inString) inString = null;
      out += text[i];
      i += 1;
      continue;
    }
    if (text.startsWith('"""', i)) {
      triple = '"""';
      i += 3;
      continue;
    }
    if (text.startsWith("'''", i)) {
      triple = "'''";
      i += 3;
      continue;
    }
    if (text[i] === '"' || text[i] === "'") {
      inString = text[i] as '"' | "'";
      out += text[i];
      i += 1;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

function stripLineComment(line: string): string {
  let inString: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c as '"' | "'";
      continue;
    }
    if (c === "#") return line.slice(0, i).replace(/\s+$/, "");
  }
  return line;
}

// Every class block, flattened by name (nested classes become their own block).
function collectClasses(text: string): PyClass[] {
  const lines = text.split("\n");
  const out: PyClass[] = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^(\s*)class\s+(\w+)\s*(?:\([^)]*\))?\s*:/);
    if (!header) continue;
    const headerIndent = leadingSpaces(lines[i]);
    const name = header[2];
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === "") {
        body.push(line);
        continue;
      }
      if (leadingSpaces(line) <= headerIndent) break;
      body.push(line);
    }
    out.push({ name, body });
  }
  return out;
}

type ParsedPyField = {
  annotation: string;
  key: string;
  optional: boolean;
};

function parsePyField(line: string): ParsedPyField | null {
  const trimmed = line.trim();
  if (
    trimmed === "" ||
    trimmed.startsWith("@") ||
    trimmed.startsWith("def ") ||
    trimmed.startsWith("class ")
  ) {
    return null;
  }
  const m = trimmed.match(/^(\w+)\s*:\s*(.+?)\s*(?:=\s*(.+))?$/);
  if (!m) return null;
  const key = m[1];
  const annotation = m[2].trim();
  const hasDefault = m[3] !== undefined;
  const isOptional = /^Optional\s*\[/.test(annotation);
  return { annotation, key, optional: isOptional || hasDefault };
}

// Only field lines at the body's shallowest indent; deeper lines belong to a
// nested class/def collected as its own block.
function pyFieldLines(body: string[]): string[] {
  const nonBlank = body.filter((l) => l.trim() !== "");
  if (!nonBlank.length) return [];
  const baseIndent = Math.min(...nonBlank.map(leadingSpaces));
  const out: string[] = [];
  for (const line of body) {
    if (line.trim() === "") continue;
    if (leadingSpaces(line) !== baseIndent) continue;
    if (/^\s*class\s/.test(line) || /^\s*def\s/.test(line)) continue;
    out.push(line);
  }
  return out;
}

function unwrapOptional(annotation: string): string {
  const m = annotation.match(/^Optional\s*\[(.+)\]$/);
  return m ? m[1].trim() : annotation;
}

// String or numeric Literal members. Mixed/empty/other members (True, None, …)
// return null so the field falls through to the unresolved-type warning instead
// of silently importing as `{type:"string", enum:[]}`.
function literalValues(annotation: string): {
  type: "string" | "integer" | "number";
  values: (string | number)[];
} | null {
  const m = annotation.match(/^Literal\s*\[(.+)\]$/);
  if (!m) return null;
  const strings: string[] = [];
  const numbers: number[] = [];
  const re = /"([^"]*)"|'([^']*)'|-?\d+(?:\.\d+)?/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(m[1]))) {
    if (mm[1] !== undefined || mm[2] !== undefined) {
      strings.push(mm[1] ?? mm[2] ?? "");
    } else {
      numbers.push(Number(mm[0]));
    }
  }
  if (strings.length > 0 && numbers.length === 0) {
    return { type: "string", values: strings };
  }
  if (numbers.length > 0 && strings.length === 0) {
    return {
      type: numbers.every((n) => Number.isInteger(n)) ? "integer" : "number",
      values: numbers,
    };
  }
  return null;
}

function annotationToNode(
  rawAnnotation: string,
  nullable: boolean,
  byName: Map<string, PyClass>,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  const annotation = unwrapOptional(rawAnnotation);

  const literals = literalValues(annotation);
  if (literals) {
    const node: Record<string, unknown> = {
      type: literals.type,
      enum: literals.values,
    };
    // A nullable enum must list null explicitly — `enum` constrains all
    // instances including null, so widening the type alone isn't enough.
    return nullable
      ? {
          ...node,
          type: [literals.type, "null"],
          enum: [...literals.values, null],
        }
      : node;
  }

  const listMatch = annotation.match(/^(?:List|list)\s*\[(.+)\]$/);
  if (listMatch) {
    const items = annotationToNode(
      listMatch[1].trim(),
      false,
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
        message: `${path}: list item type "${listMatch[1].trim()}" couldn't be resolved; items left untyped.`,
      });
      return { type: "array" };
    }
    return { type: "array", items };
  }

  if (/^(?:Dict|dict)\s*\[/.test(annotation) || annotation === "dict") {
    return { type: "object" };
  }

  let node: Record<string, unknown> | null = null;
  if (annotation in PY_SCALARS) {
    node = { ...PY_SCALARS[annotation] };
  } else {
    const decl = byName.get(annotation);
    if (decl && !seen.has(annotation) && depth <= MAX_NEST_DEPTH) {
      node = classBodyToNode(
        decl.body,
        byName,
        new Set([...seen, annotation]),
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

function classBodyToNode(
  body: string[],
  byName: Map<string, PyClass>,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  if (depth > MAX_NEST_DEPTH) return null;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const line of pyFieldLines(body)) {
    const field = parsePyField(line);
    if (!field) continue;
    const childPath = path ? `${path}.${field.key}` : field.key;
    const nullable = /^Optional\s*\[/.test(field.annotation);
    const node = annotationToNode(
      field.annotation,
      nullable,
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
        message: `${childPath}: unresolved type "${field.annotation}"`,
      });
      properties[field.key] = { type: "string" };
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

function referencedClass(annotation: string): string | null {
  let t = unwrapOptional(annotation);
  const listMatch = t.match(/^(?:List|list)\s*\[(.+)\]$/);
  if (listMatch) t = unwrapOptional(listMatch[1].trim());
  if (/^(?:Dict|dict)\s*\[/.test(t) || /^Literal\s*\[/.test(t)) return null;
  return /^\w+$/.test(t) ? t : null;
}

function referencesIn(decl: PyClass, byName: Map<string, PyClass>): string[] {
  const refs: string[] = [];
  for (const line of pyFieldLines(decl.body)) {
    const f = parsePyField(line);
    if (!f) continue;
    const token = referencedClass(f.annotation);
    if (token && byName.has(token) && token !== decl.name) refs.push(token);
  }
  return refs;
}

function selectRoot(
  classes: PyClass[],
  byName: Map<string, PyClass>,
): PyClass | null {
  const referenced = new Set<string>();
  for (const d of classes)
    for (const r of referencesIn(d, byName)) referenced.add(r);
  return classes.find((d) => !referenced.has(d.name)) ?? classes[0] ?? null;
}

// JSON-Pointer path -> the Python class name declared there, for round-trip render.
function captureClassNames(
  body: string[],
  byName: Map<string, PyClass>,
  pointer: string,
  seen: Set<string>,
  depth: number,
  out: Record<string, string>,
): void {
  if (depth > MAX_NEST_DEPTH) return;
  for (const line of pyFieldLines(body)) {
    const field = parsePyField(line);
    if (!field) continue;
    const unwrapped = unwrapOptional(field.annotation);
    const listMatch = unwrapped.match(/^(?:List|list)\s*\[(.+)\]$/);
    const isArray = !!listMatch;
    const token = referencedClass(field.annotation);
    if (!token) continue;
    const decl = byName.get(token);
    if (!decl || seen.has(token)) continue;
    const seg = `/properties/${jsonPointerEscape(field.key)}`;
    const at = isArray ? `${pointer}${seg}/items` : `${pointer}${seg}`;
    out[at] = token;
    captureClassNames(
      decl.body,
      byName,
      at,
      new Set([...seen, token]),
      depth + 1,
      out,
    );
  }
}

export function pythonToFields(text: string): SchemaConversionResult {
  const clean = stripPythonComments(text);
  const classes = collectClasses(clean);
  const byName = new Map(classes.map((d) => [d.name, d]));
  const root = selectRoot(classes, byName);
  if (!root) {
    return { fields: [], error: "No Python class found", warnings: [] };
  }

  const warnings: SchemaWarning[] = [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const line of pyFieldLines(root.body)) {
    const field = parsePyField(line);
    if (!field) continue;
    const nullable = /^Optional\s*\[/.test(field.annotation);
    const node = annotationToNode(
      field.annotation,
      nullable,
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
        message: `${field.key}: unresolved type "${field.annotation}"`,
      });
      properties[field.key] = { type: "string" };
    } else {
      properties[field.key] = node;
    }
    if (!field.optional) required.push(field.key);
  }

  const doc: Record<string, unknown> = { type: "object", properties };
  if (required.length) doc.required = required;
  const result = jsonSchemaStringToFields(JSON.stringify(doc));

  const typeNames: Record<string, string> = {};
  captureClassNames(root.body, byName, "", new Set([root.name]), 1, typeNames);

  return {
    fields: result.fields,
    error: result.error,
    warnings: [...warnings, ...result.warnings],
    projection: { language: "python", rootName: root.name, typeNames },
  };
}

// Export: SchemaField[] -> Python (Pydantic v2). Lossy where Python is more rigid
// than JSON Schema. Nested classes are emitted BEFORE their users (definition
// order). Enums become `Literal[...]`.

type PyRenderCtx = {
  pointer: string;
  projection?: SchemaProjection;
  emitted: Set<string>;
  imports: Set<string>; // typing names used: List, Literal, Optional
};

function childCtx(ctx: PyRenderCtx, seg: string): PyRenderCtx {
  return {
    pointer: ctx.pointer + seg,
    projection: ctx.projection,
    emitted: ctx.emitted,
    imports: ctx.imports,
  };
}

function pyTypeFor(
  node: Record<string, unknown>,
  key: string,
  nested: string[],
  depth: number,
  ctx: PyRenderCtx,
): { token: string; comment?: string } {
  if (depth > MAX_NEST_DEPTH) return { token: "str", comment: "unknown" };
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
    ctx.imports.add("Literal");
    return { token: `Literal[${allowed}]` };
  }
  if (t === "object") {
    const props = node.properties;
    if (!props || typeof props !== "object" || !Object.keys(props).length) {
      return { token: "dict", comment: "free-form object" };
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
      renderClass(
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
  if (t === "number") return { token: "float" };
  if (t === "string") return { token: "str" };
  if (t === "boolean") return { token: "bool" };
  return { token: "str", comment: "unknown" };
}

function renderField(
  node: Record<string, unknown>,
  key: string,
  required: boolean,
  nested: string[],
  depth: number,
  ctx: PyRenderCtx,
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
    ({ token, comment } = pyTypeFor(
      items,
      key,
      nested,
      depth,
      childCtx(ctx, "/items"),
    ));
    ctx.imports.add("List");
    token = `List[${token}]`;
  } else {
    ({ token, comment } = pyTypeFor(node, key, nested, depth, ctx));
  }
  let suffix = "";
  if (isNullable || !required) {
    ctx.imports.add("Optional");
    token = `Optional[${token}]`;
    suffix = " = None";
  }
  const line = `    ${key}: ${token}${suffix}`;
  return comment ? `${line}  # ${comment}` : line;
}

function renderClass(
  name: string,
  props: Record<string, unknown>,
  parent: Record<string, unknown>,
  nested: string[],
  depth: number,
  ctx: PyRenderCtx,
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
  const body = lines.length ? lines.join("\n") : "    pass";
  return `class ${name}(BaseModel):\n${body}`;
}

export function fieldsToPython(
  fields: SchemaField[],
  opts?: {
    name?: string;
    additionalProperties?: boolean;
    projection?: SchemaProjection;
  },
): string {
  const rootName = opts?.projection?.rootName ?? opts?.name ?? "ConfigSchema";
  const nested: string[] = [];
  const baseCtx: PyRenderCtx = {
    pointer: "",
    projection: opts?.projection,
    emitted: new Set<string>([rootName]),
    imports: new Set<string>(),
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
  const root = renderClass(
    rootName,
    props,
    { required: [...requiredSet] },
    nested,
    0,
    baseCtx,
  );

  const typingNames = ["List", "Literal", "Optional"].filter((n) =>
    baseCtx.imports.has(n),
  );
  const header = ["from pydantic import BaseModel"];
  if (typingNames.length) {
    header.push(`from typing import ${typingNames.join(", ")}`);
  }

  // `nested` is already deepest-first — the definition order Python needs. Do NOT reverse.
  return [header.join("\n"), ...nested, root].join("\n\n");
}

export const pythonConverter: SchemaConverter = {
  id: "python",
  label: "Python",
  toFields: pythonToFields,
  fromFields: fieldsToPython,
};
