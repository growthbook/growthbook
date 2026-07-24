import { useState, type ReactElement } from "react";
import { Flex } from "@radix-ui/themes";
import { FeatureRule } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { paddedVersionString } from "@growthbook/growthbook";
import { ruleProjectScope } from "shared/util";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { getRadixColor, RadixColor, RadixStatusIcon } from "@/ui/HelperText";
import { getUpcomingScheduleRule } from "@/services/scheduleRules";
import { isRuleInactive } from "@/services/features";

// ---------------------------------------------------------------------------
// Rule reachability & conflict detection
//
// A rule's full targeting (condition + saved groups + prerequisites) is first
// collapsed into a boolean tree of per-attribute "atoms" (in / not-in value
// sets, numeric ranges, version ranges) combined with and/or/not, then
// simplified. Saved groups expand into this tree the same way the SDK payload
// builds them (list group → `attr ∈ values`, condition group → its condition;
// match all → AND, any → OR, none → NOT). The flat top-level AND of atoms
// drives precise per-attribute conflicts; the full tree drives reachability for
// shapes a flat AND can't express (an OR across groups, a negated group, …).
// Operators we can't model precisely (regex, $exists, an ID-list group whose
// values aren't loaded yet, …) become "opaque" nodes that still track the
// attributes they reference, so we can surface a *soft* "may not reach" warning
// when a rule above targets the same attribute.
// ---------------------------------------------------------------------------

type InAtom = {
  op: "in";
  values: Set<string>;
  insensitive?: boolean; // $ini — values stored lower-cased
};
type NotInAtom = {
  op: "notIn";
  values: Set<string>;
  insensitive?: boolean; // $nini — values stored lower-cased
};

type Atom =
  | InAtom // attr ∈ values  ($eq, $in, $ini)
  | NotInAtom // attr ∉ values  ($ne, $nin, $nini)
  // numeric range ($gt/$gte/$lt/$lte)
  | {
      op: "num";
      lo: number | null;
      loInc: boolean;
      hi: number | null;
      hiInc: boolean;
    }
  // version range ($vgt/$vgte/$vlt/$vlte)
  | {
      op: "ver";
      lo: string | null;
      loInc: boolean;
      hi: string | null;
      hiInc: boolean;
    };

type ParsedTargeting = {
  // Precisely-modeled top-level AND constraints (one atom per conjunct).
  constraints: { attr: string; atom: Atom }[];
  // Attributes that have a modeled atom.
  modeledAttrs: Set<string>;
  // Every attribute the rule targets, including ones referenced only opaquely
  // (regex, $exists, an unloaded list group, nested $or, …). Used for soft
  // overlap.
  attributes: Set<string>;
  // True when the rule targets everyone (no condition / groups / prerequisites).
  catchAll: boolean;
  // True when `constraints` completely represent the targeting (no opaque parts),
  // so a single-attribute rule can be treated as fully consuming its match.
  reliable: boolean;
  // The full simplified boolean tree, for reachability of OR/NOT shapes that the
  // flat `constraints` can't express.
  expr: Expr;
};

// A precise conflict: a rule above fully serves a sub-population this rule targets.
export type RuleHardConflict = {
  consumingRuleId: string;
  // The attribute whose targeting overlaps (null for catch-all consumers).
  attr: string | null;
  // Human-readable value/range label (e.g. "Safari", "> 18, < 21"), or null when
  // the rule above is unconditional / covers the whole population.
  label: string | null;
};

// Stable identity for a hard conflict, for de-duping within a rule (the same
// consuming rule can surface via both the flat-AND pass and the tree pass) and
// across environments.
function hardConflictKey(c: {
  consumingRuleId: string;
  attr: string | null;
  label: string | null;
}): string {
  return `${c.consumingRuleId}|${c.attr ?? ""}|${c.label ?? ""}`;
}

// A soft conflict: traffic may be served above before reaching this rule, but
// we can't prove how much. Either a rule above also targets one of this rule's
// attributes (`attr` set), or an untargeted partial rollout above siphons a
// share of *all* traffic (`attr` null).
export type RuleSoftConflict = {
  attr: string | null;
  consumingRuleIds: string[];
};

export type RuleReachability = {
  // The rule can never be served — every user it matches is consumed above.
  unreachable: boolean;
  // Sub-populations precisely shown to be fully served above ("will not reach").
  hardConflicts: RuleHardConflict[];
  // Attributes a rule above also targets, where overlap can't be ruled out
  // ("may not reach").
  softConflicts: RuleSoftConflict[];
};

// Parse a single attribute's value into an atom, or null when the operator(s)
// aren't ones we model precisely.
function parseAttrConstraint(value: unknown): Atom | null {
  if (value === null) return null;
  if (typeof value !== "object") {
    // Scalar equality, e.g. { country: "US" }
    return { op: "in", values: new Set([String(value)]) };
  }
  if (Array.isArray(value)) return null;

  const ops = value as Record<string, unknown>;
  const keys = Object.keys(ops);
  if (!keys.length) return null;
  const has = (k: string) => k in ops;

  if (keys.every((k) => k === "$eq")) {
    return { op: "in", values: new Set([String(ops.$eq)]) };
  }
  if (keys.every((k) => k === "$in" || k === "$ini")) {
    // Invariant: when an atom is case-insensitive, every stored value is
    // lower-cased, so membership tests stay O(1) (just lower-case the probe).
    const insensitive = keys.includes("$ini");
    const values = new Set<string>();
    for (const k of keys) {
      if (Array.isArray(ops[k])) {
        (ops[k] as unknown[]).forEach((v) => {
          const str = String(v);
          values.add(insensitive ? str.toLowerCase() : str);
        });
      }
    }
    return { op: "in", values, ...(insensitive ? { insensitive: true } : {}) };
  }
  if (keys.every((k) => k === "$ne" || k === "$nin" || k === "$nini")) {
    const insensitive = keys.includes("$nini");
    const values = new Set<string>();
    for (const k of keys) {
      if (k === "$ne") {
        const str = String(ops[k]);
        values.add(insensitive ? str.toLowerCase() : str);
      } else if (Array.isArray(ops[k])) {
        (ops[k] as unknown[]).forEach((v) => {
          const str = String(v);
          values.add(insensitive ? str.toLowerCase() : str);
        });
      }
    }
    return {
      op: "notIn",
      values,
      ...(insensitive ? { insensitive: true } : {}),
    };
  }
  if (keys.every((k) => ["$gt", "$gte", "$lt", "$lte"].includes(k))) {
    const lo = has("$gte")
      ? Number(ops.$gte)
      : has("$gt")
        ? Number(ops.$gt)
        : null;
    const hi = has("$lte")
      ? Number(ops.$lte)
      : has("$lt")
        ? Number(ops.$lt)
        : null;
    if ((lo !== null && isNaN(lo)) || (hi !== null && isNaN(hi))) return null;
    return { op: "num", lo, loInc: has("$gte"), hi, hiInc: has("$lte") };
  }
  if (keys.every((k) => ["$vgt", "$vgte", "$vlt", "$vlte"].includes(k))) {
    return {
      op: "ver",
      lo: has("$vgte")
        ? String(ops.$vgte)
        : has("$vgt")
          ? String(ops.$vgt)
          : null,
      loInc: has("$vgte"),
      hi: has("$vlte")
        ? String(ops.$vlte)
        : has("$vlt")
          ? String(ops.$vlt)
          : null,
      hiInc: has("$vlte"),
    };
  }
  // $regex, $exists, $inGroup, $elemMatch, $size, $type, $not, mixed, … → opaque
  return null;
}

