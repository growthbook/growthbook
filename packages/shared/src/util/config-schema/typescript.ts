import { SchemaField } from "shared/types/feature";
import {
  blankField,
  JSON_SCHEMA_PRESETS,
  normalizeField,
  presetKeyFromField,
} from "./fields";
import {
  SchemaConversionResult,
  SchemaConverter,
  SchemaWarning,
} from "./types";

// TypeScript types (.d.ts-style) <-> SchemaField[]. A pragmatic, dependency-free
// converter for the common subset of TS type syntax found in `.d.ts` files:
// interfaces / type aliases / object literals with primitive fields,
// string-literal-union enums, `T | null`, arrays, and nested objects. Anything
// outside that subset degrades to `unknown` (the `any` preset) with a warning
// rather than failing — the editor's no-meaningful-change reconciliation keeps
// imperfect round-trips from churning saved schemas.
//
// This stays intentionally lightweight (no `typescript` compiler dependency) so
// it runs in the browser and Node alike. Per the design, fidelity is allowed to
// degrade to `any` for exotic/nested types; we never hand-resolve them.

// Read a quoted string literal starting at `i`; returns the literal (including
// quotes) and the index just past the closing quote.
function readTsString(s: string, i: number): [string, number] {
  const quote = s[i];
  let out = quote;
  i++;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      out += ch + (s[i + 1] ?? "");
      i += 2;
      continue;
    }
    out += ch;
    i++;
    if (ch === quote) break;
  }
  return [out, i];
}

const OPENERS = "{[(<";
const CLOSERS = "}])>";

// Extract the body between the first top-level `{` and its matching `}` (covers
// `interface X {...}`, `type X = {...}`, and a bare `{...}`).
function extractObjectBody(text: string): {
  body: string | null;
  error: string | null;
} {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      [, i] = readTsString(text, i);
      i--;
      continue;
    }
    if (c === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return { body: text.slice(start, i), error: null };
    }
  }
  if (start === -1) {
    return {
      body: null,
      error: "No type definition found (expected an interface or object type)",
    };
  }
  return { body: null, error: "Unbalanced braces in type definition" };
}

type TsDeclaration = {
  name: string;
  kind: "interface" | "type";
  // Object-like types (interfaces, `type X = { ... }`) can back a config; other
  // aliases (unions, primitives, refs) cannot.
  objectLike: boolean;
};

// Scan top-level declaration headers so the importer can be honest about what it
// dropped (it only ever consumes the FIRST object literal). Heuristic and lossy
// by design — good enough to warn, not a substitute for a real parser.
function analyzeDeclarations(text: string): TsDeclaration[] {
  const out: TsDeclaration[] = [];
  const re =
    /(?:^|[\s;{}()])(?:export\s+)?(?:declare\s+)?(interface|type)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const kind = m[1] as "interface" | "type";
    const name = m[2];
    if (kind === "interface") {
      out.push({ name, kind, objectLike: true });
      continue;
    }
    // `type Name ... = <rhs>` — object-like iff the RHS starts with `{`.
    const after = text.slice(re.lastIndex);
    const eq = after.indexOf("=");
    const rhs = eq === -1 ? "" : after.slice(eq + 1).replace(/^\s+/, "");
    out.push({ name, kind, objectLike: rhs.startsWith("{") });
  }
  return out;
}

// Strip the `/** */` frame and ` * ` line markers; drop `@tag` lines.
function cleanJsdoc(raw: string): string {
  return raw
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*?\s?/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("@"))
    .join(" ")
    .trim();
}

// A member looks like `key:` / `key?:` / `"key":` / `[index]:` (optionally
// `readonly`). Used to decide where one member ends and the next begins.
function isMemberStart(t: string): boolean {
  return /^(?:readonly\s+)?(?:"[^"]*"|'[^']*'|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*\??\s*:/.test(
    t.trim(),
  );
}

