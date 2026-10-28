/* eslint-disable @typescript-eslint/no-explicit-any */

import { SavedGroupsPayload } from "./types/growthbook";
import { REMOTE_GROUP_IDS_ATTRIBUTE } from "./remoteSavedGroups";
import {
  ConditionInterface,
  SavedGroupReference,
  TestedObj,
  ConditionValue,
  EvalConditionOptions,
  Operator,
  OperatorConditionValue,
  TypeMismatchCallback,
  VarType,
} from "./types/mongrule";
import { getPath, hasOwn, paddedVersionString } from "./util";

const _regexCache: { [key: string]: RegExp } = {};

// true or false, or null when the result depends on an operator or saved group
// type this SDK doesn't support. Exported functions treat null as failing.
type Result = boolean | null;
const not = (r: Result): Result => (r === null ? null : !r);

// Keys a condition can have that aren't attributes, besides $not, which is
// also an operator on a value
const CONDITION_OPERATORS = ["$or", "$nor", "$and", "$savedGroup"];

type EvalConditionContext = {
  savedGroups: SavedGroupsPayload;
  /** Group ids already being resolved, to stop cycles */
  visited: Set<string>;
  typeMismatch?: { onTypeMismatch: TypeMismatchCallback; path: string };
};

// The top-level condition evaluation function
export function evalCondition(
  obj: TestedObj,
  condition: ConditionInterface,
  options: EvalConditionOptions = {},
): boolean {
  const { savedGroups, onTypeMismatch } = options;
  return (
    evalConditionWithContext(obj, condition, {
      savedGroups: savedGroups || {},
      visited: new Set(),
      typeMismatch: onTypeMismatch ? { onTypeMismatch, path: "" } : undefined,
    }) === true
  );
}

// Condition is an object, keys are either specific operators or object paths
// values are either arguments for operators or conditions for paths
function evalConditionWithContext(
  obj: TestedObj,
  condition: ConditionInterface,
  ctx: EvalConditionContext,
): Result {
  let result: Result = true;
  for (const [k, v] of Object.entries(condition)) {
    let r: Result;
    switch (k) {
      case "$or":
        r = evalOr(obj, v as ConditionInterface[], ctx);
        break;
      case "$nor":
        r = not(evalOr(obj, v as ConditionInterface[], ctx));
        break;
      case "$and":
        r = evalAnd(obj, v as ConditionInterface[], ctx);
        break;
      case "$not":
        r = not(evalConditionWithContext(obj, v as ConditionInterface, ctx));
        break;
      case "$savedGroup":
        r = evalSavedGroup(obj, v, ctx) as Result;
        break;
      default:
        r = evalConditionValue(v, getPath(obj, k), withPath(ctx, k));
    }
    // One failing entry decides it, wherever an unsupported one is
    if (r === false) return false;
    if (r === null) result = null;
  }
  return result;
}

// Partially evaluate a condition when only some attributes are known, e.g. on
// a server. Attributes missing from `obj` are unknown. Returns a boolean once
// the result can't depend on them, otherwise the condition minus every branch
// that is already decided.
export function pruneCondition(
  obj: TestedObj,
  condition: ConditionInterface,
  savedGroups?: SavedGroupsPayload,
): ConditionInterface | boolean {
  return pruneWithContext(obj, condition, {
    savedGroups: savedGroups || {},
    visited: new Set(),
  });
}

// Prune the saved group a reference points to. Returns its result once decided,
// otherwise its condition minus every branch that is already decided.
export function pruneSavedGroup(
  obj: TestedObj,
  reference: unknown,
  savedGroups: SavedGroupsPayload,
): Result | ConditionInterface {
  return evalSavedGroup(
    obj,
    reference,
    { savedGroups, visited: new Set() },
    pruneWithContext,
  );
}

function pruneWithContext(
  obj: TestedObj,
  condition: ConditionInterface,
  ctx: EvalConditionContext,
): ConditionInterface | boolean {
  // One that throws, such as a malformed one, stays as written. Evaluating it
  // fails as a whole, so no part of it can be decided.
  try {
    return pruneEntries(obj, condition, ctx);
  } catch (e) {
    return condition;
  }
}