// A boolean targeting tree. Atoms are the precisely-modeled leaves; `opaque`
// leaves are targeting we can't model but still want to track attributes for.
type Expr =
  | { type: "atom"; attr: string; atom: Atom }
  | { type: "and"; children: Expr[] }
  | { type: "or"; children: Expr[] }
  | { type: "not"; child: Expr }
  | { type: "opaque"; attrs: string[] };

// Minimal saved-group shape the analyzer needs. `values` is optional because
// the front-end loads ID-list values lazily — until they arrive a list group is
// opaque (its attribute is still tracked for soft overlap).
export type SavedGroupForConflicts = {
  type: "list" | "condition";
  attributeKey?: string;
  values?: string[];
  condition?: string;
};

// Targets everyone.
const TRUE_EXPR: Expr = { type: "and", children: [] };

const opaque = (attrs: string[] = []): Expr => ({ type: "opaque", attrs });
const and = (children: Expr[]): Expr => ({ type: "and", children });
const or = (children: Expr[]): Expr => ({ type: "or", children });
const not = (child: Expr): Expr => ({ type: "not", child });

// Negate an in/notIn atom (clean set complement). Ranges have no single-atom
// negation, so callers fall back to a `not` node.
function negateAtom(e: Expr): Expr | null {
  if (e.type !== "atom") return null;
  if (e.atom.op === "in") {
    return {
      type: "atom",
      attr: e.attr,
      atom: {
        op: "notIn",
        values: e.atom.values,
        ...(e.atom.insensitive ? { insensitive: true } : {}),
      },
    };
  }
  if (e.atom.op === "notIn") {
    return {
      type: "atom",
      attr: e.attr,
      atom: {
        op: "in",
        values: e.atom.values,
        ...(e.atom.insensitive ? { insensitive: true } : {}),
      },
    };
  }
  return null;
}

// Flatten nested and/or, collapse single-child nodes, and push `not` through
// atoms (set complement) and through and/or (De Morgan), so negated saved
// groups surface as ordinary notIn/in constraints where possible.
function simplify(e: Expr): Expr {
  switch (e.type) {
    case "and": {
      const kids = e.children
        .map(simplify)
        .flatMap((k) => (k.type === "and" ? k.children : [k]));
      return kids.length === 1 ? kids[0] : and(kids);
    }
    case "or": {
      const kids = e.children
        .map(simplify)
        .flatMap((k) => (k.type === "or" ? k.children : [k]));
      return kids.length === 1 ? kids[0] : or(kids);
    }
    case "not": {
      const c = simplify(e.child);
      if (c.type === "not") return c.child; // ¬¬x = x
      const negated = negateAtom(c);
      if (negated) return negated;
      if (c.type === "and") return simplify(or(c.children.map(not)));
      if (c.type === "or") return simplify(and(c.children.map(not)));
      return not(c);
    }
    default:
      return e;
  }
}

// Every attribute referenced anywhere in the tree (for soft overlap).
function collectAttrs(e: Expr, acc: Set<string> = new Set()): Set<string> {
  switch (e.type) {
    case "atom":
      acc.add(e.attr);
      break;
    case "opaque":
      e.attrs.forEach((a) => acc.add(a));
      break;
    case "not":
      collectAttrs(e.child, acc);
      break;
    case "and":
    case "or":
      e.children.forEach((c) => collectAttrs(c, acc));
      break;
  }
  return acc;
}

// `{ attr: { $inGroup: id } }` / `$notInGroup` → an in/notIn atom built from the
// group's loaded values, or opaque when the values aren't available.
function groupOperatorExpr(
  attr: string,
  op: "$inGroup" | "$notInGroup",
  groupId: unknown,
  savedGroups: Map<string, SavedGroupForConflicts>,
): Expr {
  const group =
    typeof groupId === "string" ? savedGroups.get(groupId) : undefined;
  if (group?.type === "list" && group.values?.length) {
    const e: Expr = {
      type: "atom",
      attr,
      atom: { op: "in", values: new Set(group.values.map(String)) },
    };
    return op === "$inGroup" ? e : not(e);
  }
  return opaque([attr]);
}

// One attribute clause from a condition object → atom or opaque.
function attrToExpr(
  attr: string,
  value: unknown,
  savedGroups: Map<string, SavedGroupForConflicts>,
): Expr {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const ops = value as Record<string, unknown>;
    const keys = Object.keys(ops);
    if (
      keys.length === 1 &&
      (keys[0] === "$inGroup" || keys[0] === "$notInGroup")
    ) {
      return groupOperatorExpr(
        attr,
        keys[0] as "$inGroup" | "$notInGroup",
        ops[keys[0]],
        savedGroups,
      );
    }
  }
  const atom = parseAttrConstraint(value);
  return atom ? { type: "atom", attr, atom } : opaque([attr]);
}

// A parsed MongoDB-style condition object → boolean tree.
function conditionToExpr(
  cond: unknown,
  savedGroups: Map<string, SavedGroupForConflicts>,
): Expr {
  if (!cond || typeof cond !== "object" || Array.isArray(cond)) {
    return opaque();
  }
  const children: Expr[] = [];
  for (const [key, value] of Object.entries(cond as Record<string, unknown>)) {
    if (key === "$and" && Array.isArray(value)) {
      children.push(and(value.map((v) => conditionToExpr(v, savedGroups))));
    } else if (key === "$or" && Array.isArray(value)) {
      children.push(or(value.map((v) => conditionToExpr(v, savedGroups))));
    } else if (key === "$nor" && Array.isArray(value)) {
      children.push(not(or(value.map((v) => conditionToExpr(v, savedGroups)))));
    } else if (key === "$not") {
      children.push(not(conditionToExpr(value, savedGroups)));
    } else if (key.startsWith("$")) {
      // Unknown / opaque top-level operator.
      children.push(opaque());
    } else {
      children.push(attrToExpr(key, value, savedGroups));
    }
  }
  return and(children);
}

// A single saved group → boolean tree (list → in atom, condition → its tree).
function savedGroupToExpr(
  group: SavedGroupForConflicts | undefined,
  savedGroups: Map<string, SavedGroupForConflicts>,
): Expr {
  if (!group) return opaque();
  if (group.type === "list") {
    if (group.attributeKey && group.values?.length) {
      return {
        type: "atom",
        attr: group.attributeKey,
        atom: { op: "in", values: new Set(group.values.map(String)) },
      };
    }
    // Values not loaded yet (or empty) — opaque, but track the attribute.
    return opaque(group.attributeKey ? [group.attributeKey] : []);
  }
  if (
    group.type === "condition" &&
    group.condition &&
    group.condition !== "{}"
  ) {
    try {
      return conditionToExpr(JSON.parse(group.condition), savedGroups);
    } catch {
      return opaque();
    }
  }
  return opaque();
}

// A `savedGroups` targeting entry → boolean tree, mirroring getParsedCondition:
// all → AND, any → OR, none → NOT(OR).
function savedGroupTargetingToExpr(
  sg: { match: "all" | "any" | "none"; ids: string[] },
  savedGroups: Map<string, SavedGroupForConflicts>,
): Expr {
  const exprs = sg.ids.map((id) =>
    savedGroupToExpr(savedGroups.get(id), savedGroups),
  );
  if (sg.match === "all") return and(exprs);
  if (sg.match === "any") return or(exprs);
  return not(or(exprs)); // none
}

