import { SchemaField } from "shared/types/feature";
import { simpleSchemaFieldToJSONSchema } from "../features";
import { normalizeField } from "./fields";
import { jsonPointerEscape } from "./naming";
import { jsonSchemaStringToFields } from "./json-schema";
import {
  SchemaConversionResult,
  SchemaConverter,
  SchemaProjection,
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
  // Object body (object-like decls) or alias RHS (non-object decls), so the
  // importer can resolve references to sibling types and pick the DAG root.
  body?: string;
  rhs?: string;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Parse every top-level declaration with its body/RHS. Each declaration spans
// from just after its name to the start of the next declaration header, which
// bounds body/RHS extraction to one declaration at a time. Heuristic and lossy
// by design (no `typescript` compiler) — good enough to pick a root and resolve
// sibling references, not a substitute for a real parser.
function parseDeclarations(text: string): TsDeclaration[] {
  const re =
    /(?:^|[\s;{}()])(?:export\s+)?(?:declare\s+)?(interface|type)\s+([A-Za-z_$][\w$]*)/g;
  const heads: {
    kind: "interface" | "type";
    name: string;
    headerStart: number;
    contentStart: number;
  }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    heads.push({
      kind: m[1] as "interface" | "type",
      name: m[2],
      headerStart: m.index,
      contentStart: re.lastIndex,
    });
  }
  const out: TsDeclaration[] = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const end = i + 1 < heads.length ? heads[i + 1].headerStart : text.length;
    const chunk = text.slice(h.contentStart, end);
    if (h.kind === "interface") {
      const { body } = extractObjectBody(chunk);
      out.push({
        name: h.name,
        kind: "interface",
        objectLike: true,
        body: body ?? "",
      });
      continue;
    }
    const eq = chunk.indexOf("=");
    const rhs = eq === -1 ? "" : chunk.slice(eq + 1).trim();
    if (rhs.startsWith("{")) {
      const { body } = extractObjectBody(rhs);
      out.push({
        name: h.name,
        kind: "type",
        objectLike: true,
        body: body ?? "",
      });
    } else {
      out.push({
        name: h.name,
        kind: "type",
        objectLike: false,
        rhs: rhs.replace(/;\s*$/, "").trim(),
      });
    }
  }
  return out;
}

