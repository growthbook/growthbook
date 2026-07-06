import { evalCondition } from "@growthbook/growthbook";
import { z } from "zod";
import { configInvariantValidator } from "../../validators/features";

export type ConfigInvariant = z.infer<typeof configInvariantValidator>;
export type InvariantViolation = { name: string; message: string };

// ---------------------------------------------------------------------------
// Config cross-field invariants.
//
// The CANONICAL stored `rule` is a mongo condition (mongrule / the SDK's
// evalCondition, extended with `$ref` for field-to-field). JSONLogic and CEL are
// supported only at the API/copy boundary and converted to/from the mongo form.
// All three formats convert through a tiny internal AST (the hub below), so we
// don't need a converter for every pair.
//
// Field-to-field comparisons use a `{ $ref: "otherField" }` marker. We resolve
// those markers HERE, against the value, before calling evalCondition — rather
// than relying on the SDK to do it — so the feature works with the published
// `@growthbook/growthbook` (whose evalCondition doesn't understand `$ref`).
// ---------------------------------------------------------------------------

// Value at a dot-separated path (mongrule getPath semantics: missing → null).
function valueAtPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return current;
}

// Replace every `{ $ref: "path" }` marker in a condition with the value at that
// path, so a field-to-field rule becomes a plain literal comparison the SDK's
// evalCondition can evaluate. Returns a ref-free clone (input untouched).
function resolveRuleRefs(
  node: unknown,
  value: Record<string, unknown>,
): unknown {
  if (Array.isArray(node)) {
    return node.map((n) => resolveRuleRefs(n, value));
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (
      keys.length === 1 &&
      keys[0] === "$ref" &&
      typeof obj.$ref === "string"
    ) {
      return valueAtPath(value, obj.$ref);
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = resolveRuleRefs(obj[k], value);
    return out;
  }
  return node;
}

// JSON clone with object keys sorted recursively (arrays keep their order).
// mongrule's object/array equality is JSON.stringify comparison, and a config
// value's key order is an artifact of authoring and merge history — so both
// sides are canonicalized before evaluation to make object equality
// key-order-insensitive.
function canonicalizeKeyOrder(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(canonicalizeKeyOrder);
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = canonicalizeKeyOrder(obj[k]);
    }
    return out;
  }
  return node;
}

// Evaluate a config's cross-field invariants against its resolved value. A rule
// is SATISFIED when its mongo condition matches the value, a VIOLATION when it
// doesn't. A malformed rule is surfaced as a violation rather than thrown, so it
// can never crash the save path.
export function evaluateInvariants(
  value: Record<string, unknown>,
  invariants?: ConfigInvariant[] | null,
): InvariantViolation[] {
  if (!invariants?.length) return [];
  const canonicalValue = canonicalizeKeyOrder(value) as Record<string, unknown>;
  const violations: InvariantViolation[] = [];
  for (const inv of invariants) {
    let satisfied: boolean;
    try {
      const condition = canonicalizeKeyOrder(
        resolveRuleRefs(JSON.parse(inv.rule), canonicalValue),
      );
      satisfied = evalCondition(
        canonicalValue,
        condition as Parameters<typeof evalCondition>[1],
        {},
      );
    } catch {
      violations.push({ name: inv.name, message: inv.message });
      continue;
    }
    if (!satisfied) violations.push({ name: inv.name, message: inv.message });
  }
  return violations;
}

// ---- Internal AST (the conversion hub) ------------------------------------

type CmpOp = "==" | "!=" | "<" | "<=" | ">" | ">=";
type Rhs = { ref: string } | { lit: unknown };
type Ast =
  | { k: "and" | "or"; items: Ast[] }
  | { k: "not"; item: Ast }
  | { k: "cmp"; op: CmpOp; field: string; rhs: Rhs }
  | { k: "truthy"; field: string };