// Split an object body into members. Splits at top-level `;`, `,`, and newlines
// (string-/comment-/bracket-aware), then re-joins continuation chunks (e.g. a
// union spilling onto the next line) onto the member they belong to, and
// attaches any preceding JSDoc.
function tokenizeMembers(body: string): { jsdoc?: string; decl: string }[] {
  const members: { jsdoc?: string; decl: string }[] = [];
  let depth = 0;
  let buf = "";
  let pendingJsdoc: string | undefined;

  const flush = () => {
    const t = buf.trim();
    buf = "";
    if (!t) return;
    if (isMemberStart(t)) {
      members.push({ jsdoc: pendingJsdoc, decl: t });
      pendingJsdoc = undefined;
    } else if (members.length) {
      members[members.length - 1].decl += " " + t;
    }
  };

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      let str: string;
      [str, i] = readTsString(body, i);
      i--;
      buf += str;
      continue;
    }
    if (c === "/" && body[i + 1] === "/") {
      i += 2;
      while (i < body.length && body[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && body[i + 1] === "*") {
      const isDoc = body[i + 2] === "*";
      let j = i + 2;
      while (j < body.length && !(body[j] === "*" && body[j + 1] === "/")) j++;
      const raw = body.slice(i, Math.min(j + 2, body.length));
      i = j + 1;
      if (isDoc && depth === 0 && buf.trim() === "")
        pendingJsdoc = cleanJsdoc(raw);
      continue;
    }
    if (OPENERS.includes(c)) {
      depth++;
      buf += c;
      continue;
    }
    if (CLOSERS.includes(c)) {
      depth = Math.max(0, depth - 1);
      buf += c;
      continue;
    }
    if (depth === 0 && (c === ";" || c === "," || c === "\n")) {
      flush();
      continue;
    }
    buf += c;
  }
  flush();
  return members;
}

// Split `a | b | c` at top level (string-/bracket-aware).
function splitUnion(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '"' || c === "'" || c === "`") {
      let str: string;
      [str, i] = readTsString(expr, i);
      i--;
      buf += str;
      continue;
    }
    if (OPENERS.includes(c)) {
      depth++;
      buf += c;
      continue;
    }
    if (CLOSERS.includes(c)) {
      depth = Math.max(0, depth - 1);
      buf += c;
      continue;
    }
    if (c === "|" && depth === 0) {
      // Skip empty segments so leading/trailing/`|`-prefixed unions parse cleanly.
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function unquote(raw: string): string {
  const t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

const STRING_LITERAL_RE = /^"(?:[^"\\]|\\.)*"$|^'(?:[^'\\]|\\.)*'$/;

type ParsedTsType = {
  type: SchemaField["type"];
  nullable: boolean;
  enum: string[];
  jsonSchema?: string;
  warning?: string;
};

const ANY_SCHEMA = JSON.stringify(JSON_SCHEMA_PRESETS.any);
const OBJECT_SCHEMA = JSON.stringify(JSON_SCHEMA_PRESETS.json);
const ARRAY_SCHEMA = JSON.stringify(JSON_SCHEMA_PRESETS.array);

function parseSingleTsType(t: string, nullable: boolean): ParsedTsType {
  const arrayLike =
    /\[\]$/.test(t) ||
    /^(?:readonly\s+)?Array<[\s\S]*>$/.test(t) ||
    /^(?:readonly\s+)?ReadonlyArray<[\s\S]*>$/.test(t) ||
    (t.startsWith("[") && t.endsWith("]"));
  if (arrayLike) {
    return { type: "string", nullable, enum: [], jsonSchema: ARRAY_SCHEMA };
  }
  if (t.startsWith("{") || /^Record<[\s\S]*>$/.test(t) || t === "object") {
    return { type: "string", nullable, enum: [], jsonSchema: OBJECT_SCHEMA };
  }
  switch (t) {
    case "string":
      return { type: "string", nullable, enum: [] };
    case "number":
      return { type: "float", nullable, enum: [] };
    case "boolean":
    case "true":
    case "false":
      return { type: "boolean", nullable, enum: [] };
    case "any":
    case "unknown":
      return { type: "string", nullable, enum: [], jsonSchema: ANY_SCHEMA };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(t)) {
    return { type: "float", nullable, enum: [] };
  }
  if (STRING_LITERAL_RE.test(t)) {
    return { type: "string", nullable, enum: [unquote(t)] };
  }
  return {
    type: "string",
    nullable,
    enum: [],
    jsonSchema: ANY_SCHEMA,
    warning: `unresolved type "${t}" mapped to any`,
  };
}

function parseTsType(rawExpr: string): ParsedTsType {
  const expr = rawExpr
    .trim()
    .replace(/[;,]+$/, "")
    .trim();
  const parts = splitUnion(expr);
  let nullable = false;
  const nonNull = parts.filter((p) => {
    if (p === "null" || p === "undefined") {
      nullable = true;
      return false;
    }
    return true;
  });
  if (nonNull.length === 0) {
    return { type: "string", nullable, enum: [], jsonSchema: ANY_SCHEMA };
  }
  if (nonNull.every((p) => STRING_LITERAL_RE.test(p))) {
    return { type: "string", nullable, enum: nonNull.map(unquote) };
  }
  if (nonNull.length === 1) return parseSingleTsType(nonNull[0], nullable);
  return {
    type: "string",
    nullable,
    enum: [],
    jsonSchema: ANY_SCHEMA,
    warning: `union type "${expr}" mapped to any`,
  };
}