// Names of declarations directly referenced in a declaration's body/RHS.
function referencesIn(
  d: TsDeclaration,
  byName: Map<string, TsDeclaration>,
): string[] {
  const content = (d.objectLike ? d.body : d.rhs) ?? "";
  const refs: string[] = [];
  for (const name of byName.keys()) {
    if (name === d.name) continue;
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`).test(content))
      refs.push(name);
  }
  return refs;
}

// The config root is the object-like declaration that no OTHER declaration
// references — the top of the type DAG (e.g. `AppConfig`, which references
// `RetryPolicy`/`LogLevel` but is referenced by nothing). Falls back to the
// first object type when every candidate is referenced (e.g. a reference cycle,
// or a union root whose variants are all referenced).
function selectRoot(
  decls: TsDeclaration[],
  byName: Map<string, TsDeclaration>,
): TsDeclaration | null {
  const referenced = new Set<string>();
  for (const d of decls) {
    for (const r of referencesIn(d, byName)) referenced.add(r);
  }
  const objects = decls.filter((d) => d.objectLike);
  return objects.find((d) => !referenced.has(d.name)) ?? objects[0] ?? null;
}

// Declarations reachable from the root by following type references (the types
// stitched into the config). Anything not reachable was genuinely dropped.
function reachableFrom(
  rootName: string,
  byName: Map<string, TsDeclaration>,
): Set<string> {
  const reached = new Set<string>();
  const stack = [rootName];
  while (stack.length) {
    const d = byName.get(stack.pop() as string);
    if (!d) continue;
    for (const r of referencesIn(d, byName)) {
      if (!reached.has(r)) {
        reached.add(r);
        stack.push(r);
      }
    }
  }
  return reached;
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

// Cap how deep we'll recurse building a nested schema; beyond this we bail to the
// bare object/array preset rather than risk a pathological/expensive parse. Only
// CONTAINER nesting (objects/arrays) counts against this — leaf types (scalars,
// enums, literals) resolve at any depth, so a deeply-nested string-enum isn't
// clipped just for sitting one level too far down.
const MAX_NEST_DEPTH = 6;

// Strip one balanced layer of wrapping parens: "(a | b)" -> "a | b".
function stripParens(t: string): string {
  const s = t.trim();
  if (!s.startsWith("(") || !s.endsWith(")")) return s;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0 && i !== s.length - 1) return s; // not a full wrap
    }
  }
  return s.slice(1, -1).trim();
}

// Recursively build a JSON Schema node for a TS type, so nested objects/arrays
// survive import as real nested schemas (not the bare `{type:object}` preset).
// Returns null to BAIL — the caller falls back to the bare preset — on container
// depth overflow, an open-ended shape (Record/object/any), a mixed union, an
// unparseable member, an unresolved reference, or a reference cycle. Bailing is
// deliberate: an imperfect nested type degrades to opaque rather than wrong. When
// an array survives but its item type can't be resolved, the array is kept and an
// `unresolved-type` warning is pushed (rather than silently dropping `items`).
function tsTypeToSchemaNode(
  expr: string,
  decls: Map<string, TsDeclaration> | undefined,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  const e = stripParens(
    expr
      .trim()
      .replace(/[;,]+$/, "")
      .trim(),
  );
  const parts = splitUnion(e);
  let nullable = false;
  const nonNull = parts.filter((p) => {
    if (p === "null" || p === "undefined") {
      nullable = true;
      return false;
    }
    return true;
  });
  if (nonNull.length === 0) return null;
  const withNull = (node: Record<string, unknown>): Record<string, unknown> =>
    nullable && typeof node.type === "string"
      ? {
          ...node,
          type: [node.type, "null"],
          // `enum` constrains ALL instances including null, so a nullable enum
          // must list null explicitly or it rejects the very null the widened
          // type permits.
          ...(Array.isArray(node.enum) ? { enum: [...node.enum, null] } : {}),
        }
      : node;

  // Leaves (string-literal unions, scalars, literals) resolve at ANY depth — the
  // depth cap below bounds CONTAINER nesting only, not leaf types.
  if (nonNull.every((p) => STRING_LITERAL_RE.test(p))) {
    return withNull({ type: "string", enum: nonNull.map(unquote) });
  }
  if (nonNull.length !== 1) return null;
  const t = stripParens(nonNull[0]);

  switch (t) {
    case "string":
      return withNull({ type: "string" });
    case "number":
      return withNull({ type: "number" });
    case "boolean":
    case "true":
    case "false":
      return withNull({ type: "boolean" });
  }
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return withNull({ type: "number" });
  if (STRING_LITERAL_RE.test(t)) {
    return withNull({ type: "string", enum: [unquote(t)] });
  }

  // Below here the type is a container or a reference — the depth cap applies.
  if (depth > MAX_NEST_DEPTH) return null;

  const arrSuffix = /^(.+)\[\]$/.exec(t);
  const arrGeneric =
    /^(?:readonly\s+)?(?:Array|ReadonlyArray)<([\s\S]+)>$/.exec(t);
  if (arrSuffix || arrGeneric) {
    const inner = (
      arrSuffix ? arrSuffix[1] : (arrGeneric as RegExpExecArray)[1]
    ).trim();
    const items = tsTypeToSchemaNode(
      inner,
      decls,
      seen,
      depth + 1,
      path,
      warnings,
    );
    if (!items) {
      warnings.push({
        code: "unresolved-type",
        path,
        message: `${
          path || "(root)"
        }: array item type "${inner}" couldn't be resolved; items left untyped.`,
      });
      return withNull({ type: "array" });
    }
    return withNull({ type: "array", items });
  }
  if (t.startsWith("[")) return null; // tuple — bail
  if (
    /^Record<[\s\S]*>$/.test(t) ||
    t === "object" ||
    t === "any" ||
    t === "unknown"
  ) {
    return null; // open-ended — bail
  }
  if (t.startsWith("{")) {
    const { body } = extractObjectBody(t);
    if (body === null) return null;
    const node = objectBodyToSchemaNode(
      body,
      decls,
      seen,
      depth + 1,
      path,
      warnings,
    );
    return node ? withNull(node) : null;
  }
  const decl = decls?.get(t);
  if (decl) {
    if (seen.has(t)) return null; // cycle — bail
    const nextSeen = new Set(seen);
    nextSeen.add(t);
    if (decl.objectLike) {
      const node = objectBodyToSchemaNode(
        decl.body ?? "",
        decls,
        nextSeen,
        depth + 1,
        path,
        warnings,
      );
      return node ? withNull(node) : null;
    }
    const aliasNode = tsTypeToSchemaNode(
      decl.rhs ?? "",
      decls,
      nextSeen,
      depth,
      path,
      warnings,
    );
    return aliasNode ? withNull(aliasNode) : null;
  }
  return null; // unresolved — bail
}

