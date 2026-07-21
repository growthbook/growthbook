// Pure condition <-> mongo-rule conversion for the config invariants builder.
// Extracted from ConfigInvariantsEditor so the round-trip and mongrule-eval
// semantics can be unit-tested without the React component.

export const COMPARISON_OPS = ["==", "!=", "<=", "<", ">=", ">"] as const;
export const UNARY_OPS = ["isTrue", "isFalse", "isNull", "isNotNull"] as const;
export type CompOp = (typeof COMPARISON_OPS)[number];
export type CondOp = CompOp | (typeof UNARY_OPS)[number];
export const ALL_OPS: CondOp[] = [...COMPARISON_OPS, ...UNARY_OPS];

export type Condition = {
  field: string;
  op: CondOp;
  rhsKind: "value" | "field";
  rhs: string;
};

export function isComp(op: CondOp): op is CompOp {
  return (COMPARISON_OPS as readonly string[]).includes(op);
}

const MONGO_OP: Record<CompOp, string> = {
  "==": "$eq",
  "!=": "$ne",
  "<": "$lt",
  "<=": "$lte",
  ">": "$gt",
  ">=": "$gte",
};
const MONGO_OP_INV: Record<string, CompOp> = {
  $eq: "==",
  $ne: "!=",
  $lt: "<",
  $lte: "<=",
  $gt: ">",
  $gte: ">=",
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

// A plain (non-operator, non-$ref) object/array literal — the kind mongrule
// compares with deep (JSON.stringify) equality rather than strict `===`.
function isNonScalar(v: unknown): boolean {
  return !!v && typeof v === "object";
}

function isOperatorObject(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  return keys.length > 0 && keys.every((k) => k.startsWith("$"));
}

// Parse a typed right-hand-side value: JSON first (so 5, true, null, "quoted",
// {objects}/[arrays] keep their type), then a bare word falls back to a string.
export function parseLiteral(s: string): unknown {
  const t = s.trim();
  try {
    return JSON.parse(t);
  } catch {
    return t.replace(/^['"]|['"]$/g, "");
  }
}

// Inverse for the text input: show a string bare unless it would re-parse as a
// non-string (then quote it); everything else as JSON.
export function formatLiteral(v: unknown): string {
  if (v === null) return "null";
  if (typeof v !== "string") return JSON.stringify(v);
  try {
    if (typeof JSON.parse(v) !== "string") return JSON.stringify(v);
  } catch {
    // not JSON — safe to show bare
  }
  return v;
}

export function conditionToMongo(c: Condition): Record<string, unknown> {
  switch (c.op) {
    case "isTrue":
      return { [c.field]: { $eq: true } };
    case "isFalse":
      return { [c.field]: { $eq: false } };
    case "isNull":
      return { [c.field]: { $exists: false } };
    case "isNotNull":
      return { [c.field]: { $exists: true } };
    default: {
      if (c.rhsKind === "field") {
        return { [c.field]: { [MONGO_OP[c.op]]: { $ref: c.rhs } } };
      }
      const rhs = parseLiteral(c.rhs);
      // mongrule's $eq/$ne use strict `===`, which can never match an
      // object/array. For non-scalar equality emit the shorthand form
      // (`{field: literal}`) so the evaluator deep-compares; for inequality
      // use a field-scoped `$not` around that same shorthand literal.
      if ((c.op === "==" || c.op === "!=") && isNonScalar(rhs)) {
        return c.op === "=="
          ? { [c.field]: rhs }
          : { [c.field]: { $not: rhs } };
      }
      return { [c.field]: { [MONGO_OP[c.op]]: rhs } };
    }
  }
}

// A single mongo field condition -> Condition; null if not representable.
export function parseCondition(node: unknown): Condition | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return null;
  const field = keys[0];
  if (field.startsWith("$")) return null; // an operator, not a field
  const val = obj[field];
  // Shorthand: `{field: <primitive>}` and `{field: <array/object literal>}`.
  if (val === null) return { field, op: "isNull", rhsKind: "value", rhs: "" };
  if (typeof val !== "object" || Array.isArray(val)) {
    if (val === true) return { field, op: "isTrue", rhsKind: "value", rhs: "" };
    if (val === false)
      return { field, op: "isFalse", rhsKind: "value", rhs: "" };
    return { field, op: "==", rhsKind: "value", rhs: formatLiteral(val) };
  }
  // A non-array object that isn't an operator object is an equality shorthand
  // (deep-compared object literal), not an operator condition.
  if (!isOperatorObject(val)) {
    return { field, op: "==", rhsKind: "value", rhs: formatLiteral(val) };
  }
  const opObj = val as Record<string, unknown>;
  if (Object.keys(opObj).length !== 1) return null;
  const op = Object.keys(opObj)[0];
  const arg = opObj[op];
  if (op === "$exists") {
    return {
      field,
      op: arg ? "isNotNull" : "isNull",
      rhsKind: "value",
      rhs: "",
    };
  }
  // Field-scoped `$not` around a non-scalar literal is deep inequality.
  if (op === "$not" && isNonScalar(arg) && !isOperatorObject(arg)) {
    return { field, op: "!=", rhsKind: "value", rhs: formatLiteral(arg) };
  }
  const cmp = MONGO_OP_INV[op];
  if (!cmp) return null;
  if (cmp === "==" && arg === true)
    return { field, op: "isTrue", rhsKind: "value", rhs: "" };
  if (cmp === "==" && arg === false)
    return { field, op: "isFalse", rhsKind: "value", rhs: "" };
  if (cmp === "==" && arg === null)
    return { field, op: "isNull", rhsKind: "value", rhs: "" };
  if (cmp === "!=" && arg === null)
    return { field, op: "isNotNull", rhsKind: "value", rhs: "" };
  if (isRef(arg)) return { field, op: cmp, rhsKind: "field", rhs: arg.$ref };
  return { field, op: cmp, rhsKind: "value", rhs: formatLiteral(arg) };
}
