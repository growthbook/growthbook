import { evalCondition } from "@growthbook/growthbook";
import { z } from "zod";
import { configInvariantValidator } from "../../validators/features";
import { isUnsafeMergeKey } from "../deep-merge";

export type ConfigInvariant = z.infer<typeof configInvariantValidator>;
export type InvariantViolation = { name: string; message: string };

// ---------------------------------------------------------------------------
// Config cross-field invariants.
//
// A `rule` is a mongo condition (mongrule / the SDK's evalCondition, extended
// with `$ref` for field-to-field) — the single representation everywhere: stored,
// evaluated, returned by the API, and shown in the UI. It's the same condition
// language as feature/experiment targeting. A small internal AST backs only the
// human-readable "describe" view (mongo → friendly text).
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
    if (
      current &&
      typeof current === "object" &&
      Object.prototype.hasOwnProperty.call(current, part)
    ) {
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
    for (const k of keys) {
      if (isUnsafeMergeKey(k)) continue;
      out[k] = resolveRuleRefs(obj[k], value);
    }
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

// ---- AST → readable (friendly) --------------------------------------------

function formatLiteral(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

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
      const rhs = "ref" in ast.rhs ? ast.rhs.ref : formatLiteral(ast.rhs.lit);
      return `${ast.field} ${READABLE_OP[ast.op]} ${rhs}`;
    }
  }
}

// ---- Public: mongo rule string → friendly readable form -------------------

// Used by the editor card and the revision diff. Never throws; falls back to
// the raw string for anything it can't parse.
export function describeInvariantRule(ruleJson: string): string {
  try {
    return astToReadable(mongoToAst(JSON.parse(ruleJson)));
  } catch {
    return ruleJson;
  }
}

// ---- API boundary ---------------------------------------------------------

type ApiInvariantInput = { name: string; rule: unknown; message?: string };
type ApiInvariant = {
  name: string;
  rule: Record<string, unknown>;
  message: string;
};

// A generic violation message when the author didn't supply one. The rule's
// `name` is required and meaningful (e.g. "min_le_max"), so lead with it.
export function defaultInvariantMessage(name: string): string {
  return name.trim()
    ? `Failed validation rule "${name.trim()}"`
    : "This value failed a validation rule.";
}

// Convert API invariants to the stored (mongo condition string) form. `rule` is
// a mongo condition object. A blank/omitted `message` defaults to a generic one.
// Throws with a rule-scoped message on invalid input (the API surfaces as 400).
export function apiInvariantsToStored(
  invariants: ApiInvariantInput[],
): ConfigInvariant[] {
  return invariants.map((inv) => {
    if (!inv.rule || typeof inv.rule !== "object" || Array.isArray(inv.rule)) {
      throw new Error(
        `Invalid validation rule "${inv.name}": rule must be a mongo condition object`,
      );
    }
    const mongo = inv.rule as Record<string, unknown>;
    try {
      // Probe against an empty object to reject hard structural errors up front.
      // mongrule is deliberately tolerant (unknown operators evaluate to false,
      // not throw), so a semantically broken rule that never matches still
      // surfaces as a violation at evaluation time rather than here — see
      // evaluateInvariants. Pre-resolve $ref markers like evaluation does so a
      // field-to-field rule probes as a literal comparison.
      evalCondition(
        {},
        resolveRuleRefs(mongo, {}) as Parameters<typeof evalCondition>[1],
        {},
      );
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
      message: inv.message?.trim() || defaultInvariantMessage(inv.name),
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
  // `inValue` = walking a field's comparison RHS, where plain object keys are
  // literal data — e.g. `{status: {active: true}}` matches the object value, so
  // `active` is NOT a referenced field. In that context we still collect `$ref`
  // targets and descend `$`-operator args, but never treat a bare key as a field.
  const walk = (n: unknown, inValue: boolean): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach((x) => walk(x, inValue));
      return;
    }
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === "$ref" && typeof v === "string") {
        const top = v.split(".")[0];
        if (top) fields.add(top);
      } else if (BOOLEAN_MONGO_OPS.has(k) || k === "$not") {
        // Sub-condition(s) — their keys are fields again.
        walk(v, false);
      } else if (k.startsWith("$")) {
        // Operator argument — a literal value context.
        walk(v, true);
      } else if (inValue) {
        // Literal object key inside an RHS value — data, not a field. Descend
        // only to catch a nested `$ref` marker.
        walk(v, true);
      } else {
        // Field position: k names a field; its value is the comparison RHS.
        const top = k.split(".")[0];
        if (top) fields.add(top);
        walk(v, true);
      }
    }
  };
  walk(parsed, false);
  return [...fields];
}