// Build an object JSON Schema node from a member body. Bails (null) if any member
// is structurally unparseable or itself bails — so a partly-exotic object stays
// opaque rather than emitting a half-right schema.
function objectBodyToSchemaNode(
  body: string,
  decls: Map<string, TsDeclaration> | undefined,
  seen: Set<string>,
  depth: number,
  path: string,
  warnings: SchemaWarning[],
): Record<string, unknown> | null {
  if (depth > MAX_NEST_DEPTH) return null;
  const members = tokenizeMembers(body);
  if (members.length === 0) return null;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const member of members) {
    const m = member.decl.match(
      /^(?:readonly\s+)?("[^"]*"|'[^']*'|\[[^\]]*\]|[A-Za-z_$][\w$]*)(\??)\s*:\s*([\s\S]+)$/,
    );
    if (!m || m[1].startsWith("[")) return null;
    const key = unquote(m[1]);
    const node = tsTypeToSchemaNode(
      m[3],
      decls,
      seen,
      depth,
      path ? `${path}.${key}` : key,
      warnings,
    );
    if (!node) return null;
    properties[key] = node;
    if (m[2] !== "?") required.push(key);
  }
  const schema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length) schema.required = required;
  return schema;
}

// Declarations that are neither the root nor reachable from it (genuinely
// dropped, not stitched in). Reachable types are resolved into the root, so they
// don't warn. Unreachable object types are "dropped"; unreachable non-object
// aliases "can't back a config" — distinct codes, both informative.
function leftoverWarnings(
  decls: TsDeclaration[],
  rootName: string,
  reached: Set<string>,
): SchemaWarning[] {
  const out: SchemaWarning[] = [];
  for (const d of decls) {
    if (d.name === rootName || reached.has(d.name)) continue;
    if (d.objectLike) {
      out.push({
        code: "dropped-declaration",
        path: d.name,
        message: `Declaration "${d.name}" was ignored — it isn't the config root and nothing references it.`,
      });
    } else {
      out.push({
        code: "non-object-root",
        path: d.name,
        message: `Type "${d.name}" is not an object type and can't back a config; it was ignored.`,
      });
    }
  }
  return out;
}

// Bare JSON Schema preset a member degrades to when its TS type can't be
// resolved into a real node — mirrors the old per-field fallback: array-like →
// array, object-like → object, otherwise `{}` (any).
function fallbackNode(
  t: string,
  decls: Map<string, TsDeclaration> | undefined,
): Record<string, unknown> {
  const arrayLike =
    /\[\]$/.test(t) ||
    /^(?:readonly\s+)?Array<[\s\S]*>$/.test(t) ||
    /^(?:readonly\s+)?ReadonlyArray<[\s\S]*>$/.test(t) ||
    (t.startsWith("[") && t.endsWith("]"));
  if (arrayLike) return { type: "array" };
  const objectLike =
    t.startsWith("{") ||
    /^Record<[\s\S]*>$/.test(t) ||
    t === "object" ||
    decls?.get(t)?.objectLike === true;
  if (objectLike) return { type: "object" };
  return {};
}