const COMP_OPS: CmpOp[] = ["==", "!=", "<", "<=", ">", ">="];
const MONGO_OP: Record<CmpOp, string> = {
  "==": "$eq",
  "!=": "$ne",
  "<": "$lt",
  "<=": "$lte",
  ">": "$gt",
  ">=": "$gte",
};
const MONGO_OP_INV: Record<string, CmpOp> = {
  $eq: "==",
  $ne: "!=",
  $lt: "<",
  $lte: "<=",
  $gt: ">",
  $gte: ">=",
};
// Prettier symbols for the human-readable "describe" view only.
const READABLE_OP: Record<CmpOp, string> = {
  "==": "==",
  "!=": "≠",
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
};

function isRef(x: unknown): x is { $ref: string } {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.keys(x as object).length === 1 &&
    typeof (x as { $ref?: unknown }).$ref === "string"
  );
}

// ---- mongo condition → AST ------------------------------------------------

// One top-level entry (key + value) → AST: a logical operator, or a field
// condition. mongoToAst ANDs all entries, so a logical op can sit beside a field
// condition (e.g. `{ $and: […], c: 3 }`) instead of being mis-read as a field.
function entryToAst(k: string, v: unknown): Ast {
  if ((k === "$and" || k === "$or") && Array.isArray(v)) {
    return { k: k === "$and" ? "and" : "or", items: v.map(mongoToAst) };
  }
  if (k === "$nor" && Array.isArray(v)) {
    return { k: "not", item: { k: "or", items: v.map(mongoToAst) } };
  }
  if (k === "$not") {
    return { k: "not", item: mongoToAst(v) };
  }
  return fieldToAst(k, v);
}

function mongoToAst(node: unknown): Ast {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("Not a mongo condition");
  }
  const obj = node as Record<string, unknown>;
  const parts = Object.keys(obj).map((k) => entryToAst(k, obj[k]));
  return parts.length === 1 ? parts[0] : { k: "and", items: parts };
}

function fieldToAst(field: string, val: unknown): Ast {
  // Shorthand equality: `{field: <primitive>}`.
  if (val === null) return { k: "cmp", op: "==", field, rhs: { lit: null } };
  if (typeof val !== "object" || Array.isArray(val)) {
    if (val === true) return { k: "truthy", field };
    return { k: "cmp", op: "==", field, rhs: { lit: val } };
  }
  const opObj = val as Record<string, unknown>;
  const ops = Object.keys(opObj);
  if (!ops.length) throw new Error(`Empty operator object for "${field}"`);
  // A field may carry several operators (e.g. a range `{$gte, $lte}`); AND them.
  const parts = ops.map((op) => operatorToAst(field, op, opObj[op]));
  return parts.length === 1 ? parts[0] : { k: "and", items: parts };
}

function operatorToAst(field: string, op: string, arg: unknown): Ast {
  if (op === "$exists") {
    return { k: "cmp", op: arg ? "!=" : "==", field, rhs: { lit: null } };
  }
  const cmp = MONGO_OP_INV[op];
  if (!cmp) throw new Error(`Unsupported mongo operator "${op}"`);
  if (cmp === "==" && arg === true) return { k: "truthy", field };
  const rhs: Rhs = isRef(arg) ? { ref: arg.$ref } : { lit: arg };
  return { k: "cmp", op: cmp, field, rhs };
}

// ---- JSONLogic → AST ------------------------------------------------------

function isVarNode(x: unknown): x is { var: string } {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.keys(x as object).length === 1 &&
    typeof (x as { var?: unknown }).var === "string"
  );
}

const JL_OP_INV: Record<string, CmpOp> = {
  "==": "==",
  "===": "==",
  "!=": "!=",
  "!==": "!=",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
};

// A JSONLogic node that is itself a boolean expression (logical or comparison),
// as opposed to a `var` reference or a scalar literal.
function isJsonLogicBoolExpr(x: unknown): boolean {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const keys = Object.keys(x as object);
  if (keys.length !== 1) return false;
  const k = keys[0];
  return k === "and" || k === "or" || k === "!" || k in JL_OP_INV;
}

// Distinguish a JSONLogic rule from a mongo condition at the write boundary.
// JSONLogic uses bare operator keys (var/and/or/!/==/…); mongo uses $-prefixed
// operators or field names. NB: json-logic-js's `is_logic` only checks for a
// single key, so it also matches mongo like `{$or:…}` — it can't be used here.
function looksLikeJsonLogic(rule: unknown): boolean {
  return isVarNode(rule) || isJsonLogicBoolExpr(rule);
}