function pruneEntries(
  obj: TestedObj,
  condition: ConditionInterface,
  ctx: EvalConditionContext,
): ConditionInterface | boolean {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(condition)) {
    let r: any;
    switch (k) {
      case "$or":
      case "$nor":
      case "$and":
        r = pruneList(obj, v as ConditionInterface[], ctx, k !== "$and");
        break;
      case "$not":
        r = pruneEntries(obj, v as ConditionInterface, ctx);
        break;
      case "$savedGroup":
        r = evalSavedGroup(obj, v, ctx, pruneEntries);
        // Keep an undecided reference as is rather than inlining the group
        if (typeof r !== "boolean") r = null;
        break;
      default:
        // null when the attribute is unknown, or the value uses an operator
        // this SDK doesn't support, which the client's SDK may
        r = isKnown(obj, k)
          ? evalConditionValue(v, getPath(obj, k), ctx)
          : null;
    }
    // $not and $nor pass when what they hold fails
    if ((k === "$not" || k === "$nor") && typeof r === "boolean") r = !r;

    // One failing entry fails the whole condition, and a passing one is dropped
    if (r === false) return false;
    // null is an undecided leaf, which stays as written
    if (r === null) out[k] = v;
    else if (r !== true) out[k] = r;
  }
  return Object.keys(out).length ? out : true;
}

// Prune an $or (or an $and) list. Returns the conditions still undecided, or
// the list's result once there are none.
function pruneList(
  obj: TestedObj,
  conditions: ConditionInterface[],
  ctx: EvalConditionContext,
  or: boolean,
): ConditionInterface[] | boolean {
  const out: ConditionInterface[] = [];
  for (const condition of conditions) {
    const r = pruneEntries(obj, condition, ctx);
    // One passing condition decides an $or, and one failing condition an $and
    if (or && r === true) return true;
    if (!or && r === false) return false;
    if (typeof r !== "boolean") out.push(r);
  }
  if (out.length) return out;
  // Every condition failed an $or, or passed an $and. Like evalOr, an empty
  // $or passes.
  return or ? !conditions.length : true;
}

// A nested path is unknown, since the server may only have part of the object
function isKnown(obj: TestedObj, path: string) {
  return !path.includes(".") && hasOwn(obj, path);
}

function withPath(
  ctx: EvalConditionContext,
  key: string,
): EvalConditionContext {
  if (!ctx.typeMismatch) return ctx;
  const { path } = ctx.typeMismatch;
  return {
    ...ctx,
    typeMismatch: {
      ...ctx.typeMismatch,
      path: path ? `${path}.${key}` : key,
    },
  };
}

/** Resolves a `$savedGroup` reference. Anything unrecognized matches nobody. */
function evalSavedGroup(
  obj: TestedObj,
  reference: unknown,
  ctx: EvalConditionContext,
  // A pruning function, to return null or a condition while unknown attributes
  // decide the result. Passed in so that builds that never prune leave it out.
  prune?: typeof pruneEntries,
): Result | ConditionInterface {
  if (!reference || typeof reference !== "object" || Array.isArray(reference))
    return false;

  const { id, attributeKey } = reference as SavedGroupReference;
  if (typeof id !== "string" || ctx.visited.has(id)) return false;
  // Falling back to the entry's attribute would check a different population
  if (attributeKey !== undefined && typeof attributeKey !== "string")
    return false;

  const entry = ctx.savedGroups[id];
  // Absent, or a v1 bare array
  if (!entry || Array.isArray(entry) || typeof entry !== "object") return false;

  if (entry.type === "list") {
    // The override wins over the entry's own attribute
    const key = attributeKey ?? entry.attributeKey;
    if (typeof key !== "string") return false;
    if (!Array.isArray(entry.values)) return false;
    if (prune && !isKnown(obj, key)) return null;
    return checkIn(
      getPath(obj, key),
      entry.values,
      false,
      "$savedGroup",
      withPath(ctx, key),
    );
  }

  if (entry.type === "remote") {
    // Another attribute needs a derived group, which isn't supported yet
    if (attributeKey !== undefined && attributeKey !== entry.attributeKey)
      return false;
    if (prune && !isKnown(obj, REMOTE_GROUP_IDS_ATTRIBUTE)) return null;
    const groupIds = getPath(obj, REMOTE_GROUP_IDS_ATTRIBUTE);
    return Array.isArray(groupIds) && groupIds.includes(id);
  }

  if (entry.type === "condition") {
    // A condition group has no single attribute, so any override is ignored
    if (!entry.condition || typeof entry.condition !== "object") return false;
    // A copy, so sibling groups don't see each other's ids
    return (prune || evalConditionWithContext)(obj, entry.condition, {
      ...ctx,
      visited: new Set(ctx.visited).add(id),
    });
  }

  // A group type added after this SDK was built. The client SDK may support it.
  return null;
}

