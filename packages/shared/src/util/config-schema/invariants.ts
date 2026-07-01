import { apply, truthy } from "json-logic-js";
import { z } from "zod";
import { configInvariantValidator } from "../../validators/features";

export type ConfigInvariant = z.infer<typeof configInvariantValidator>;
export type InvariantViolation = { name: string; message: string };

// Evaluate a config's cross-field invariants against its resolved (inherited+own)
// value. Each invariant's `rule` is a JSONLogic boolean expression; a missing
// field reads as null (json-logic-js `var` semantics), so rules must tolerate
// nulls (e.g. `field != null`). Returns one entry per rule that isn't satisfied.
// A malformed rule is surfaced as a violation rather than throwing, so it can
// never crash the save path.
export function evaluateInvariants(
  value: Record<string, unknown>,
  invariants?: ConfigInvariant[] | null,
): InvariantViolation[] {
  if (!invariants?.length) return [];
  const violations: InvariantViolation[] = [];
  for (const inv of invariants) {
    let satisfied: boolean;
    try {
      const rule = JSON.parse(inv.rule) as Parameters<typeof apply>[0];
      satisfied = truthy(apply(rule, value));
    } catch {
      // Unparseable or malformed rule → surface as a violation, never throw.
      violations.push({ name: inv.name, message: inv.message });
      continue;
    }
    if (!satisfied) violations.push({ name: inv.name, message: inv.message });
  }
  return violations;
}

const COMPARATORS: Record<string, string> = {
  "==": "==",
  "===": "==",
  "!=": "≠",
  "!==": "≠",
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
};

function isVarNode(x: unknown): boolean {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.keys(x as object).length === 1 &&
    "var" in (x as object)
  );
}

function describeNode(node: unknown, depth: number): string {
  if (node === null) return "null";
  if (typeof node === "string") return JSON.stringify(node);
  if (typeof node === "number" || typeof node === "boolean")
    return String(node);
  if (Array.isArray(node))
    return node.map((n) => describeNode(n, depth + 1)).join(", ");
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const op = keys[0];
      const arg = obj[op];
      if (op === "var")
        return typeof arg === "string" ? arg : describeNode(arg, depth + 1);
      if (op === "!") return `NOT ${describeNode(arg, depth + 1)}`;
      // ¬X ∨ Y reads as an implication ("if X then Y") — friendlier than the
      // raw `NOT X OR Y` for the common feature-dependency rules.
      if (op === "or" && Array.isArray(arg) && arg.length === 2) {
        const first = arg[0];
        if (
          first &&
          typeof first === "object" &&
          !Array.isArray(first) &&
          Object.keys(first as object).length === 1 &&
          "!" in (first as object)
        ) {
          const antecedent = describeNode(
            (first as Record<string, unknown>)["!"],
            depth + 1,
          );
          const consequent = describeNode(arg[1], depth + 1);
          const s = `IF ${antecedent} THEN ${consequent}`;
          return depth === 0 ? s : `(${s})`;
        }
      }
      if ((op === "and" || op === "or") && Array.isArray(arg)) {
        const inner = arg
          .map((a) => describeNode(a, depth + 1))
          .join(op === "and" ? " AND " : " OR ");
        return depth === 0 ? inner : `(${inner})`;
      }
      if (COMPARATORS[op] && Array.isArray(arg) && arg.length === 2) {
        // Parenthesize a nested expression operand (e.g. the `x != null` side of
        // a both-or-neither rule) so `a == (b ≠ null)` doesn't read ambiguously;
        // plain field/literal operands stay bare.
        const operand = (a: unknown) => {
          const s = describeNode(a, depth + 1);
          return a && typeof a === "object" && !isVarNode(a) ? `(${s})` : s;
        };
        return `${operand(arg[0])} ${COMPARATORS[op]} ${operand(arg[1])}`;
      }
    }
  }
  return JSON.stringify(node);
}

// A compact, human-readable "simple view" of a JSONLogic rule string, for the
// editor card + revision diff. Renders the comparison/boolean subset the builder
// produces (e.g. `hello == "4k"`, `NOT (a AND b)`); falls back to the raw string
// for anything it can't parse, so it never throws.
export function describeInvariantRule(ruleJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(ruleJson);
  } catch {
    return ruleJson;
  }
  return describeNode(parsed, 0);
}

// The field keys a rule references (every `{var}`), for row-level highlighting
// of which fields a failing rule involves. Uses the top-level path segment
// (configs are flat). Never throws.
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
    const obj = n as Record<string, unknown>;
    if (Object.keys(obj).length === 1 && typeof obj.var === "string") {
      const top = obj.var.split(".")[0];
      if (top) fields.add(top);
      return;
    }
    Object.values(obj).forEach(walk);
  };
  walk(parsed);
  return [...fields];
}