// Build a JSON Schema document from an object body's members, resolving sibling
// references via `decls`. Each member's TS type converts to a JSON Schema node;
// on bail it degrades to a bare preset and emits an `unresolved-type` warning.
function objectBodyToDocument(
  body: string,
  decls: Map<string, TsDeclaration> | undefined,
): { doc: Record<string, unknown>; warnings: SchemaWarning[] } {
  const warnings: SchemaWarning[] = [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
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
      // A permissive index signature (`[key: string]: unknown` / `any`) is
      // semantically the config's extensibility ("Allow extra fields"), so
      // skipping it loses nothing. Only a TYPED index signature — whose
      // value-type constraint genuinely can't be represented — warns.
      const valueType = m[3]
        .trim()
        .replace(/[;,]+$/, "")
        .trim();
      if (valueType !== "unknown" && valueType !== "any") {
        warnings.push({
          code: "unsupported-member",
          message: `Index signatures are not supported; the "${valueType}" value constraint on extra keys was dropped.`,
        });
      }
      continue;
    }
    const key = unquote(m[1]);
    const t = m[3]
      .trim()
      .replace(/[;,]+$/, "")
      .trim();
    let node = tsTypeToSchemaNode(t, decls, new Set(), 1, key, warnings);
    if (!node) {
      node = fallbackNode(t, decls);
      warnings.push({
        code: "unresolved-type",
        path: key,
        message: `${key}: unresolved type "${t}"`,
      });
    }
    if (member.jsdoc) node = { ...node, description: member.jsdoc };
    properties[key] = node;
    if (m[2] !== "?") required.push(key);
  }
  const doc: Record<string, unknown> = { type: "object", properties };
  if (required.length) doc.required = required;
  return { doc, warnings };
}

// Walk an object body recording, for each member whose type is a NAMED object
// type, the JSON-Pointer path → that type's name (then recurse into it). Inline
// object literals are descended without a name; aliases/scalars/arrays are left
// inline (they aren't reproduced as named types on export). Mirrors the member
// walk + named-decl detection in `objectBodyToDocument`/`tsTypeToSchemaNode`, so
// the pointers line up with the emitted JSON Schema. Bounded by MAX_NEST_DEPTH
// and a `seen` cycle guard.
function captureMemberNames(
  body: string,
  decls: Map<string, TsDeclaration>,
  pointer: string,
  seen: Set<string>,
  depth: number,
  out: Record<string, string>,
): void {
  if (depth > MAX_NEST_DEPTH) return;
  for (const member of tokenizeMembers(body)) {
    const m = member.decl.match(
      /^(?:readonly\s+)?("[^"]*"|'[^']*'|\[[^\]]*\]|[A-Za-z_$][\w$]*)(\??)\s*:\s*([\s\S]+)$/,
    );
    if (!m || m[1].startsWith("[")) continue;
    const key = unquote(m[1]);
    const childPointer = `${pointer}/properties/${jsonPointerEscape(key)}`;
    const t = stripParens(
      m[3]
        .trim()
        .replace(/[;,]+$/, "")
        .trim(),
    );
    if (t.startsWith("{")) {
      const { body: inner } = extractObjectBody(t);
      if (inner !== null) {
        captureMemberNames(inner, decls, childPointer, seen, depth + 1, out);
      }
      continue;
    }
    const decl = decls.get(t);
    if (decl?.objectLike && !seen.has(t)) {
      out[childPointer] = t;
      captureMemberNames(
        decl.body ?? "",
        decls,
        childPointer,
        new Set([...seen, t]),
        depth + 1,
        out,
      );
    }
  }
}