// Top-level declarations the importer can't fold into the single config object:
// extra object types it had to drop, and non-object aliases that can't be roots.
function declarationWarnings(text: string): SchemaWarning[] {
  const decls = analyzeDeclarations(text);
  if (decls.length <= 1) return [];
  const warnings: SchemaWarning[] = [];
  // The first object-like declaration is the one whose body we extract.
  const importedName = decls.find((d) => d.objectLike)?.name;
  for (const d of decls) {
    if (!d.objectLike) {
      warnings.push({
        code: "non-object-root",
        path: d.name,
        message: `Type "${d.name}" is not an object type and can't back a config; it was ignored.`,
      });
    } else if (d.name !== importedName) {
      warnings.push({
        code: "dropped-declaration",
        path: d.name,
        message: `Declaration "${d.name}" was ignored — a config maps to a single object type.`,
      });
    }
  }
  return warnings;
}

// Parse a TypeScript object type / interface into the config's own SchemaField[].
export function tsTypesToFields(text: string): SchemaConversionResult {
  const { body, error } = extractObjectBody(text);
  if (error) return { fields: [], error, warnings: [] };
  if (body === null) return { fields: [], error: null, warnings: [] };

  const warnings: SchemaWarning[] = declarationWarnings(text);
  const fields: SchemaField[] = [];
  for (const member of tokenizeMembers(body)) {
    const m = member.decl.match(
      /^(?:readonly\s+)?("[^"]*"|'[^']*'|\[[^\]]*\]|[A-Za-z_$][\w$]*)(\??)\s*:\s*([\s\S]+)$/,
    );
    if (!m) {
      warnings.push({
        code: "unsupported-member",
        message: `Skipped unrecognized member: ${member.decl}`,
      });
      continue;
    }
    if (m[1].startsWith("[")) {
      warnings.push({
        code: "unsupported-member",
        message: "Index signatures are not supported and were skipped",
      });
      continue;
    }
    const key = unquote(m[1]);
    const parsed = parseTsType(m[3]);
    if (parsed.warning) {
      warnings.push({
        code: "unresolved-type",
        path: key,
        message: `${key}: ${parsed.warning}`,
      });
    }
    const field = blankField();
    field.key = key;
    field.required = m[2] !== "?";
    field.type = parsed.type;
    field.enum = parsed.enum;
    if (parsed.nullable) field.nullable = true;
    if (parsed.jsonSchema !== undefined) field.jsonSchema = parsed.jsonSchema;
    if (member.jsdoc) field.description = member.jsdoc;
    fields.push(normalizeField(field));
  }
  return { fields, error: null, warnings };
}

function tsKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function fieldToTsExpr(f: SchemaField): string {
  const preset = presetKeyFromField(f);
  let base: string;
  if (preset === "json") base = "Record<string, unknown>";
  else if (preset === "array") base = "unknown[]";
  else if (preset === "any") base = "unknown";
  else if (f.jsonSchema !== undefined) base = "unknown";
  else if (f.enum.length > 0)
    base = f.enum.map((v) => JSON.stringify(v)).join(" | ");
  else if (f.type === "integer" || f.type === "float") base = "number";
  else if (f.type === "boolean") base = "boolean";
  else base = "string";
  if (f.nullable === true) base += " | null";
  return base;
}

// Serialize fields back to a TypeScript interface (so the editor can show the
// existing schema as TS when the language toggle flips). `additionalProperties`
// surfaces as an index signature.
export function fieldsToTsType(
  fields: SchemaField[],
  opts?: { name?: string; additionalProperties?: boolean },
): string {
  const name = opts?.name ?? "ConfigSchema";
  const lines: string[] = [];
  for (const raw of fields) {
    const f = normalizeField(raw);
    if (f.description) lines.push(`  /** ${f.description} */`);
    lines.push(
      `  ${tsKey(f.key)}${f.required ? "" : "?"}: ${fieldToTsExpr(f)};`,
    );
  }
  if (opts?.additionalProperties) lines.push("  [key: string]: unknown;");
  return `interface ${name} {\n${lines.join("\n")}\n}`;
}

// TypeScript `.d.ts`-style converter (interfaces / object types).
export const typescriptConverter: SchemaConverter = {
  id: "typescript",
  label: "TypeScript",
  toFields: tsTypesToFields,
  fromFields: fieldsToTsType,
};