function jsonLogicToAst(node: unknown): Ast {
  if (isVarNode(node)) return { k: "truthy", field: node.var };
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("Not a JSONLogic rule");
  }
  const obj = node as Record<string, unknown>;
  const op = Object.keys(obj)[0];
  const arg = obj[op];
  if ((op === "and" || op === "or") && Array.isArray(arg)) {
    return { k: op, items: arg.map(jsonLogicToAst) };
  }
  if (op === "!") return { k: "not", item: jsonLogicToAst(arg) };
  const cmp = JL_OP_INV[op];
  if (cmp && Array.isArray(arg) && arg.length === 2) {
    const [lhs, rhs] = arg;
    // Boolean (in)equality between sub-expressions — the "both or neither"
    // pattern, e.g. `A == (B != null)`. Expand to iff: (A ∧ B) ∨ ¬(A ∨ B).
    // (`!=` is the negation, i.e. xor.)
    if (
      (cmp === "==" || cmp === "!=") &&
      (isJsonLogicBoolExpr(lhs) || isJsonLogicBoolExpr(rhs))
    ) {
      const a = jsonLogicToAst(lhs);
      const b = jsonLogicToAst(rhs);
      const iff: Ast = {
        k: "or",
        items: [
          { k: "and", items: [a, b] },
          { k: "not", item: { k: "or", items: [a, b] } },
        ],
      };
      return cmp === "==" ? iff : { k: "not", item: iff };
    }
    if (!isVarNode(lhs))
      throw new Error("JSONLogic comparison LHS must be a var");
    const r: Rhs = isVarNode(rhs) ? { ref: rhs.var } : { lit: rhs };
    return { k: "cmp", op: cmp, field: lhs.var, rhs: r };
  }
  throw new Error(`Unsupported JSONLogic operator "${op}"`);
}

// ---- AST → mongo ----------------------------------------------------------

function astToMongo(ast: Ast): Record<string, unknown> {
  switch (ast.k) {
    case "and":
    case "or":
      return { [`$${ast.k}`]: ast.items.map(astToMongo) };
    case "not":
      // ¬(A ∨ B …) → $nor, mirroring mongoToAst and the builder's iff shape.
      if (ast.item.k === "or") {
        return { $nor: ast.item.items.map(astToMongo) };
      }
      return { $not: astToMongo(ast.item) };
    case "truthy":
      return { [ast.field]: { $eq: true } };
    case "cmp": {
      const rhs = "ref" in ast.rhs ? { $ref: ast.rhs.ref } : ast.rhs.lit;
      return { [ast.field]: { [MONGO_OP[ast.op]]: rhs } };
    }
  }
}

// ---- AST → JSONLogic ------------------------------------------------------

function astToJsonLogic(ast: Ast): Record<string, unknown> {
  switch (ast.k) {
    case "and":
    case "or":
      return { [ast.k]: ast.items.map(astToJsonLogic) };
    case "not":
      return { "!": astToJsonLogic(ast.item) };
    case "truthy":
      return { var: ast.field };
    case "cmp": {
      const rhs = "ref" in ast.rhs ? { var: ast.rhs.ref } : ast.rhs.lit;
      return { [ast.op]: [{ var: ast.field }, rhs] };
    }
  }
}

// ---- AST → CEL ------------------------------------------------------------