// Parse a TypeScript object type / interface into the config's own SchemaField[]
// by pivoting through a JSON Schema document and delegating field-mapping.
export function tsTypesToFields(text: string): SchemaConversionResult {
  const decls = parseDeclarations(text);
  const byName = new Map(decls.map((d) => [d.name, d]));
  const root = selectRoot(decls, byName);

  let body: string;
  let resolvers: Map<string, TsDeclaration> | undefined;
  let tsWarnings: SchemaWarning[];

  // No declared object type — fall back to a bare object literal (`{ ... }`).
  if (!root) {
    const extracted = extractObjectBody(text);
    if (extracted.error)
      return { fields: [], error: extracted.error, warnings: [] };
    if (extracted.body === null)
      return { fields: [], error: null, warnings: [] };
    body = extracted.body;
    resolvers = undefined;
    tsWarnings = [];
  } else {
    body = root.body ?? "";
    resolvers = byName;
    const reached = reachableFrom(root.name, byName);
    tsWarnings = leftoverWarnings(decls, root.name, reached);
  }

  const { doc, warnings: memberWarnings } = objectBodyToDocument(
    body,
    resolvers,
  );
  const result = jsonSchemaStringToFields(JSON.stringify(doc));

  // Capture the source's named-type structure (for round-trip rendering). Only
  // meaningful when there's a named root resolving sibling types.
  let projection: SchemaProjection | undefined;
  if (root) {
    const typeNames: Record<string, string> = {};
    captureMemberNames(body, byName, "", new Set([root.name]), 1, typeNames);
    projection = { language: "typescript", rootName: root.name, typeNames };
  }

  return {
    fields: result.fields,
    error: result.error,
    warnings: [...tsWarnings, ...memberWarnings, ...result.warnings],
    ...(projection ? { projection } : {}),
  };
}

function tsKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

// Render context for projection-aware export: the JSON-Pointer of the node being
// rendered, the consumer's projection, and an accumulator of named interface
// bodies (name → member lines). Absent ⇒ plain structural (inline) rendering.
type TsRenderCtx = {
  pointer: string;
  projection: SchemaProjection;
  named: Map<string, string>;
};

function childRenderCtx(
  ctx: TsRenderCtx | undefined,
  key: string,
): TsRenderCtx | undefined {
  return ctx
    ? { ...ctx, pointer: `${ctx.pointer}/properties/${jsonPointerEscape(key)}` }
    : undefined;
}

// Inverse of `tsTypeToSchemaNode`: render a JSON Schema node back to a TS type
// expression. Structural by default — a nested object inlines as `{ ... }`. With
// a render context, an object whose JSON-Pointer carries a captured name is
// emitted as a NAMED reference and its interface registered in `ctx.named` (once;
// reserved up front to guard cycles), so a consumer's named types round-trip.
// Mirrors the importer's depth cap + bail-to-`unknown` discipline.
function jsonSchemaNodeToTsExpr(
  node: unknown,
  depth: number,
  ctx?: TsRenderCtx,
): string {
  if (depth > MAX_NEST_DEPTH) return "unknown";
  if (!node || typeof node !== "object" || Array.isArray(node))
    return "unknown";
  const n = node as Record<string, unknown>;

  let nullable = false;
  let typeName: string | undefined;
  if (Array.isArray(n.type)) {
    const ts = n.type.filter((x): x is string => typeof x === "string");
    nullable = ts.includes("null");
    typeName = ts.find((x) => x !== "null");
  } else if (typeof n.type === "string") {
    typeName = n.type;
  }
  const withNull = (s: string) => (nullable ? `${s} | null` : s);

  if (Array.isArray(n.enum) && n.enum.length) {
    const members = n.enum
      .filter((v) => v !== null)
      .map((v) => JSON.stringify(v))
      .join(" | ");
    return withNull(members || "unknown");
  }
  switch (typeName) {
    case "string":
      return withNull("string");
    case "number":
    case "integer":
      return withNull("number");
    case "boolean":
      return withNull("boolean");
    case "array": {
      const itemCtx = ctx
        ? { ...ctx, pointer: `${ctx.pointer}/items` }
        : undefined;
      const item =
        n.items === undefined
          ? "unknown"
          : jsonSchemaNodeToTsExpr(n.items, depth + 1, itemCtx);
      // Parenthesize a union/nullable item so `(A | B)[]` parses correctly.
      const inner = /[ |]/.test(item) ? `(${item})` : item;
      return withNull(`${inner}[]`);
    }
    case "object": {
      const props = n.properties;
      if (
        !props ||
        typeof props !== "object" ||
        Array.isArray(props) ||
        !Object.keys(props).length
      ) {
        return withNull("Record<string, unknown>");
      }
      const required = new Set(
        Array.isArray(n.required)
          ? n.required.filter((x): x is string => typeof x === "string")
          : [],
      );
      const propEntries = Object.entries(props as Record<string, unknown>);
      const memberExpr = ([k, v]: [string, unknown]) =>
        `${tsKey(k)}${required.has(k) ? "" : "?"}: ${jsonSchemaNodeToTsExpr(
          v,
          depth + 1,
          childRenderCtx(ctx, k),
        )}`;

      let name = ctx ? ctx.projection.typeNames[ctx.pointer] : undefined;
      if (name && ctx) {
        const body = propEntries.map((e) => `  ${memberExpr(e)};`).join("\n");
        const existing = ctx.named.get(name);
        if (existing !== undefined && existing !== body) {
          // Two pointers captured the same name but their schemas have since
          // diverged — disambiguate like the other converters' `emitted` sets.
          let suffix = 2;
          while (
            ctx.named.has(`${name}${suffix}`) &&
            ctx.named.get(`${name}${suffix}`) !== body
          ) {
            suffix++;
          }
          name = `${name}${suffix}`;
        }
        ctx.named.set(name, body);
        return withNull(name);
      }
      return withNull(`{ ${propEntries.map(memberExpr).join("; ")} }`);
    }
  }
  return withNull("unknown");
}