// Transform a regex string into a real RegExp object
function getRegex(regex: string, insensitive = false): RegExp {
  const cacheKey = `${regex}${insensitive ? "/i" : ""}`;
  if (!_regexCache[cacheKey]) {
    _regexCache[cacheKey] = new RegExp(
      regex.replace(/([^\\])\//g, "$1\\/"),
      insensitive ? "i" : undefined,
    );
  }
  return _regexCache[cacheKey];
}

// Evaluate a single value against a condition
function evalConditionValue(
  condition: ConditionValue,
  value: any,
  ctx: EvalConditionContext,
  insensitive: boolean = false,
): Result {
  // Simple equality comparisons
  if (
    typeof condition === "string" ||
    typeof condition === "number" ||
    typeof condition === "boolean"
  ) {
    if (typeof value !== typeof condition) {
      reportMismatch(ctx, "$eq", condition, value);
      return false;
    }
    if (insensitive && typeof condition === "string") {
      return value.toLowerCase() === condition.toLowerCase();
    }
    return value === condition;
  }

  if (condition === null) {
    return value === null;
  }

  if (Array.isArray(condition) || !isOperatorObject(condition)) {
    if (getType(value) !== getType(condition)) {
      reportMismatch(ctx, "$eq", condition, value);
      return false;
    }
    return JSON.stringify(value) === JSON.stringify(condition);
  }

  // This is a special operator condition and we should evaluate each one separately
  let result: Result = true;
  for (const op in condition) {
    const r = evalOperatorCondition(
      op as Operator,
      value,
      condition[op as keyof OperatorConditionValue],
      ctx,
    );
    if (r === false) return false;
    if (r === null) result = null;
  }
  return result;
}

// If the object has only keys that start with '$'
// An empty object has no operators, so it passes
function isOperatorObject(obj: any): boolean {
  return !Array.isArray(obj) && Object.keys(obj).every((k) => k[0] === "$");
}

// Return the data type of a value
function getType(v: any): VarType | "unknown" {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (["string", "number", "boolean", "object", "undefined"].includes(t)) {
    return t as VarType;
  }
  return "unknown";
}

function reportMismatch(
  ctx: EvalConditionContext,
  operator: string,
  expected: unknown,
  actual: unknown,
) {
  if (!ctx.typeMismatch) return;
  const { onTypeMismatch, path } = ctx.typeMismatch;
  onTypeMismatch({ path, operator, expected, actual });
}

function isOrderable(actual: unknown, expected: unknown): boolean {
  const t = typeof actual;
  return (t === "number" || t === "string") && t === typeof expected;
}

// At least one element of actual must match the expected condition/value
function elemMatch(
  actual: any,
  expected: any,
  ctx: EvalConditionContext,
): Result {
  if (!Array.isArray(actual)) {
    reportMismatch(ctx, "$elemMatch", expected, actual);
    return false;
  }
  // Operators test each element itself. A condition, including one that only
  // uses $or, $and, $nor, or $savedGroup, tests each element's fields.
  const check =
    isOperatorObject(expected) &&
    !Object.keys(expected).some((k) => CONDITION_OPERATORS.includes(k))
      ? (v: any) => evalConditionValue(expected, v, ctx)
      : (v: any) => evalConditionWithContext(v, expected, ctx);
  let result: Result = false;
  for (let i = 0; i < actual.length; i++) {
    // Only skip nullish elements; falsy values like 0, "" and false are valid
    // array members and must still be tested against the condition.
    if ((actual[i] ?? null) === null) continue;
    const r = check(actual[i]);
    if (r === true) return true;
    if (r === null) result = null;
  }
  return result;
}

export function isIn(
  actual: any,
  expected: Array<any>,
  insensitive: boolean = false,
): boolean {
  if (insensitive) {
    const caseFold = (val: any) =>
      typeof val === "string" ? val.toLowerCase() : val;
    // Do an intersection if attribute is an array (insensitive)
    if (Array.isArray(actual)) {
      return actual.some((el) =>
        expected.some((exp) => caseFold(el) === caseFold(exp)),
      );
    }
    return expected.some((exp) => caseFold(actual) === caseFold(exp));
  }
  // Do an intersection if attribute is an array
  if (Array.isArray(actual)) {
    return actual.some((el) => expected.includes(el));
  }
  return expected.includes(actual);
}

// Types are only checked after a miss, so large saved groups aren't scanned twice
function checkIn(
  actual: unknown,
  expected: unknown[],
  insensitive: boolean,
  operator: string,
  ctx: EvalConditionContext,
): boolean {
  const matched = isIn(actual, expected, insensitive);
  // An empty list has no types to compare against
  if (!matched && ctx.typeMismatch && expected.length > 0) {
    const types = new Set(expected.map(getType));
    const values = Array.isArray(actual) ? actual : [actual];
    for (const v of values) {
      if (!types.has(getType(v))) {
        reportMismatch(ctx, operator, expected, actual);
        break;
      }
    }
  }
  return matched;
}

/**
 * Gets the array of values from a saved group. This can either be the legacy bare array
 * format, or it can pull the array from the v2 "type: list" format.
 */
function getSavedGroupArrayValues(
  entry: SavedGroupsPayload[string] | undefined,
): Array<string | number> | null {
  // An unknown id has always behaved like an empty list. A malformed entry
  // has not, and must not: $notInGroup would pass everyone.
  if (entry === undefined) return [];

  if (Array.isArray(entry)) return entry;

  // These operators take their attribute from the condition they sit on
  if (entry && typeof entry === "object" && entry.type === "list") {
    return Array.isArray(entry.values) ? entry.values : null;
  }

  // A condition group, a malformed entry, or an unknown type
  return null;
}

// A saved group type added after this SDK was built
function isNewGroupType(entry: SavedGroupsPayload[string] | undefined) {
  return (
    !!entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    entry.type !== "list" &&
    entry.type !== "condition"
  );
}

function isInAll(
  actual: unknown[],
  expected: ConditionValue[],
  ctx: EvalConditionContext,
  insensitive: boolean = false,
): Result {
  let result: Result = true;
  for (let i = 0; i < expected.length; i++) {
    let passed: Result = false;
    for (let j = 0; j < actual.length; j++) {
      const r = evalConditionValue(expected[i], actual[j], ctx, insensitive);
      if (r === true) {
        passed = true;
        break;
      }
      if (r === null) passed = null;
    }
    if (passed === false) return false;
    if (passed === null) result = null;
  }
  return result;
}

// Evaluate a single operator condition
function evalOperatorCondition(
  operator: Operator,
  actual: any,
  expected: any,
  ctx: EvalConditionContext,
): Result {
  switch (operator) {
    case "$veq":
    case "$vne":
    case "$vgt":
    case "$vgte":
    case "$vlt":
    case "$vlte":
      return evalVersion(operator, actual, expected, ctx);
    case "$eq":
    case "$ne": {
      if (ctx.typeMismatch && getType(actual) !== getType(expected)) {
        reportMismatch(ctx, operator, expected, actual);
      }
      const equal = actual === expected;
      return operator === "$eq" ? equal : !equal;
    }
    case "$lt":
    case "$lte":
    case "$gt":
    case "$gte":
      if (!isOrderable(actual, expected)) {
        reportMismatch(ctx, operator, expected, actual);
        return false;
      }
      if (operator === "$lt") return actual < expected;
      if (operator === "$lte") return actual <= expected;
      if (operator === "$gt") return actual > expected;
      return actual >= expected;
    case "$exists":
      // Using `!=` and `==` instead of strict checks so it also matches for undefined
      return expected ? actual != null : actual == null;
    case "$in":
      if (!Array.isArray(expected)) return false;
      return checkIn(actual, expected, false, operator, ctx);
    case "$ini":
      if (!Array.isArray(expected)) return false;
      return checkIn(actual, expected, true, operator, ctx);
    case "$inGroup": {
      if (isNewGroupType(ctx.savedGroups[expected])) return null;
      const values = getSavedGroupArrayValues(ctx.savedGroups[expected]);
      return values === null
        ? false
        : checkIn(actual, values, false, operator, ctx);
    }
    case "$notInGroup": {
      if (isNewGroupType(ctx.savedGroups[expected])) return null;
      // No values means matching nobody. An empty list would pass everyone.
      const values = getSavedGroupArrayValues(ctx.savedGroups[expected]);
      return values === null
        ? false
        : !checkIn(actual, values, false, operator, ctx);
    }
    case "$nin":
      if (!Array.isArray(expected)) return false;
      return !checkIn(actual, expected, false, operator, ctx);
    case "$nini":
      if (!Array.isArray(expected)) return false;
      return !checkIn(actual, expected, true, operator, ctx);
    case "$not":
      return not(evalConditionValue(expected, actual, ctx));
    case "$size":
      if (!Array.isArray(actual)) {
        reportMismatch(ctx, operator, expected, actual);
        return false;
      }
      return evalConditionValue(expected, actual.length, ctx);
    case "$elemMatch":
      return elemMatch(actual, expected, ctx);
    case "$all":
    case "$alli":
      if (!Array.isArray(expected)) return false;
      if (!Array.isArray(actual)) {
        reportMismatch(ctx, operator, expected, actual);
        return false;
      }
      return isInAll(actual, expected, ctx, operator === "$alli");
    case "$regex":
    case "$regexi":
      if (typeof actual !== "string") {
        reportMismatch(ctx, operator, expected, actual);
        return false;
      }
      try {
        return getRegex(expected, operator === "$regexi").test(actual);
      } catch (e) {
        return false;
      }
    case "$type":
      return getType(actual) === expected;
    default:
      // Keys this SDK knows, but on a condition rather than on a value, where
      // they never match
      if (CONDITION_OPERATORS.includes(operator)) return false;
      console.error("Unknown operator: " + operator);
      return null;
  }
}

// $vne is the opposite of $veq, so it matches on a type mismatch
function evalVersion(
  operator: "$veq" | "$vne" | "$vgt" | "$vgte" | "$vlt" | "$vlte",
  actual: unknown,
  expected: unknown,
  ctx: EvalConditionContext,
): boolean {
  if (!isOrderable(actual, expected)) {
    reportMismatch(ctx, operator, expected, actual);
    return operator === "$vne";
  }
  const a = paddedVersionString(actual);
  const e = paddedVersionString(expected);
  switch (operator) {
    case "$veq":
      return a === e;
    case "$vne":
      return a !== e;
    case "$vgt":
      return a > e;
    case "$vgte":
      return a >= e;
    case "$vlt":
      return a < e;
    case "$vlte":
      return a <= e;
  }
}

// Recursive $or rule
function evalOr(
  obj: TestedObj,
  conditions: ConditionInterface[],
  ctx: EvalConditionContext,
): Result {
  if (!conditions.length) return true;
  let result: Result = false;
  for (let i = 0; i < conditions.length; i++) {
    const r = evalConditionWithContext(obj, conditions[i], ctx);
    if (r === true) return true;
    if (r === null) result = null;
  }
  return result;
}

// Recursive $and rule
function evalAnd(
  obj: TestedObj,
  conditions: ConditionInterface[],
  ctx: EvalConditionContext,
): Result {
  let result: Result = true;
  for (let i = 0; i < conditions.length; i++) {
    const r = evalConditionWithContext(obj, conditions[i], ctx);
    if (r === false) return false;
    if (r === null) result = null;
  }
  return result;
}
