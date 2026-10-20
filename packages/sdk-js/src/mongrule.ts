/* eslint-disable @typescript-eslint/no-explicit-any */

import { SavedGroupsPayload } from "./types/growthbook";
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
import { paddedVersionString } from "./util";

const _regexCache: { [key: string]: RegExp } = {};

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
  return evalConditionWithContext(obj, condition, {
    savedGroups: savedGroups || {},
    visited: new Set(),
    typeMismatch: onTypeMismatch ? { onTypeMismatch, path: "" } : undefined,
  });
}

function evalConditionWithContext(
  obj: TestedObj,
  condition: ConditionInterface,
  ctx: EvalConditionContext,
): boolean {
  // Condition is an object, keys are either specific operators or object paths
  // values are either arguments for operators or conditions for paths
  for (const [k, v] of Object.entries(condition)) {
    switch (k) {
      case "$or":
        if (!evalOr(obj, v as ConditionInterface[], ctx)) return false;
        break;
      case "$nor":
        if (evalOr(obj, v as ConditionInterface[], ctx)) return false;
        break;
      case "$and":
        if (!evalAnd(obj, v as ConditionInterface[], ctx)) return false;
        break;
      case "$not":
        if (evalConditionWithContext(obj, v as ConditionInterface, ctx))
          return false;
        break;
      case "$savedGroup":
        if (!evalSavedGroup(obj, v, ctx)) return false;
        break;
      default:
        if (!evalConditionValue(v, getPath(obj, k), withPath(ctx, k)))
          return false;
    }
  }
  return true;
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
): boolean {
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
    return checkIn(
      getPath(obj, key),
      entry.values,
      false,
      "$savedGroup",
      withPath(ctx, key),
    );
  }

  if (entry.type === "condition") {
    // A condition group has no single attribute, so any override is ignored
    if (!entry.condition || typeof entry.condition !== "object") return false;
    // A copy, so sibling groups don't see each other's ids
    return evalConditionWithContext(obj, entry.condition, {
      ...ctx,
      visited: new Set(ctx.visited).add(id),
    });
  }

  // A group type added after this SDK was built
  return false;
}

// Return value at dot-separated path of an object
function getPath(obj: TestedObj, path: string) {
  const parts = path.split(".");
  let current: any = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current && typeof current === "object" && parts[i] in current) {
      current = current[parts[i]];
    } else {
      return null;
    }
  }
  return current;
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
) {
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
    return JSON.stringify(value) === JSON.stringify(condition);
  }

  // This is a special operator condition and we should evaluate each one separately
  for (const op in condition) {
    if (
      !evalOperatorCondition(
        op as Operator,
        value,
        condition[op as keyof OperatorConditionValue],
        ctx,
      )
    ) {
      return false;
    }
  }
  return true;
}

// If the object has only keys that start with '$'
function isOperatorObject(obj: any): boolean {
  const keys = Object.keys(obj);
  return (
    keys.length > 0 && keys.filter((k) => k[0] === "$").length === keys.length
  );
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
function elemMatch(actual: any, expected: any, ctx: EvalConditionContext) {
  if (!Array.isArray(actual)) return false;
  const check = isOperatorObject(expected)
    ? (v: any) => evalConditionValue(expected, v, ctx)
    : (v: any) => evalConditionWithContext(v, expected, ctx);
  for (let i = 0; i < actual.length; i++) {
    // Only skip nullish elements; falsy values like 0, "" and false are valid
    // array members and must still be tested against the condition.
    if ((actual[i] ?? null) !== null && check(actual[i])) {
      return true;
    }
  }
  return false;
}

function isIn(
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
  actual: any,
  expected: Array<any>,
  insensitive: boolean,
  operator: string,
  ctx: EvalConditionContext,
): boolean {
  const matched = isIn(actual, expected, insensitive);
  if (!matched && ctx.typeMismatch) {
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

function isInAll(
  actual: any,
  expected: ConditionValue[],
  ctx: EvalConditionContext,
  insensitive: boolean = false,
): boolean {
  if (!Array.isArray(actual)) return false;
  for (let i = 0; i < expected.length; i++) {
    let passed = false;
    for (let j = 0; j < actual.length; j++) {
      if (evalConditionValue(expected[i], actual[j], ctx, insensitive)) {
        passed = true;
        break;
      }
    }
    if (!passed) return false;
  }
  return true;
}

// Evaluate a single operator condition
function evalOperatorCondition(
  operator: Operator,
  actual: any,
  expected: any,
  ctx: EvalConditionContext,
): boolean {
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
      if (getType(actual) !== getType(expected)) {
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
      const values = getSavedGroupArrayValues(ctx.savedGroups[expected]);
      return values === null
        ? false
        : checkIn(actual, values, false, operator, ctx);
    }
    case "$notInGroup": {
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
      return !evalConditionValue(expected, actual, ctx);
    case "$size":
      if (!Array.isArray(actual)) return false;
      return evalConditionValue(expected, actual.length, ctx);
    case "$elemMatch":
      return elemMatch(actual, expected, ctx);
    case "$all":
      if (!Array.isArray(expected)) return false;
      return isInAll(actual, expected, ctx);
    case "$alli":
      if (!Array.isArray(expected)) return false;
      return isInAll(actual, expected, ctx, true);
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
      console.error("Unknown operator: " + operator);
      return false;
  }
}

// $vne is the opposite of $veq, so it matches on a type mismatch
function evalVersion(
  operator: "$veq" | "$vne" | "$vgt" | "$vgte" | "$vlt" | "$vlte",
  actual: any,
  expected: any,
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
): boolean {
  if (!conditions.length) return true;
  for (let i = 0; i < conditions.length; i++) {
    if (evalConditionWithContext(obj, conditions[i], ctx)) {
      return true;
    }
  }
  return false;
}

// Recursive $and rule
function evalAnd(
  obj: TestedObj,
  conditions: ConditionInterface[],
  ctx: EvalConditionContext,
): boolean {
  for (let i = 0; i < conditions.length; i++) {
    if (!evalConditionWithContext(obj, conditions[i], ctx)) {
      return false;
    }
  }
  return true;
}