function parseRuleTargeting(
  rule: FeatureRule,
  savedGroups: Map<string, SavedGroupForConflicts>,
): ParsedTargeting {
  const parts: Expr[] = [];

  if (rule.condition && rule.condition !== "{}") {
    try {
      parts.push(conditionToExpr(JSON.parse(rule.condition), savedGroups));
    } catch {
      parts.push(opaque());
    }
  }

  for (const sg of rule.savedGroups ?? []) {
    parts.push(savedGroupTargetingToExpr(sg, savedGroups));
  }

  // Prerequisites gate the rule on another flag's value — opaque to us.
  if (rule.prerequisites?.length) parts.push(opaque());

  const expr = parts.length ? simplify(and(parts)) : TRUE_EXPR;

  // Top-level AND conjuncts that are atoms become precise constraints; anything
  // else (OR, NOT, opaque) is reasoned about only via the full tree + attrs.
  // Multiple atoms on the same attribute are intersected into one so the
  // per-attribute analysis sees the rule's true projection: e.g. a "none of" a
  // condition group De-Morgans into `id ∉ A AND id ∉ B`, which must be read as
  // `id ∉ (A ∪ B)`. Analyzing the conjuncts independently would falsely flag the
  // values one conjunct excludes but the other allows.
  const top = expr.type === "and" ? expr.children : [expr];
  let reliable = true;
  const byAttr = new Map<string, Atom>();
  const opaqueAttrs = new Set<string>();
  for (const c of top) {
    if (c.type !== "atom") {
      reliable = false;
      continue;
    }
    if (opaqueAttrs.has(c.attr)) continue;
    const existing = byAttr.get(c.attr);
    if (existing === undefined) {
      byAttr.set(c.attr, c.atom);
      continue;
    }
    const merged = intersectAtoms(existing, c.atom);
    if (merged) {
      byAttr.set(c.attr, merged);
    } else {
      // Can't express the combination as one atom — drop to opaque (soft
      // overlap still applies via `attributes`) rather than risk a false
      // hard conflict.
      byAttr.delete(c.attr);
      opaqueAttrs.add(c.attr);
      reliable = false;
    }
  }
  const constraints = [...byAttr.entries()].map(([attr, atom]) => ({
    attr,
    atom,
  }));

  return {
    constraints,
    modeledAttrs: new Set(constraints.map((c) => c.attr)),
    attributes: collectAttrs(expr),
    catchAll: expr.type === "and" && expr.children.length === 0,
    reliable,
    expr,
  };
}

function setHasValue(atom: InAtom | NotInAtom, value: string): boolean {
  // Insensitive atoms store lower-cased values (see parseAttrConstraint), so a
  // single Set lookup on the lower-cased probe suffices — no O(n) scan.
  return atom.values.has(atom.insensitive ? value.toLowerCase() : value);
}

function inSetsOverlap(a: InAtom, b: InAtom): boolean {
  const insensitive = a.insensitive || b.insensitive;
  // Probe the larger set with the smaller for O(min) lookups instead of O(n·m).
  const [small, large] = a.values.size <= b.values.size ? [a, b] : [b, a];
  // For an insensitive comparison the probed set must be lower-cased too; an
  // insensitive atom already is, a sensitive one (mixed comparison) is rebuilt.
  const largeSet =
    insensitive && !large.insensitive
      ? new Set([...large.values].map((v) => v.toLowerCase()))
      : large.values;
  for (const v of small.values) {
    const key = insensitive && !small.insensitive ? v.toLowerCase() : v;
    if (largeSet.has(key)) return true;
  }
  return false;
}

// Does `atom` match a concrete attribute value?
function atomMatchesValue(atom: Atom, value: string): boolean {
  switch (atom.op) {
    case "in":
      return setHasValue(atom, value);
    case "notIn":
      return !setHasValue(atom, value);
    case "num": {
      const n = Number(value);
      if (isNaN(n)) return false;
      if (atom.lo !== null && (atom.loInc ? n < atom.lo : n <= atom.lo))
        return false;
      if (atom.hi !== null && (atom.hiInc ? n > atom.hi : n >= atom.hi))
        return false;
      return true;
    }
    case "ver": {
      const v = paddedVersionString(value);
      if (
        atom.lo !== null &&
        (atom.loInc
          ? v < paddedVersionString(atom.lo)
          : v <= paddedVersionString(atom.lo))
      )
        return false;
      if (
        atom.hi !== null &&
        (atom.hiInc
          ? v > paddedVersionString(atom.hi)
          : v >= paddedVersionString(atom.hi))
      )
        return false;
      return true;
    }
  }
}

// True when a `notIn` rule above wholly contains a `notIn` target — it excludes
// only a subset of what the target excludes, so the target's population is
// entirely inside it (e.g. `country != US` covers `country not in [US, CA]`).
function notInCovers(consumer: Atom, target: Atom): boolean {
  if (consumer.op !== "notIn" || target.op !== "notIn") return false;
  for (const v of consumer.values) if (!setHasValue(target, v)) return false;
  return true;
}

// Do two ranges (same units) overlap? Bounds are compared with `cmp`; null = ±∞.
function rangesOverlap<T>(
  a: { lo: T | null; loInc: boolean; hi: T | null; hiInc: boolean },
  b: { lo: T | null; loInc: boolean; hi: T | null; hiInc: boolean },
  cmp: (x: T, y: T) => number,
): boolean {
  if (a.lo !== null && b.hi !== null) {
    const c = cmp(a.lo, b.hi);
    if (c > 0 || (c === 0 && !(a.loInc && b.hiInc))) return false;
  }
  if (b.lo !== null && a.hi !== null) {
    const c = cmp(b.lo, a.hi);
    if (c > 0 || (c === 0 && !(b.loInc && a.hiInc))) return false;
  }
  return true;
}

type RangeBounds<T> = {
  lo: T | null;
  loInc: boolean;
  hi: T | null;
  hiInc: boolean;
};

// True when every value matching `inner` also matches `outer` (interval containment).
function rangeContains<T>(
  outer: RangeBounds<T>,
  inner: RangeBounds<T>,
  cmp: (a: T, b: T) => number,
): boolean {
  return (
    lowerBoundLooserOrEqual(
      outer.lo,
      outer.loInc,
      inner.lo,
      inner.loInc,
      cmp,
    ) &&
    upperBoundLooserOrEqual(outer.hi, outer.hiInc, inner.hi, inner.hiInc, cmp)
  );
}

function lowerBoundLooserOrEqual<T>(
  outerLo: T | null,
  outerLoInc: boolean,
  innerLo: T | null,
  innerLoInc: boolean,
  cmp: (a: T, b: T) => number,
): boolean {
  if (outerLo === null) return true;
  if (innerLo === null) return false;
  const c = cmp(outerLo, innerLo);
  if (c < 0) return true;
  if (c > 0) return false;
  return outerLoInc || !innerLoInc;
}

function upperBoundLooserOrEqual<T>(
  outerHi: T | null,
  outerHiInc: boolean,
  innerHi: T | null,
  innerHiInc: boolean,
  cmp: (a: T, b: T) => number,
): boolean {
  if (outerHi === null) return true;
  if (innerHi === null) return false;
  const c = cmp(outerHi, innerHi);
  if (c > 0) return true;
  if (c < 0) return false;
  return outerHiInc || !innerHiInc;
}

function maxLowerBound<T>(
  a: RangeBounds<T>,
  b: RangeBounds<T>,
  cmp: (x: T, y: T) => number,
): { lo: T | null; loInc: boolean } {
  if (a.lo === null) return { lo: b.lo, loInc: b.loInc };
  if (b.lo === null) return { lo: a.lo, loInc: a.loInc };
  const c = cmp(a.lo, b.lo);
  if (c > 0) return { lo: a.lo, loInc: a.loInc };
  if (c < 0) return { lo: b.lo, loInc: b.loInc };
  return { lo: a.lo, loInc: a.loInc && b.loInc };
}

