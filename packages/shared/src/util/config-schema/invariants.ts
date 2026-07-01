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

const CEL_COMPARATORS: Record<string, string> = {
  "==": "==",
  "===": "==",
  "!=": "!=",
  "!==": "!=",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
};

function isCompoundNode(x: unknown): boolean {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.keys(x as object).length === 1 &&
    !("var" in (x as object))
  );
}

function celNode(node: unknown, depth: number): string {
  if (node === null) return "null";
  // CEL string literals — single-quoted (Google CEL convention; keeps the
  // expression clean inside a double-quoted YAML `rule:` scalar).
  if (typeof node === "string") return `'${node.replace(/'/g, "\\'")}'`;
  if (typeof node === "number" || typeof node === "boolean")
    return String(node);
  if (Array.isArray(node))
    return node.map((n) => celNode(n, depth + 1)).join(", ");
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const op = keys[0];
      const arg = obj[op];
      if (op === "var")
        return typeof arg === "string" ? arg : celNode(arg, depth + 1);
      if (op === "!") {
        // Render the operand un-parenthesized (depth 0), then wrap once when it
        // needs grouping — avoids `!((a && b))`.
        const inner = celNode(arg, 0);
        return isCompoundNode(arg) ? `!(${inner})` : `!${inner}`;
      }
      if ((op === "and" || op === "or") && Array.isArray(arg)) {
        const inner = arg
          .map((a) => celNode(a, depth + 1))
          .join(op === "and" ? " && " : " || ");
        return depth === 0 ? inner : `(${inner})`;
      }
      if (CEL_COMPARATORS[op] && Array.isArray(arg) && arg.length === 2) {
        const operand = (a: unknown) => {
          const s = celNode(a, depth + 1);
          return isCompoundNode(a) ? `(${s})` : s;
        };
        return `${operand(arg[0])} ${CEL_COMPARATORS[op]} ${operand(arg[1])}`;
      }
    }
  }
  return JSON.stringify(node);
}

// Transpile a JSONLogic rule string to a CEL (Common Expression Language)
// expression — e.g. `!hdr_enabled || max_resolution == "4k"`. Covers the
// comparison/boolean subset the builder produces; falls back to the raw string
// for anything it can't parse. Never throws.
export function toCel(ruleJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(ruleJson);
  } catch {
    return ruleJson;
  }
  return celNode(parsed, 0);
}

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

// Parse a CEL expression into JSONLogic (the reverse of toCel). Handles the
// boolean/comparison subset: && || ! == != < <= > >=, parens, field identifiers,
// and string/number/bool/null literals. Throws on anything it can't parse (the
// API surfaces that as a 400). This is a small recursive-descent parser, not a
// full CEL implementation — macros/functions aren't supported.
export function celToJsonLogic(cel: string): unknown {
  const tokens = tokenizeCel(cel);
  let pos = 0;
  const peek = () => tokens[pos];
  const COMP = ["==", "!=", "<", "<=", ">", ">="];

  const parsePrimary = (): unknown => {
    const t = tokens[pos++];
    if (!t) throw new Error("Unexpected end of CEL rule");
    if (t.type === "lparen") {
      const e = parseOr();
      const close = tokens[pos++];
      if (!close || close.type !== "rparen")
        throw new Error("Missing ')' in CEL rule");
      return e;
    }
    if (t.type === "str") return t.value;
    if (t.type === "num") return Number(t.value);
    if (t.type === "bool") return t.value === "true";
    if (t.type === "null") return null;
    if (t.type === "ident") return { var: t.value };
    throw new Error(`Unexpected "${t.value}" in CEL rule`);
  };
  const parseComparison = (): unknown => {
    const left = parsePrimary();
    const t = peek();
    if (t && t.type === "op" && COMP.includes(t.value)) {
      pos++;
      return { [t.value]: [left, parsePrimary()] };
    }
    return left;
  };
  const parseUnary = (): unknown => {
    const t = peek();
    if (t && t.type === "op" && t.value === "!") {
      pos++;
      return { "!": parseUnary() };
    }
    return parseComparison();
  };
  const parseAnd = (): unknown => {
    const parts = [parseUnary()];
    while (peek()?.type === "op" && peek()?.value === "&&") {
      pos++;
      parts.push(parseUnary());
    }
    return parts.length === 1 ? parts[0] : { and: parts };
  };
  function parseOr(): unknown {
    const parts = [parseAnd()];
    while (peek()?.type === "op" && peek()?.value === "||") {
      pos++;
      parts.push(parseAnd());
    }
    return parts.length === 1 ? parts[0] : { or: parts };
  }

  const result = parseOr();
  if (pos < tokens.length)
    throw new Error(`Unexpected "${tokens[pos].value}" in CEL rule`);
  return result;
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