function celLiteral(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return `'${v.replace(/'/g, "\\'")}'`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function astToCel(ast: Ast, depth = 0): string {
  switch (ast.k) {
    case "and":
    case "or": {
      const inner = ast.items
        .map((i) => astToCel(i, depth + 1))
        .join(ast.k === "and" ? " && " : " || ");
      return depth === 0 ? inner : `(${inner})`;
    }
    case "not": {
      const inner = astToCel(ast.item, 0);
      const compound = ast.item.k === "and" || ast.item.k === "or";
      return compound || ast.item.k === "cmp" ? `!(${inner})` : `!${inner}`;
    }
    case "truthy":
      return ast.field;
    case "cmp": {
      const rhs = "ref" in ast.rhs ? ast.rhs.ref : celLiteral(ast.rhs.lit);
      return `${ast.field} ${ast.op} ${rhs}`;
    }
  }
}

// ---- AST → readable (friendly) --------------------------------------------

// (A ∧ B) ∨ ¬(A ∨ B) — the "both or neither" (iff) shape. Returns [A, B] or null.
function matchIff(items: Ast[]): [Ast, Ast] | null {
  if (items.length !== 2) return null;
  const [x, y] = items;
  if (x.k !== "and" || x.items.length !== 2) return null;
  if (y.k !== "not" || y.item.k !== "or" || y.item.items.length !== 2) {
    return null;
  }
  if (JSON.stringify(x.items) !== JSON.stringify(y.item.items)) return null;
  return [x.items[0], x.items[1]];
}

function astToReadable(ast: Ast, depth = 0): string {
  switch (ast.k) {
    case "or": {
      // ¬X ∨ Y reads as an implication ("if X then Y").
      if (ast.items.length === 2 && ast.items[0].k === "not") {
        const s = `IF ${astToReadable(ast.items[0].item, depth + 1)} THEN ${astToReadable(
          ast.items[1],
          depth + 1,
        )}`;
        return depth === 0 ? s : `(${s})`;
      }
      // (A ∧ B) ∨ ¬(A ∨ B) reads as "A if and only if B".
      const iff = matchIff(ast.items);
      if (iff) {
        const s = `${astToReadable(iff[0], depth + 1)} IF AND ONLY IF ${astToReadable(
          iff[1],
          depth + 1,
        )}`;
        return depth === 0 ? s : `(${s})`;
      }
      const inner = ast.items
        .map((i) => astToReadable(i, depth + 1))
        .join(" OR ");
      return depth === 0 ? inner : `(${inner})`;
    }
    case "and": {
      const inner = ast.items
        .map((i) => astToReadable(i, depth + 1))
        .join(" AND ");
      return depth === 0 ? inner : `(${inner})`;
    }
    case "not":
      return `NOT ${astToReadable(ast.item, depth + 1)}`;
    case "truthy":
      return ast.field;
    case "cmp": {
      if (ast.rhs && "lit" in ast.rhs && ast.rhs.lit === null) {
        return `${ast.field} ${ast.op === "==" ? "is empty" : "is set"}`;
      }
      const rhs = "ref" in ast.rhs ? ast.rhs.ref : celLiteral(ast.rhs.lit);
      return `${ast.field} ${READABLE_OP[ast.op]} ${rhs}`;
    }
  }
}

// ---- CEL → AST (recursive-descent parser) ---------------------------------

type CelToken = { type: string; value: string };

function tokenizeCel(input: string): CelToken[] {
  const tokens: CelToken[] = [];
  const two = ["&&", "||", "==", "!=", "<=", ">="];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const pair = input.slice(i, i + 2);
    if (two.includes(pair)) {
      tokens.push({ type: "op", value: pair });
      i += 2;
      continue;
    }
    if (c === "!" || c === "<" || c === ">") {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen", value: c });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen", value: c });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < input.length && input[j] !== c) {
        if (input[j] === "\\" && j + 1 < input.length) {
          s += input[j + 1];
          j += 2;
        } else {
          s += input[j];
          j++;
        }
      }
      if (j >= input.length) throw new Error("Unterminated string in CEL rule");
      tokens.push({ type: "str", value: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ type: "num", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_.]/.test(input[j])) j++;
      const word = input.slice(i, j);
      if (word === "true" || word === "false")
        tokens.push({ type: "bool", value: word });
      else if (word === "null") tokens.push({ type: "null", value: word });
      else tokens.push({ type: "ident", value: word });
      i = j;
      continue;
    }
    throw new Error(`Unexpected character "${c}" in CEL rule`);
  }
  return tokens;
}

type CelOperand =
  | { kind: "ast"; ast: Ast }
  | { kind: "ident"; name: string }
  | { kind: "lit"; value: unknown };