function minUpperBound<T>(
  a: RangeBounds<T>,
  b: RangeBounds<T>,
  cmp: (x: T, y: T) => number,
): { hi: T | null; hiInc: boolean } {
  if (a.hi === null) return { hi: b.hi, hiInc: b.hiInc };
  if (b.hi === null) return { hi: a.hi, hiInc: a.hiInc };
  const c = cmp(a.hi, b.hi);
  if (c < 0) return { hi: a.hi, hiInc: a.hiInc };
  if (c > 0) return { hi: b.hi, hiInc: b.hiInc };
  return { hi: a.hi, hiInc: a.hiInc && b.hiInc };
}

function rangeIntersection<T>(
  a: RangeBounds<T>,
  b: RangeBounds<T>,
  cmp: (x: T, y: T) => number,
): RangeBounds<T> | null {
  if (!rangesOverlap(a, b, cmp)) return null;
  const lo = maxLowerBound(a, b, cmp);
  const hi = minUpperBound(a, b, cmp);
  if (lo.lo !== null && hi.hi !== null) {
    const c = cmp(lo.lo, hi.hi);
    if (c > 0 || (c === 0 && !(lo.loInc && hi.hiInc))) return null;
  }
  return { lo: lo.lo, loInc: lo.loInc, hi: hi.hi, hiInc: hi.hiInc };
}

function isEmptyRange<T>(
  r: RangeBounds<T>,
  cmp: (a: T, b: T) => number,
): boolean {
  if (r.lo === null || r.hi === null) return false;
  const c = cmp(r.lo, r.hi);
  if (c > 0) return true;
  if (c < 0) return false;
  return !(r.loInc && r.hiInc);
}

// Points in `a` that are not in `b`.
function subtractRangeBFromA<T>(
  a: RangeBounds<T>,
  b: RangeBounds<T>,
  cmp: (x: T, y: T) => number,
): RangeBounds<T>[] {
  if (isEmptyRange(a, cmp)) return [];
  if (!rangesOverlap(a, b, cmp)) return [a];
  if (rangeContains(b, a, cmp)) return [];

  const result: RangeBounds<T>[] = [];

  if (b.lo !== null) {
    if (a.lo === null) {
      result.push({ lo: null, loInc: false, hi: b.lo, hiInc: !b.loInc });
    } else {
      const c = cmp(a.lo, b.lo);
      if (c < 0) {
        result.push({ lo: a.lo, loInc: a.loInc, hi: b.lo, hiInc: !b.loInc });
      } else if (c === 0 && a.loInc && !b.loInc) {
        result.push({ lo: a.lo, loInc: true, hi: a.lo, hiInc: true });
      }
    }
  }

  if (b.hi !== null) {
    if (a.hi === null) {
      result.push({ lo: b.hi, loInc: !b.hiInc, hi: null, hiInc: false });
    } else {
      const c = cmp(a.hi, b.hi);
      if (c > 0) {
        result.push({ lo: b.hi, loInc: !b.hiInc, hi: a.hi, hiInc: a.hiInc });
      } else if (c === 0 && a.hiInc && !b.hiInc) {
        result.push({ lo: a.hi, loInc: true, hi: a.hi, hiInc: true });
      }
    }
  }

  return result.filter((r) => !isEmptyRange(r, cmp));
}

function subtractUnionFromRange<T>(
  target: RangeBounds<T>,
  union: RangeBounds<T>[],
  cmp: (x: T, y: T) => number,
): RangeBounds<T>[] {
  let remaining: RangeBounds<T>[] = [target];
  for (const sub of union) {
    remaining = remaining.flatMap((r) => subtractRangeBFromA(r, sub, cmp));
  }
  return remaining;
}

// True when every value in `target` is covered by at least one interval in `union`.
function unionCoversTarget<T>(
  union: RangeBounds<T>[],
  target: RangeBounds<T>,
  cmp: (x: T, y: T) => number,
): boolean {
  const clipped = union
    .map((u) => rangeIntersection(u, target, cmp))
    .filter((r): r is RangeBounds<T> => r !== null);
  return subtractUnionFromRange(target, clipped, cmp).length === 0;
}

function formatNumRangeLabel(range: RangeBounds<number>): string {
  const parts: string[] = [];
  if (range.lo !== null) {
    parts.push(range.loInc ? `≥ ${range.lo}` : `> ${range.lo}`);
  }
  if (range.hi !== null) {
    parts.push(range.hiInc ? `≤ ${range.hi}` : `< ${range.hi}`);
  }
  return parts.join(", ");
}

function formatVerRangeLabel(range: RangeBounds<string>): string {
  const parts: string[] = [];
  if (range.lo !== null) {
    parts.push(range.loInc ? `≥ ${range.lo}` : `> ${range.lo}`);
  }
  if (range.hi !== null) {
    parts.push(range.hiInc ? `≤ ${range.hi}` : `< ${range.hi}`);
  }
  return parts.join(", ");
}

const versionCmp = (x: string, y: string) => {
  const px = paddedVersionString(x);
  const py = paddedVersionString(y);
  return px < py ? -1 : px > py ? 1 : 0;
};

function rangeHardConflicts<T extends number | string>(
  attr: string,
  targetBounds: RangeBounds<T>,
  singleAttr: {
    id: string;
    parsed: ParsedTargeting;
  }[],
  cmp: (a: T, b: T) => number,
  format: (range: RangeBounds<T>) => string,
  atomOp: "num" | "ver",
): { unreachable: boolean; conflicts: RuleHardConflict[] } {
  const portions: { id: string; portion: RangeBounds<T> }[] = [];
  let singleConsumerCoversTarget = false;

  for (const c of singleAttr) {
    const ca = c.parsed.constraints[0].atom;
    if (ca.op !== atomOp) continue;
    const consumerBounds: RangeBounds<T> = {
      lo: ca.lo as T | null,
      loInc: ca.loInc,
      hi: ca.hi as T | null,
      hiInc: ca.hiInc,
    };

    if (rangeContains(consumerBounds, targetBounds, cmp)) {
      singleConsumerCoversTarget = true;
      portions.push({ id: c.id, portion: targetBounds });
      continue;
    }

    const portion = rangeIntersection(consumerBounds, targetBounds, cmp);
    if (portion) portions.push({ id: c.id, portion });
  }

  if (portions.length === 0) {
    return { unreachable: false, conflicts: [] };
  }

  const conflicts: RuleHardConflict[] = portions.map(({ id, portion }) => ({
    consumingRuleId: id,
    attr,
    label: format(portion),
  }));

  return {
    unreachable:
      singleConsumerCoversTarget ||
      unionCoversTarget(
        portions.map((p) => p.portion),
        targetBounds,
        cmp,
      ),
    conflicts,
  };
}