function fieldToTsExpr(f: SchemaField, ctx?: TsRenderCtx): string {
  try {
    const node =
      f.jsonSchema !== undefined
        ? JSON.parse(f.jsonSchema)
        : simpleSchemaFieldToJSONSchema(f);
    return jsonSchemaNodeToTsExpr(node, 1, ctx);
  } catch {
    return "unknown";
  }
}

// Serialize fields back to TypeScript. With `opts.projection`, a consumer's
// captured type names are reproduced as named interfaces — rendered against the
// CURRENT fields, so the names ride live schema state, not stale source text;
// without it, nested objects inline. `additionalProperties` → an index signature.
export function fieldsToTsType(
  fields: SchemaField[],
  opts?: {
    name?: string;
    additionalProperties?: boolean;
    projection?: SchemaProjection;
  },
): string {
  const name = opts?.projection?.rootName ?? opts?.name ?? "ConfigSchema";
  const named = new Map<string, string>();
  const baseCtx: TsRenderCtx | undefined = opts?.projection
    ? { pointer: "", projection: opts.projection, named }
    : undefined;
  const lines: string[] = [];
  for (const raw of fields) {
    const f = normalizeField(raw);
    // Escape `*/` so a description can't terminate the block comment early.
    if (f.description) {
      lines.push(`  /** ${f.description.replace(/\*\//g, "*\\/")} */`);
    }
    const fieldCtx = baseCtx
      ? { ...baseCtx, pointer: `/properties/${jsonPointerEscape(f.key)}` }
      : undefined;
    lines.push(
      `  ${tsKey(f.key)}${f.required ? "" : "?"}: ${fieldToTsExpr(f, fieldCtx)};`,
    );
  }
  if (opts?.additionalProperties) lines.push("  [key: string]: unknown;");
  const rootInterface = `interface ${name} {\n${lines.join("\n")}\n}`;
  // Named sub-interfaces first (deterministic order), then the root.
  const subs = [...named.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subName, body]) => `interface ${subName} {\n${body}\n}`);
  return [...subs, rootInterface].join("\n\n");
}

// TypeScript `.d.ts`-style converter (interfaces / object types).
export const typescriptConverter: SchemaConverter = {
  id: "typescript",
  label: "TypeScript",
  toFields: tsTypesToFields,
  fromFields: fieldsToTsType,
};
