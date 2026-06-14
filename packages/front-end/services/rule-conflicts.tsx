import { useState, type ReactElement } from "react";
import { Flex } from "@radix-ui/themes";
import { FeatureRule } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { extractConditionAttributeKeys } from "shared/util";
import { paddedVersionString } from "@growthbook/growthbook";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { getUpcomingScheduleRule } from "@/services/scheduleRules";
import { isRuleInactive } from "@/services/features";

// ---------------------------------------------------------------------------
// Rule reachability & conflict detection
//
// We model a rule's targeting as an AND of per-attribute "atoms" (in / not-in
// value sets, numeric ranges, version ranges). Operators we can't model
// precisely (regex, $exists, saved groups, nested $or, …) produce no atom, but
// the attributes they reference are still tracked so we can surface a *soft*
// "may not reach" warning when a rule above targets the same attribute.
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
  // Precisely-modeled AND constraints (one atom per attribute).
  constraints: { attr: string; atom: Atom }[];
  // Attributes that have a modeled atom.
  modeledAttrs: Set<string>;
  // Every attribute the rule targets, including ones referenced only opaquely
  // (regex, $exists, saved groups, nested $or, …). Used for soft overlap.
  attributes: Set<string>;
  // True when the rule targets everyone (no condition / groups / prerequisites).
  catchAll: boolean;
  // True when `constraints` completely represent the targeting (no opaque parts),
  // so a single-attribute rule can be treated as fully consuming its match.
  reliable: boolean;
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
    const values = new Set<string>();
    let insensitive = false;
    for (const k of keys) {
      if (Array.isArray(ops[k])) {
        if (k === "$ini") insensitive = true;
        (ops[k] as unknown[]).forEach((v) => {
          const str = String(v);
          values.add(k === "$ini" ? str.toLowerCase() : str);
        });
      }
    }
    return { op: "in", values, ...(insensitive ? { insensitive: true } : {}) };
  }
  if (keys.every((k) => k === "$ne" || k === "$nin" || k === "$nini")) {
    const values = new Set<string>();
    let insensitive = false;
    for (const k of keys) {
      if (k === "$ne") values.add(String(ops[k]));
      else if (Array.isArray(ops[k])) {
        if (k === "$nini") insensitive = true;
        (ops[k] as unknown[]).forEach((v) => {
          const str = String(v);
          values.add(k === "$nini" ? str.toLowerCase() : str);
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

function parseConditionObject(obj: Record<string, unknown>): {
  constraints: { attr: string; atom: Atom }[];
  reliable: boolean;
} {
  const constraints: { attr: string; atom: Atom }[] = [];
  let reliable = true;

  for (const [key, value] of Object.entries(obj)) {
    // A top-level $and flattens into more AND constraints; anything else
    // ($or, $nor, $not, …) can't be represented as a flat AND of atoms.
    if (key.startsWith("$")) {
      if (key === "$and" && Array.isArray(value)) {
        for (const sub of value) {
          if (sub && typeof sub === "object" && !Array.isArray(sub)) {
            const parsed = parseConditionObject(sub as Record<string, unknown>);
            constraints.push(...parsed.constraints);
            reliable = reliable && parsed.reliable;
          } else {
            reliable = false;
          }
        }
      } else {
        reliable = false;
      }
      continue;
    }

    const atom = parseAttrConstraint(value);
    if (atom) constraints.push({ attr: key, atom });
    else reliable = false;
  }

  return { constraints, reliable };
}

function parseRuleTargeting(
  rule: FeatureRule,
  savedGroupAttributes: Map<string, string[]>,
): ParsedTargeting {
  let constraints: { attr: string; atom: Atom }[] = [];
  let reliable = true;
  let condObj: Record<string, unknown> | null = null;

  if (rule.condition && rule.condition !== "{}") {
    try {
      const obj: unknown = JSON.parse(rule.condition);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        condObj = obj as Record<string, unknown>;
        const parsed = parseConditionObject(condObj);
        constraints = parsed.constraints;
        reliable = parsed.reliable;
      } else {
        reliable = false;
      }
    } catch {
      reliable = false;
    }
  }

  // All targeted attributes, including those referenced only opaquely.
  const attributes = new Set<string>(
    condObj ? extractConditionAttributeKeys(condObj) : [],
  );
  for (const sg of rule.savedGroups ?? []) {
    reliable = false; // saved groups aren't modeled as atoms
    for (const id of sg.ids) {
      (savedGroupAttributes.get(id) ?? []).forEach((a) => attributes.add(a));
    }
  }
  if (rule.prerequisites?.length) reliable = false;

  const catchAll =
    attributes.size === 0 &&
    !rule.savedGroups?.length &&
    !rule.prerequisites?.length;

  return {
    constraints,
    modeledAttrs: new Set(constraints.map((c) => c.attr)),
    attributes,
    catchAll,
    reliable,
  };
}

function setHasValue(atom: InAtom | NotInAtom, value: string): boolean {
  if (atom.insensitive) {
    const lv = value.toLowerCase();
    return [...atom.values].some((v) => v.toLowerCase() === lv);
  }
  return atom.values.has(value);
}

function inSetsOverlap(a: InAtom, b: InAtom): boolean {
  for (const va of a.values) {
    for (const vb of b.values) {
      if (a.insensitive || b.insensitive) {
        if (va.toLowerCase() === vb.toLowerCase()) return true;
      } else if (va === vb) return true;
    }
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
      return {
        unreachable: true,
        conflicts: [
          {
            consumingRuleId: c.id,
            attr,
            label: format(targetBounds),
          },
        ],
      };
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
    unreachable: unionCoversTarget(
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

// A rule whose modeled constraints fully describe exactly one attribute, so it
// consumes every user matching that attribute's atom.
function isReliableSingleAttr(p: ParsedTargeting): boolean {
  return p.reliable && p.constraints.length === 1;
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
  savedGroupAttributes: Map<string, string[]> = new Map(),
): Map<string, RuleReachability> {
  const result = new Map<string, RuleReachability>();
  // Active rules seen so far. `fullCoverage` rules can hard-consume traffic; all
  // of them count toward soft attribute overlap; `partialCatchAll` rules siphon
  // a share of all traffic regardless of attributes.
  const rulesAbove: {
    id: string;
    parsed: ParsedTargeting;
    fullCoverage: boolean;
    partialCatchAll: boolean;
    consumesTraffic: boolean;
  }[] = [];

  for (const rule of rules) {
    if (isRuleInactive(rule, experimentsMap)) {
      result.set(rule.id, {
        unreachable: false,
        hardConflicts: [],
        softConflicts: [],
      });
      continue;
    }

    const target = parseRuleTargeting(rule, savedGroupAttributes);
    const consumers = rulesAbove.filter((r) => r.fullCoverage);

    let unreachable = false;
    const hardConflicts: RuleHardConflict[] = [];
    const hardAttrs = new Set<string>();

    // A catch-all rule above consumes everyone.
    const catchAll = consumers.find((c) => c.parsed.catchAll);
    if (catchAll) {
      unreachable = true;
      hardConflicts.push({
        consumingRuleId: catchAll.id,
        attr: null,
        label: null,
      });
    } else {
      for (const tc of target.constraints) {
        const singleAttr = consumers.filter(
          (c) =>
            isReliableSingleAttr(c.parsed) &&
            c.parsed.constraints[0].attr === tc.attr,
        );

        // Concrete values worth naming: the values the target lists, plus the
        // values single-attribute rules above list. The latter lets us name the
        // slice a rule above carves out of an open-ended target — e.g. a
        // `browser = chrome` force above consumes the chrome users a
        // `browser != firefox` rule wanted.
        const candidates = new Set<string>();
        if (tc.atom.op === "in")
          tc.atom.values.forEach((v) => candidates.add(v));
        for (const c of singleAttr) {
          const a = c.parsed.constraints[0].atom;
          if (a.op === "in") a.values.forEach((v) => candidates.add(v));
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
        if (consumedValues.size > 0) hardAttrs.add(tc.attr);
        for (const [id, values] of consumedByRule) {
          hardConflicts.push({
            consumingRuleId: id,
            attr: tc.attr,
            label: [...values].join(", "),
          });
        }

        // Fully unreachable when every listed value is consumed (in-list), or
        // when a rule above covers an open-ended (not-in) or range target.
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
            hardAttrs.add(tc.attr);
            hardConflicts.push({
              consumingRuleId: cover.id,
              attr: tc.attr,
              label: null,
            });
          }
        } else if (tc.atom.op === "num") {
          const { unreachable: rangeUnreachable, conflicts } =
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
          if (conflicts.length > 0) hardAttrs.add(tc.attr);
          hardConflicts.push(...conflicts);
          if (rangeUnreachable) unreachable = true;
        } else if (tc.atom.op === "ver") {
          const { unreachable: rangeUnreachable, conflicts } =
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
          if (conflicts.length > 0) hardAttrs.add(tc.attr);
          hardConflicts.push(...conflicts);
          if (rangeUnreachable) unreachable = true;
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
        for (const r of rulesAbove) {
          if (!r.consumesTraffic) continue;
          if (!r.parsed.attributes.has(attr)) continue;
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
          if (overlaps) {
            const ids = softByAttr.get(attr) ?? [];
            if (!ids.includes(r.id)) ids.push(r.id);
            softByAttr.set(attr, ids);
          }
        }
      }
      const siphons = rulesAbove
        .filter((r) => r.partialCatchAll)
        .map((r) => r.id);
      if (siphons.length > 0) softByAttr.set(null, siphons);
    }
    const softConflicts: RuleSoftConflict[] = [...softByAttr.entries()].map(
      ([attr, consumingRuleIds]) => ({ attr, consumingRuleIds }),
    );

    result.set(rule.id, { unreachable, hardConflicts, softConflicts });

    rulesAbove.push({
      id: rule.id,
      parsed: target,
      fullCoverage: ruleConsumesAllMatched(rule, experimentsMap),
      partialCatchAll: target.catchAll && ruleConsumesPartialTraffic(rule),
      consumesTraffic: ruleConsumesTraffic(rule, experimentsMap),
    });
  }

  return result;
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

// Generic warning that some/all targeted traffic won't (or may not) reach this
// rule, with an expandable explanation of which rule(s) consume it.
export function ConflictCallout({
  isUnreachable,
  conflicts,
}: {
  isUnreachable: boolean;
  conflicts: RuleConflictInfo;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const hasHard = conflicts.hard.length > 0;
  const hasSoft = conflicts.soft.length > 0;
  const headline = isUnreachable
    ? "No matching traffic will reach this rule."
    : hasHard
      ? "Some matching traffic will not reach this rule."
      : "Some matching traffic may not reach this rule.";
  const hasDetails = hasHard || hasSoft;
  const status = isUnreachable ? "error" : "warning";
  return (
    <Callout status={status} size="sm" contentsAs="div">
      <Flex direction="column" gap="1">
        <Flex align="center" gap="2" wrap="wrap">
          <span>{headline}</span>
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