// Can we *prove* two atoms target disjoint populations? Used for soft overlap:
// when we can't prove they're disjoint, a rule above might consume some of this
// rule's users. Unhandled combinations conservatively return false (might overlap).
function provablyDisjoint(a: Atom, b: Atom): boolean {
  if (a.op === "in" && b.op === "in") {
    return !inSetsOverlap(a, b);
  }
  if (a.op === "in" && b.op === "notIn") {
    return [...a.values].every((v) => setHasValue(b, v));
  }
  if (a.op === "notIn" && b.op === "in") {
    return [...b.values].every((v) => setHasValue(a, v));
  }
  if (a.op === "in") return ![...a.values].some((v) => atomMatchesValue(b, v));
  if (b.op === "in") return ![...b.values].some((v) => atomMatchesValue(a, v));
  if (a.op === "num" && b.op === "num") {
    return !rangesOverlap(a, b, (x, y) => x - y);
  }
  if (a.op === "ver" && b.op === "ver") {
    const cmp = (x: string, y: string) => {
      const px = paddedVersionString(x);
      const py = paddedVersionString(y);
      return px < py ? -1 : px > py ? 1 : 0;
    };
    return !rangesOverlap(a, b, cmp);
  }
  return false; // notIn/notIn, mismatched range types, … → can't prove disjoint
}

// Intersect two atoms on the same attribute into a single atom meaning "matches
// both". Returns null when the result can't be expressed as one atom of our
// types (not-in ∩ range, numeric ∩ version) — the caller then treats that
// attribute as opaque rather than risk reasoning about it imprecisely.
function intersectAtoms(x: Atom, y: Atom): Atom | null {
  // Put the `in` atom first when exactly one side is an `in`.
  const [a, b] = x.op === "in" || y.op !== "in" ? [x, y] : [y, x];

  if (a.op === "in") {
    // in ∩ b: keep a's values that also satisfy b.
    const insensitive =
      !!a.insensitive ||
      ((b.op === "in" || b.op === "notIn") && !!b.insensitive);
    const values = new Set<string>();
    for (const v of a.values) {
      if (atomMatchesValue(b, v)) values.add(insensitive ? v.toLowerCase() : v);
    }
    return { op: "in", values, ...(insensitive ? { insensitive: true } : {}) };
  }

  if (a.op === "notIn" && b.op === "notIn") {
    // not-in ∩ not-in excludes the union of both value sets.
    const insensitive = !!a.insensitive || !!b.insensitive;
    const values = new Set<string>();
    for (const v of a.values) values.add(insensitive ? v.toLowerCase() : v);
    for (const v of b.values) values.add(insensitive ? v.toLowerCase() : v);
    return {
      op: "notIn",
      values,
      ...(insensitive ? { insensitive: true } : {}),
    };
  }

  if (a.op === "num" && b.op === "num") {
    const r = rangeIntersection(a, b, (m, n) => m - n);
    // Empty intersection → matches nobody; an empty `in` set models that.
    return r
      ? { op: "num", lo: r.lo, loInc: r.loInc, hi: r.hi, hiInc: r.hiInc }
      : { op: "in", values: new Set() };
  }

  if (a.op === "ver" && b.op === "ver") {
    const r = rangeIntersection(a, b, versionCmp);
    return r
      ? { op: "ver", lo: r.lo, loInc: r.loInc, hi: r.hi, hiInc: r.hiInc }
      : { op: "in", values: new Set() };
  }

  // not-in ∩ num/ver, num ∩ ver → not representable as a single atom.
  return null;
}

// A rule whose modeled constraints fully describe exactly one attribute, so it
// consumes every user matching that attribute's atom.
function isReliableSingleAttr(p: ParsedTargeting): boolean {
  return p.reliable && p.constraints.length === 1;
}

type Consumer = { id: string; parsed: ParsedTargeting };