function celToAst(cel: string): Ast {
  const tokens = tokenizeCel(cel);
  let pos = 0;
  const peek = () => tokens[pos];

  const operandToAst = (o: CelOperand): Ast => {
    if (o.kind === "ast") return o.ast;
    if (o.kind === "ident") return { k: "truthy", field: o.name };
    throw new Error("A literal is not a valid boolean expression on its own");
  };

  const parsePrimary = (): CelOperand => {
    const t = tokens[pos++];
    if (!t) throw new Error("Unexpected end of CEL rule");
    if (t.type === "lparen") {
      const e = parseOr();
      const close = tokens[pos++];
      if (!close || close.type !== "rparen")
        throw new Error("Missing ')' in CEL rule");
      return { kind: "ast", ast: e };
    }
    if (t.type === "str") return { kind: "lit", value: t.value };
    if (t.type === "num") {
      const n = Number(t.value);
      // The tokenizer accepts any run of [0-9.], so a typo like `1.2.3` reaches
      // here as NaN — reject it rather than silently storing `$eq: null`.
      if (Number.isNaN(n)) {
        throw new Error(`Invalid number "${t.value}" in CEL rule`);
      }
      return { kind: "lit", value: n };
    }
    if (t.type === "bool") return { kind: "lit", value: t.value === "true" };
    if (t.type === "null") return { kind: "lit", value: null };
    if (t.type === "ident") return { kind: "ident", name: t.value };
    throw new Error(`Unexpected "${t.value}" in CEL rule`);
  };

  // `!` binds tighter than comparison (CEL/C precedence): it negates a primary,
  // not a whole comparison. So `!a == b` parses as `(!a) == b`; since a
  // comparison's LHS must be a bare field, that's then rejected rather than
  // silently reinterpreted as `!(a == b)`.
  const parseUnary = (): CelOperand => {
    const t = peek();
    if (t && t.type === "op" && t.value === "!") {
      pos++;
      return {
        kind: "ast",
        ast: { k: "not", item: operandToAst(parseUnary()) },
      };
    }
    return parsePrimary();
  };

  const parseComparison = (): Ast => {
    const left = parseUnary();
    const t = peek();
    if (t && t.type === "op" && COMP_OPS.includes(t.value as CmpOp)) {
      pos++;
      const right = parseUnary();
      if (left.kind !== "ident") {
        throw new Error("The left side of a comparison must be a field");
      }
      const rhs: Rhs =
        right.kind === "ident"
          ? { ref: right.name }
          : right.kind === "lit"
            ? { lit: right.value }
            : (() => {
                throw new Error("Cannot compare against a sub-expression");
              })();
      return { k: "cmp", op: t.value as CmpOp, field: left.name, rhs };
    }
    return operandToAst(left);
  };

  const parseAnd = (): Ast => {
    const items = [parseComparison()];
    while (peek()?.type === "op" && peek()?.value === "&&") {
      pos++;
      items.push(parseComparison());
    }
    return items.length === 1 ? items[0] : { k: "and", items };
  };
  function parseOr(): Ast {
    const items = [parseAnd()];
    while (peek()?.type === "op" && peek()?.value === "||") {
      pos++;
      items.push(parseAnd());
    }
    return items.length === 1 ? items[0] : { k: "or", items };
  }

  const ast = parseOr();
  if (pos < tokens.length)
    throw new Error(`Unexpected "${tokens[pos].value}" in CEL rule`);
  return ast;
}

// ---- Public converters (canonical form is the mongo condition string) ------

// mongo rule string → CEL, e.g. `min_replicas <= max_replicas`.
// Falls back to the raw string for anything it can't parse; never throws.
export function toCel(ruleJson: string): string {
  try {
    return astToCel(mongoToAst(JSON.parse(ruleJson)));
  } catch {
    return ruleJson;
  }
}

// mongo rule string → friendly readable form for the editor card + revision diff.
export function describeInvariantRule(ruleJson: string): string {
  try {
    return astToReadable(mongoToAst(JSON.parse(ruleJson)));
  } catch {
    return ruleJson;
  }
}

// CEL → mongo condition (for API upload). Throws on invalid CEL.
export function celToMongo(cel: string): Record<string, unknown> {
  return astToMongo(celToAst(cel));
}

// JSONLogic → mongo condition (for API upload). Throws if not representable.
export function jsonLogicToMongo(jl: unknown): Record<string, unknown> {
  return astToMongo(jsonLogicToAst(jl));
}

// mongo rule string → JSONLogic object (for copy). Best-effort; {} on failure.
export function mongoToJsonLogic(ruleJson: string): Record<string, unknown> {
  try {
    return astToJsonLogic(mongoToAst(JSON.parse(ruleJson)));
  } catch {
    return {};
  }
}

// ---- API boundary ---------------------------------------------------------

type ApiInvariantInput = { name: string; rule: unknown; message: string };
type ApiInvariant = {
  name: string;
  rule: Record<string, unknown>;
  message: string;
};

// Convert API invariants to the stored (mongo condition string) form. Each
// `rule` may be a mongo object, a JSONLogic object, or a CEL string — all are
// normalized to the canonical mongo condition. Throws with a rule-scoped message
// on invalid input (the API surfaces that as a 400).
export function apiInvariantsToStored(
  invariants: ApiInvariantInput[],
): ConfigInvariant[] {
  return invariants.map((inv) => {
    let mongo: Record<string, unknown>;
    try {
      if (typeof inv.rule === "string") {
        mongo = celToMongo(inv.rule);
      } else if (looksLikeJsonLogic(inv.rule)) {
        mongo = jsonLogicToMongo(inv.rule);
      } else if (inv.rule && typeof inv.rule === "object") {
        // Direct mongo passthrough. Probe it against an empty object to reject
        // hard structural errors up front. mongrule is deliberately tolerant
        // (unknown operators evaluate to false, not throw), so a semantically
        // broken rule that never matches still surfaces as a violation at
        // evaluation time rather than here — see evaluateInvariants.
        mongo = inv.rule as Record<string, unknown>;
        // Pre-resolve $ref markers like evaluation does, so a field-to-field
        // rule probes as a literal comparison instead of tripping mongrule's
        // unknown-operator console noise.
        evalCondition(
          {},
          resolveRuleRefs(mongo, {}) as Parameters<typeof evalCondition>[1],
          {},
        );
      } else {
        throw new Error(
          "rule must be a mongo/JSONLogic object or a CEL string",
        );
      }
    } catch (e) {
      throw new Error(
        `Invalid validation rule "${inv.name}": ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return {
      name: inv.name,
      rule: JSON.stringify(mongo),
      message: inv.message,
    };
  });
}

// Reverse, for API responses: stored form → `rule` as the mongo object.
export function storedInvariantsToApi(
  invariants: ConfigInvariant[] | undefined,
): ApiInvariant[] | undefined {
  if (!invariants?.length) return undefined;
  return invariants.map((inv) => {
    let rule: Record<string, unknown> = {};
    try {
      const p = JSON.parse(inv.rule);
      if (p && typeof p === "object" && !Array.isArray(p)) rule = p;
    } catch {
      // leave {}
    }
    return { name: inv.name, rule, message: inv.message };
  });
}

// ---- Field references (row-level highlighting) -----------------------------

// The field keys a mongo-condition rule references — the non-`$` object keys plus
// any `$ref` targets. Truncated to the top-level path segment because highlighting
// targets top-level schema rows; evaluation resolves full dotted paths. Never throws.
const BOOLEAN_MONGO_OPS = new Set(["$and", "$or", "$nor"]);
export function invariantRuleFields(ruleJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(ruleJson);
  } catch {
    return [];
  }
  const fields = new Set<string>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === "$ref" && typeof v === "string") {
        const top = v.split(".")[0];
        if (top) fields.add(top);
      } else if (BOOLEAN_MONGO_OPS.has(k) || k === "$not") {
        walk(v);
      } else if (k.startsWith("$")) {
        walk(v);
      } else {
        const top = k.split(".")[0];
        if (top) fields.add(top);
        walk(v);
      }
    }
  };
  walk(parsed);
  return [...fields];
}