// Append to a Map of arrays, creating the array on first use.
function pushToBucket<K, T>(map: Map<K, T[]>, key: K, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// For one target atom, which values/ranges are served by single-attribute rules
// above, whether that fully covers the atom (`unreachable`), and whether any of
// the atom's attribute was consumed at all (`consumed`, → suppresses the soft
// warning for that attribute).
function analyzeConstraint(
  tc: { attr: string; atom: Atom },
  singleAttr: Consumer[],
): { unreachable: boolean; conflicts: RuleHardConflict[]; consumed: boolean } {
  const conflicts: RuleHardConflict[] = [];
  let unreachable = false;
  let consumed = false;

  // Concrete values worth naming. For an `in` target these are exactly the
  // values it lists, so we skip unioning consumer values — keeping this O(v)
  // instead of O(consumers·v) when many rules stack on one attribute. (A
  // case-insensitive `in` target can match a consumer value whose casing
  // differs, so it won't hard-consume it precisely and instead downgrades to a
  // soft overlap — fine, since insensitive matching is best-effort.) For an
  // open-ended (not-in) target we fold in consumer values to name the slice
  // they carve out — e.g. a `browser = chrome` force above consuming the chrome
  // users a `browser != firefox` rule wanted.
  const candidates = new Set<string>();
  if (tc.atom.op === "in") {
    tc.atom.values.forEach((v) => candidates.add(v));
  } else {
    for (const c of singleAttr) {
      const a = c.parsed.constraints[0].atom;
      if (a.op === "in") a.values.forEach((v) => candidates.add(v));
    }
  }

  // A candidate value is consumed when the target targets it AND a single-
  // attribute rule above also matches it.
  const consumedByRule = new Map<string, Set<string>>();
  const consumedValues = new Set<string>();
  for (const v of candidates) {
    if (!atomMatchesValue(tc.atom, v)) continue;
    const c = singleAttr.find((c) =>
      atomMatchesValue(c.parsed.constraints[0].atom, v),
    );
    if (c) {
      consumedValues.add(v);
      const set = consumedByRule.get(c.id) ?? new Set<string>();
      set.add(v);
      consumedByRule.set(c.id, set);
    }
  }
  if (consumedValues.size > 0) consumed = true;
  for (const [id, values] of consumedByRule) {
    conflicts.push({
      consumingRuleId: id,
      attr: tc.attr,
      label: [...values].join(", "),
    });
  }

  // Fully unreachable when every listed value is consumed (in-list), or when a
  // rule above covers an open-ended (not-in) or range target.
  if (tc.atom.op === "in") {
    if (
      tc.atom.values.size > 0 &&
      consumedValues.size === tc.atom.values.size
    ) {
      unreachable = true;
    }
  } else if (tc.atom.op === "notIn") {
    const cover = singleAttr.find((c) =>
      notInCovers(c.parsed.constraints[0].atom, tc.atom),
    );
    if (cover) {
      unreachable = true;
      consumed = true;
      conflicts.push({ consumingRuleId: cover.id, attr: tc.attr, label: null });
    }
  } else if (tc.atom.op === "num") {
    const { unreachable: rangeUnreachable, conflicts: rangeConflicts } =
      rangeHardConflicts(
        tc.attr,
        {
          lo: tc.atom.lo,
          loInc: tc.atom.loInc,
          hi: tc.atom.hi,
          hiInc: tc.atom.hiInc,
        },
        singleAttr,
        (a, b) => a - b,
        formatNumRangeLabel,
        "num",
      );
    if (rangeConflicts.length > 0) consumed = true;
    conflicts.push(...rangeConflicts);
    if (rangeUnreachable) unreachable = true;
  } else if (tc.atom.op === "ver") {
    const { unreachable: rangeUnreachable, conflicts: rangeConflicts } =
      rangeHardConflicts(
        tc.attr,
        {
          lo: tc.atom.lo,
          loInc: tc.atom.loInc,
          hi: tc.atom.hi,
          hiInc: tc.atom.hiInc,
        },
        singleAttr,
        versionCmp,
        formatVerRangeLabel,
        "ver",
      );
    if (rangeConflicts.length > 0) consumed = true;
    conflicts.push(...rangeConflicts);
    if (rangeUnreachable) unreachable = true;
  }

  return { unreachable, conflicts, consumed };
}

// Is the entire population matching `expr` served by the consumers above? Sound
// (never over-claims): an AND is consumed when *any* child is (its population is
// a subset of that child's); an OR only when *every* child is; NOT/opaque are
// never provably consumed. When consumed, `conflicts` explains why — the
// consuming rules for the child (AND) or every child (OR) that proves it — so a
// rule made unreachable through an OR/NOT shape the flat AND can't express still
// gets a "will not reach" detail instead of a bare, unexplained banner.
function exprFullyConsumed(
  e: Expr,
  consumersByAttr: Map<string, Consumer[]>,
): { consumed: boolean; conflicts: RuleHardConflict[] } {
  switch (e.type) {
    case "atom": {
      const { unreachable, conflicts } = analyzeConstraint(
        { attr: e.attr, atom: e.atom },
        consumersByAttr.get(e.attr) ?? [],
      );
      return unreachable
        ? { consumed: true, conflicts }
        : { consumed: false, conflicts: [] };
    }
    case "and": {
      // Subset of each child: consumed as soon as one child is, and that child's
      // conflicts are enough to explain it.
      for (const c of e.children) {
        const r = exprFullyConsumed(c, consumersByAttr);
        if (r.consumed) return r;
      }
      return { consumed: false, conflicts: [] };
    }
    case "or": {
      // Union of children: consumed only when every branch is, and we collect
      // the conflicts that cover each branch.
      if (e.children.length === 0) return { consumed: false, conflicts: [] };
      const conflicts: RuleHardConflict[] = [];
      for (const c of e.children) {
        const r = exprFullyConsumed(c, consumersByAttr);
        if (!r.consumed) return { consumed: false, conflicts: [] };
        conflicts.push(...r.conflicts);
      }
      return { consumed: true, conflicts };
    }
    case "not":
    case "opaque":
      return { consumed: false, conflicts: [] };
  }
}

// Does the rule serve any traffic at all? (A 0%-coverage rollout/experiment is
// active but consumes nobody, so it shouldn't trigger conflict warnings.)
function ruleConsumesTraffic(
  rule: FeatureRule,
  experimentsMap: Map<string, ExperimentInterfaceStringDates>,
): boolean {
  if (isRuleInactive(rule, experimentsMap)) return false;
  if (rule.type === "rollout") return rule.coverage > 0;
  if (rule.type === "experiment") return (rule.coverage ?? 1) > 0;
  return true;
}

// Does the rule serve 100% of the traffic it matches (fully consuming that
// population)? Mirrors the original "full coverage" definition: force rules and
// 100%-coverage rollouts. Experiments / safe-rollouts / experiment-refs are
// treated conservatively (not full) to avoid false "unreachable" flags.
function ruleConsumesAllMatched(
  rule: FeatureRule,
  experimentsMap: Map<string, ExperimentInterfaceStringDates>,
): boolean {
  if (isRuleInactive(rule, experimentsMap)) return false;
  const upcoming = getUpcomingScheduleRule(rule);
  if (upcoming && upcoming.timestamp) return false;
  return (
    rule.type === "force" || (rule.type === "rollout" && rule.coverage >= 1)
  );
}

// Does the rule serve some-but-not-all of the traffic it matches? An *untargeted*
// rule like this (a partial rollout) siphons a share of all traffic from rules
// below it — not enough to block them, but enough for a soft warning.
function ruleConsumesPartialTraffic(rule: FeatureRule): boolean {
  if (rule.type === "rollout") return rule.coverage > 0 && rule.coverage < 1;
  if (rule.type === "experiment") {
    const c = rule.coverage ?? 1;
    return c > 0 && c < 1;
  }
  return false;
}

// For each rule (in evaluation order), determine whether it's fully unreachable,
// which targeted sub-populations are precisely served above ("hard" conflicts),
// and which targeted attributes a rule above also touches but we can't fully
// reason about ("soft" conflicts). Conflicts are only reported on attributes the
// rule itself targets, so the common "force ON for admins, then roll out to
// everyone" pattern — where the rollout doesn't target the admin attribute — is
// not flagged.
export function getRuleReachability(
  rules: FeatureRule[],
  experimentsMap: Map<string, ExperimentInterfaceStringDates>,
  savedGroups: Map<string, SavedGroupForConflicts> = new Map(),
): Map<string, RuleReachability> {
  const result = new Map<string, RuleReachability>();
  // Incremental indices over the active rules seen so far, so each rule's
  // analysis scales with the rules it actually shares an attribute with rather
  // than re-scanning every rule above it (which would be O(R²) for R rules):
  //  - catchAllConsumerId: first full-coverage catch-all rule (consumes everyone)
  //  - consumersByAttr: full-coverage single-attribute consumers, by attribute —
  //    the only rules that can precisely hard-consume an atom
  //  - trafficByAttr: every traffic-serving rule above, by each attribute it
  //    references — drives soft overlap
  //  - siphonIds: untargeted partial rollouts/experiments that siphon all traffic
  let catchAllConsumerId: string | null = null;
  const consumersByAttr = new Map<string, Consumer[]>();
  const trafficByAttr = new Map<string, Consumer[]>();
  const siphonIds: string[] = [];

  for (const rule of rules) {
    if (isRuleInactive(rule, experimentsMap)) {
      result.set(rule.id, {
        unreachable: false,
        hardConflicts: [],
        softConflicts: [],
      });
      continue;
    }

    const target = parseRuleTargeting(rule, savedGroups);

    let unreachable = false;
    const hardConflicts: RuleHardConflict[] = [];
    const hardAttrs = new Set<string>();

    // A catch-all rule above consumes everyone.
    if (catchAllConsumerId !== null) {
      unreachable = true;
      hardConflicts.push({
        consumingRuleId: catchAllConsumerId,
        attr: null,
        label: null,
      });
    } else {
      // Precise per-attribute conflicts from the flat top-level AND of atoms.
      for (const tc of target.constraints) {
        const {
          unreachable: u,
          conflicts,
          consumed,
        } = analyzeConstraint(tc, consumersByAttr.get(tc.attr) ?? []);
        if (consumed) hardAttrs.add(tc.attr);
        hardConflicts.push(...conflicts);
        if (u) unreachable = true;
      }

      // Reachability for shapes the flat AND can't express — an OR across saved
      // groups, a negated group, … — by walking the full boolean tree. When it
      // fires we also surface the consuming rules so the banner explains itself
      // (deduped against any partial conflicts the flat pass already reported).
      if (!unreachable) {
        const tree = exprFullyConsumed(target.expr, consumersByAttr);
        if (tree.consumed) {
          unreachable = true;
          const seen = new Set(hardConflicts.map(hardConflictKey));
          for (const c of tree.conflicts) {
            const key = hardConflictKey(c);
            if (!seen.has(key)) {
              seen.add(key);
              hardConflicts.push(c);
            }
          }
        }
      }
    }

    // Soft conflicts. Two kinds, both "may not reach":
    //  - attribute overlap: a rule above also targets one of this rule's
    //    attributes, where we can't rule out overlap — one side targets it
    //    opaquely, or both target it but the rule above only partially consumes
    //    it (e.g. a `country = US` 90% rollout above a `country = US` rule).
    //    `attr` set.
    //  - traffic siphon: an untargeted partial rollout above takes a share of
    //    all traffic regardless of attributes. `attr` null.
    const softByAttr = new Map<string | null, string[]>();
    if (!unreachable) {
      for (const attr of target.attributes) {
        if (hardAttrs.has(attr)) continue;
        const targetOpaque = !target.modeledAttrs.has(attr);
        const targetAtom = target.constraints.find(
          (c) => c.attr === attr,
        )?.atom;
        // Only traffic-serving rules above that also reference this attribute
        // can overlap — every other rule is irrelevant, so we never scan them.
        for (const r of trafficByAttr.get(attr) ?? []) {
          const consumerOpaque = !r.parsed.modeledAttrs.has(attr);
          // Can't prove this rule above leaves our targeted users alone?
          let overlaps = targetOpaque || consumerOpaque;
          if (!overlaps && targetAtom) {
            const consumerAtom = r.parsed.constraints.find(
              (c) => c.attr === attr,
            )?.atom;
            overlaps =
              !!consumerAtom && !provablyDisjoint(targetAtom, consumerAtom);
          }
          if (overlaps) pushToBucket(softByAttr, attr, r.id);
        }
      }
      if (siphonIds.length > 0) softByAttr.set(null, [...siphonIds]);
    }
    const softConflicts: RuleSoftConflict[] = [...softByAttr.entries()].map(
      ([attr, consumingRuleIds]) => ({ attr, consumingRuleIds }),
    );

    result.set(rule.id, { unreachable, hardConflicts, softConflicts });

    // Fold this rule into the indices for the rules below it. `fullCoverage`
    // rules can hard-consume traffic; every traffic-serving rule counts toward
    // soft attribute overlap; untargeted partial rollouts siphon all traffic.
    const consumer: Consumer = { id: rule.id, parsed: target };
    if (ruleConsumesAllMatched(rule, experimentsMap)) {
      if (target.catchAll) {
        if (catchAllConsumerId === null) catchAllConsumerId = rule.id;
      } else if (isReliableSingleAttr(target)) {
        pushToBucket(consumersByAttr, target.constraints[0].attr, consumer);
      }
    }
    if (ruleConsumesTraffic(rule, experimentsMap)) {
      for (const attr of target.attributes) {
        pushToBucket(trafficByAttr, attr, consumer);
      }
    }
    if (target.catchAll && ruleConsumesPartialTraffic(rule)) {
      siphonIds.push(rule.id);
    }
  }

  return result;
}

// A rule's reachability in one (environment × project) cell.
export type ScopeCell = {
  env: string;
  project: string;
  reach: RuleReachability;
};

// Sentinel bucket for feature-reached projects no rule specifically scopes to
// (used when targeting all projects). Unscoped rules occupy it; never displayed.
export const OTHER_PROJECT_BUCKET = " other";

function ruleInProjectBucket(rule: FeatureRule, project: string): boolean {
  const scope = ruleProjectScope(rule); // null = all projects
  return scope === null || scope.includes(project);
}

// Per-rule reachability across (environment × project) cells. Partitioning by
// project drops a rule from cells it doesn't scope to, so it can't shadow or be
// shadowed across projects; a rule scoped to no project produces no cells.
export function getReachabilityCells(
  rulesByEnv: { env: string; rules: FeatureRule[] }[],
  projectBuckets: string[],
  experimentsMap: Map<string, ExperimentInterfaceStringDates>,
  savedGroups: Map<string, SavedGroupForConflicts> = new Map(),
): Map<string, ScopeCell[]> {
  const out = new Map<string, ScopeCell[]>();
  const buckets = projectBuckets.length ? projectBuckets : [""];
  for (const { env, rules } of rulesByEnv) {
    for (const project of buckets) {
      const cellRules = rules.filter((r) => ruleInProjectBucket(r, project));
      const reach = getRuleReachability(cellRules, experimentsMap, savedGroups);
      for (const [ruleId, r] of reach) {
        pushToBucket(out, ruleId, { env, project, reach: r });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conflict display (UI)
// ---------------------------------------------------------------------------

// Targeting conflicts resolved for display (rule ids → visible rule numbers).
export type RuleConflictInfo = {
  // Precise: a rule above fully serves these targeted values ("will not reach").
  hard: { ruleNumber?: number; attr: string | null; label: string | null }[];
  // Soft: a rule above also targets this attribute ("may not reach").
  soft: { attr: string | null; ruleNumbers: number[] }[];
};

// The single status a rule has in one environment, worst-first.
type ReachLevel = "unreachable" | "hard" | "soft" | "clean";
function reachLevel(r: RuleReachability): ReachLevel {
  if (r.unreachable) return "unreachable";
  if (r.hardConflicts.length > 0) return "hard";
  if (r.softConflicts.length > 0) return "soft";
  return "clean";
}

// Combine several environments' reachability into one display object, resolving
// consuming rule ids to visible rule numbers and de-duping across environments.
function mergeConflicts(
  reaches: RuleReachability[],
  ruleNumber: (consumingRuleId: string) => number | undefined,
): RuleConflictInfo {
  const hard = new Map<
    string,
    { ruleNumber?: number; attr: string | null; label: string | null }
  >();
  const softIds = new Map<string | null, Set<string>>();
  for (const reach of reaches) {
    for (const c of reach.hardConflicts) {
      const key = hardConflictKey(c);
      if (!hard.has(key)) {
        hard.set(key, {
          ruleNumber: ruleNumber(c.consumingRuleId),
          attr: c.attr,
          label: c.label,
        });
      }
    }
    for (const s of reach.softConflicts) {
      const ids = softIds.get(s.attr) ?? new Set<string>();
      s.consumingRuleIds.forEach((id) => ids.add(id));
      softIds.set(s.attr, ids);
    }
  }
  return {
    hard: [...hard.values()],
    soft: [...softIds.entries()].map(([attr, ids]) => ({
      attr,
      ruleNumbers: [...ids]
        .map(ruleNumber)
        .filter((n): n is number => n !== undefined)
        .sort((a, b) => a - b),
    })),
  };
}

// One conflict banner to render for a rule. In the all-environments view a rule
// can produce several — e.g. unreachable in production but only a soft conflict
// in dev — each covering the environments that share that status. `environments`
// is the list to name ([] = don't name them, e.g. the single-env view); when
// `allEnvironments` is set the banner spans every environment the rule applies
// to and is phrased "in all environments" instead.
export type ConflictBanner = {
  isUnreachable: boolean;
  conflicts: RuleConflictInfo;
  environments: string[];
  allEnvironments: boolean;
  // Project names this status is confined to (strict subset of delivery projects); empty otherwise.
  projects: string[];
  allProjects: boolean;
};

// Group a rule's per-environment reachability into banners — one per distinct
// status (unreachable / "will not reach" hard / "may not reach" soft), each
// listing the environments that share it. Environments with no conflict produce
// no banner. When `nameEnvironments` is false (single-env view) env names are
// omitted. Pass environments in the order they should be displayed.
export function buildConflictBanners(
  // One (environment × project) cell; `project` optional for env-only callers.
  perScope: { env: string; project?: string; reach: RuleReachability }[],
  ruleNumber: (consumingRuleId: string) => number | undefined,
  nameEnvironments: boolean,
  opts?: { multiProject?: boolean; projectLabel?: (id: string) => string },
): ConflictBanner[] {
  const multiProject = opts?.multiProject ?? false;
  const projectLabel = opts?.projectLabel ?? ((id: string) => id);
  const order: Exclude<ReachLevel, "clean">[] = ["unreachable", "hard", "soft"];
  const cellsByLevel = new Map<
    ReachLevel,
    { env: string; project?: string; reach: RuleReachability }[]
  >();
  for (const cell of perScope) {
    const level = reachLevel(cell.reach);
    if (level === "clean") continue;
    pushToBucket(cellsByLevel, level, cell);
  }
  // Distinct env/project footprint across all cells, so a full-footprint status reads "all" not a list.
  const envFootprint = new Set(perScope.map((c) => c.env));
  const projectFootprint = new Set(
    perScope
      .map((c) => c.project)
      .filter(
        (p): p is string => p !== undefined && p !== OTHER_PROJECT_BUCKET,
      ),
  );

  // "Unreachable" is reserved for a rule unreachable in EVERY cell it occupies;
  // if reachable anywhere, its unreachable cells are a partial conflict, not a kill.
  const fullyUnreachable =
    perScope.length > 0 && perScope.every((c) => c.reach.unreachable);

  const banners: ConflictBanner[] = [];
  for (const level of order) {
    const cells = cellsByLevel.get(level);
    if (!cells?.length) continue;
    const envs = [...new Set(cells.map((c) => c.env))];
    const projects = [
      ...new Set(
        cells.map((c) => c.project).filter((p): p is string => p !== undefined),
      ),
    ];
    const realProjects = projects.filter((p) => p !== OTHER_PROJECT_BUCKET);
    banners.push({
      isUnreachable: level === "unreachable" && fullyUnreachable,
      conflicts: mergeConflicts(
        cells.map((c) => c.reach),
        ruleNumber,
      ),
      environments: nameEnvironments ? envs : [],
      // "in all environments" reads better than listing them, but only when the
      // banner truly spans every env the rule applies to (and there's >1).
      allEnvironments:
        nameEnvironments &&
        envFootprint.size > 1 &&
        envs.length === envFootprint.size,
      // Name projects only for a strict subset of the feature's delivery projects.
      projects:
        multiProject && realProjects.length < projectFootprint.size
          ? realProjects.map(projectLabel)
          : [],
      allProjects:
        multiProject &&
        projectFootprint.size > 1 &&
        realProjects.length === projectFootprint.size,
    });
  }
  return banners;
}

function hardTargetingPhrase(attr: string, label: string): string {
  const trimmed = label.trim();
  if (/^[>≥<≤]/.test(trimmed) || /, [<≥]/.test(label)) {
    return `${attr} ${label}`;
  }
  if (label.includes(", ")) {
    return `${attr} is one of ${label}`;
  }
  return `${attr} is ${label}`;
}

function hardSentence(c: {
  ruleNumber?: number;
  attr: string | null;
  label: string | null;
}): string {
  const ref = c.ruleNumber ? `Rule ${c.ruleNumber}` : "An earlier rule";
  if (c.label === null) {
    return c.attr
      ? `${ref} already serves all traffic matching this rule's ${c.attr} targeting before it reaches this rule.`
      : `${ref} already serves all traffic before it reaches this rule.`;
  }
  if (c.attr) {
    return `${ref} already serves traffic where ${hardTargetingPhrase(c.attr, c.label)} before it reaches this rule.`;
  }
  return `${ref} already serves traffic matching "${c.label}" before it reaches this rule.`;
}

function softSentence(c: {
  attr: string | null;
  ruleNumbers: number[];
}): string {
  const nums = c.ruleNumbers.filter((n) => n > 0);
  const refs = nums.length
    ? nums.map((n) => `Rule ${n}`).join(", ")
    : "An earlier rule";
  // `attr` null → an untargeted partial rollout above siphons traffic.
  if (c.attr === null) {
    const verb = nums.length > 1 ? "serve" : "serves";
    return `${refs} ${verb} a share of all traffic before it reaches this rule, so some matching traffic may not reach it.`;
  }
  const verb = nums.length > 1 ? "target" : "targets";
  return `${refs} also ${verb} ${c.attr}, so some matching traffic may be served there first.`;
}

// Join environment names into a bolded, grammatical list ("a", "a and b",
// "a, b, and c").
function joinEnvNames(names: string[]): ReactElement {
  return (
    <>
      {names.map((name, i) => (
        <span key={name}>
          {i > 0 &&
            (i === names.length - 1
              ? names.length > 2
                ? ", and "
                : " and "
              : ", ")}
          <strong>{name}</strong>
        </span>
      ))}
    </>
  );
}

// The status badge for a rule's conflicts, mirroring the colour + icon of the
// callout it summarizes so the top-right pill and the detail banner can never
// disagree. Unreachable is the strongest tier (orange + the error/octagon icon);
// any lesser conflict ("will not reach" / "may not reach") is an amber warning.
// Returns null when the rule has no conflicts (no badge).
export type ConflictBadge = {
  color: RadixColor;
  icon: ReactElement;
  label: string;
  title: string;
};

export function getConflictBadge(
  banners: ConflictBanner[] | undefined,
): ConflictBadge | null {
  if (!banners?.length) return null;
  if (banners.some((b) => b.isUnreachable)) {
    return {
      // Sourced from the "attention" status so the badge and the
      // ConflictCallout always share the same orange + octagon icon.
      color: getRadixColor("attention"),
      icon: <RadixStatusIcon status="attention" size="sm" />,
      label: "Unreachable",
      title: "No matching traffic will reach this rule",
    };
  }
  return {
    color: "amber",
    icon: <RadixStatusIcon status="warning" size="sm" />,
    label: "Conflict",
    title: "Some matching traffic may not reach this rule",
  };
}

// Generic warning that some/all targeted traffic won't (or may not) reach this
// rule, with an expandable explanation of which rule(s) consume it. In the
// all-environments view `environments` / `allEnvironments` scope the banner to
// the environments that share this status.
export function ConflictCallout({
  isUnreachable,
  conflicts,
  environments = [],
  allEnvironments = false,
  projects = [],
  allProjects = false,
}: {
  isUnreachable: boolean;
  conflicts: RuleConflictInfo;
  environments?: string[];
  allEnvironments?: boolean;
  projects?: string[];
  allProjects?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const hasHard = conflicts.hard.length > 0;
  const hasSoft = conflicts.soft.length > 0;
  const base = isUnreachable
    ? "No matching traffic will reach this rule"
    : hasHard
      ? "Some matching traffic will not reach this rule"
      : "Some matching traffic may not reach this rule";
  const envSuffix = allEnvironments ? (
    <> in all environments</>
  ) : environments.length > 0 ? (
    <> in {joinEnvNames(environments)}</>
  ) : null;
  const projectSuffix =
    projects.length > 0 ? (
      <>
        {" "}
        for {projects.length === 1 ? "project" : "projects"}{" "}
        {joinEnvNames(projects)}
      </>
    ) : allProjects ? (
      <> for all projects</>
    ) : null;
  const headline = (
    <span>
      {base}
      {envSuffix}
      {projectSuffix}.
    </span>
  );
  const hasDetails = hasHard || hasSoft;
  // Unreachable uses the orange "attention" status (orange + the error octagon
  // icon + alert role) so the banner matches its status badge; lesser conflicts
  // stay amber "warning".
  const status = isUnreachable ? "attention" : "warning";
  return (
    <Callout status={status} size="sm">
      <Flex direction="column" gap="1">
        <Flex align="center" gap="2" wrap="wrap">
          {headline}
          {hasDetails && (
            <Link role="button" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide details" : "See details"}
            </Link>
          )}
        </Flex>
        {open && hasDetails && (
          <Flex mt="1" direction="column" gap="1">
            {conflicts.hard.map((c, i) => (
              <Text as="div" size="small" key={`h${i}`}>
                - {hardSentence(c)}
              </Text>
            ))}
            {conflicts.soft.map((c, i) => (
              <Text as="div" size="small" key={`s${i}`}>
                - {softSentence(c)}
              </Text>
            ))}
          </Flex>
        )}
      </Flex>
    </Callout>
  );
}
