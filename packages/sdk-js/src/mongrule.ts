/* eslint-disable @typescript-eslint/no-explicit-any */

import { SavedGroupsPayload } from "./types/growthbook";
import {
  ConditionInterface,
  SavedGroupReference,
  TestedObj,
  ConditionValue,
  Operator,
  OperatorConditionValue,
  VarType,
} from "./types/mongrule";
import { hasOwn, paddedVersionString } from "./util";

const _regexCache: { [key: string]: RegExp } = {};

// true or false, or null when the result depends on an operator or saved group
// type this SDK doesn't support. Exported functions treat null as failing.
type Result = boolean | null;
const not = (r: Result): Result => (r === null ? null : !r);

// Keys a condition can have that aren't attributes, besides $not, which is
// also an operator on a value
const CONDITION_OPERATORS = ["$or", "$nor", "$and", "$savedGroup"];

// The top-level condition evaluation function
export function evalCondition(
  obj: TestedObj,
  condition: ConditionInterface,
  // Must be included for `condition` to correctly evaluate group Operators
  savedGroups?: SavedGroupsPayload,
  // Group ids already being resolved, to stop cycles
  visited?: Set<string>,
): boolean {
  return (
    evalConditionResult(
      obj,
      condition,
      savedGroups || {},
      visited || new Set(),
    ) === true
  );
}

// Condition is an object, keys are either specific operators or object paths
// values are either arguments for operators or conditions for paths
function evalConditionResult(
  obj: TestedObj,
  condition: ConditionInterface,
  savedGroups: SavedGroupsPayload,
  visited: Set<string>,
): Result {
  let result: Result = true;
  for (const [k, v] of Object.entries(condition)) {
    let r: Result;
    switch (k) {
      case "$or":
        r = evalOr(obj, v as ConditionInterface[], savedGroups, visited);
        break;
      case "$nor":
        r = not(evalOr(obj, v as ConditionInterface[], savedGroups, visited));
        break;
      case "$and":
        r = evalAnd(obj, v as ConditionInterface[], savedGroups, visited);
        break;
      case "$not":
        r = not(
          evalConditionResult(
            obj,
            v as ConditionInterface,
            savedGroups,
            visited,
          ),
        );
        break;
      case "$savedGroup":
        r = evalSavedGroup(obj, v, savedGroups, visited);
        break;
      default:
        r = evalConditionValue(v, getPath(obj, k), savedGroups, false, visited);
    }
    // One failing entry decides it, wherever an unsupported one is
    if (r === false) return false;
    if (r === null) result = null;
  }
  return result;
}

/** Resolves a `$savedGroup` reference. Anything unrecognized matches nobody. */
function evalSavedGroup(
  obj: TestedObj,
  reference: unknown,
  savedGroups: SavedGroupsPayload,
  visited: Set<string>,
): Result {
  if (!reference || typeof reference !== "object" || Array.isArray(reference))
    return false;

  const { id, attributeKey } = reference as SavedGroupReference;
  if (typeof id !== "string" || visited.has(id)) return false;
  // Falling back to the entry's attribute would check a different population
  if (attributeKey !== undefined && typeof attributeKey !== "string")
    return false;

  const entry = savedGroups[id];
  // Absent, or a v1 bare array
  if (!entry || Array.isArray(entry) || typeof entry !== "object") return false;

  const next = new Set(visited).add(id);

  if (entry.type === "list") {
    // The override wins over the entry's own attribute
    const key = attributeKey ?? entry.attributeKey;
    if (typeof key !== "string") return false;
    if (!Array.isArray(entry.values)) return false;
    return isIn(getPath(obj, key), entry.values);
  }

  if (entry.type === "condition") {
    // A condition group has no single attribute, so any override is ignored
    if (!entry.condition || typeof entry.condition !== "object") return false;
    return evalConditionResult(obj, entry.condition, savedGroups, next);
  }

  // A group type added after this SDK was built. The client SDK may support it.
  return null;
}

// Return value at dot-separated path of an object
function getPath(obj: TestedObj, path: string) {
  const parts = path.split(".");
  let current: any = obj;
  for (let i = 0; i < parts.length; i++) {
    // Own keys only, so a missing `constructor` isn't the inherited one
    if (current && typeof current === "object" && hasOwn(current, parts[i])) {
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
  savedGroups: SavedGroupsPayload,
  insensitive: boolean = false,
  visited: Set<string> = new Set(),
): Result {
  // Simple equality comparisons
  if (typeof condition === "string") {
    if (insensitive) {
      return String(value).toLowerCase() === condition.toLowerCase();
    }
    return value + "" === condition;
  }
  if (typeof condition === "number") {
    return value * 1 === condition;
  }
  if (typeof condition === "boolean") {
    return value !== null && !!value === condition;
  }

  if (condition === null) {
    return value === null;
  }

  if (Array.isArray(condition) || !isOperatorObject(condition)) {
    return JSON.stringify(value) === JSON.stringify(condition);
  }

  // This is a special operator condition and we should evaluate each one separately
  let result: Result = true;
  for (const op in condition) {
    const r = evalOperatorCondition(
      op as Operator,
      value,
      condition[op as keyof OperatorConditionValue],
      savedGroups,
      visited,
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

// At least one element of actual must match the expected condition/value
function elemMatch(
  actual: any,
  expected: any,
  savedGroups: SavedGroupsPayload,
  visited: Set<string>,
): Result {
  if (!Array.isArray(actual)) return false;
  // Operators test each element itself. A condition, including one that only
  // uses $or, $and, $nor, or $savedGroup, tests each element's fields.
  const check =
    isOperatorObject(expected) &&
    !Object.keys(expected).some((k) => CONDITION_OPERATORS.includes(k))
      ? (v: any) => evalConditionValue(expected, v, savedGroups, false, visited)
      : (v: any) => evalConditionResult(v, expected, savedGroups, visited);
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
  actual: any,
  expected: ConditionValue[],
  savedGroups: SavedGroupsPayload,
  insensitive: boolean = false,
  visited: Set<string> = new Set(),
): Result {
  if (!Array.isArray(actual)) return false;
  let result: Result = true;
  for (let i = 0; i < expected.length; i++) {
    let passed: Result = false;
    for (let j = 0; j < actual.length; j++) {
      const r = evalConditionValue(
        expected[i],
        actual[j],
        savedGroups,
        insensitive,
        visited,
      );
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
  savedGroups: SavedGroupsPayload,
  visited: Set<string> = new Set(),
): Result {
  switch (operator) {
    case "$veq":
      return paddedVersionString(actual) === paddedVersionString(expected);
    case "$vne":
      return paddedVersionString(actual) !== paddedVersionString(expected);
    case "$vgt":
      return paddedVersionString(actual) > paddedVersionString(expected);
    case "$vgte":
      return paddedVersionString(actual) >= paddedVersionString(expected);
    case "$vlt":
      return paddedVersionString(actual) < paddedVersionString(expected);
    case "$vlte":
      return paddedVersionString(actual) <= paddedVersionString(expected);
    case "$eq":
      return actual === expected;
    case "$ne":
      return actual !== expected;
    case "$lt":
      return actual < expected;
    case "$lte":
      return actual <= expected;
    case "$gt":
      return actual > expected;
    case "$gte":
      return actual >= expected;
    case "$exists":
      // Using `!=` and `==` instead of strict checks so it also matches for undefined
      return expected ? actual != null : actual == null;
    case "$in":
      if (!Array.isArray(expected)) return false;
      return isIn(actual, expected);
    case "$ini":
      if (!Array.isArray(expected)) return false;
      return isIn(actual, expected, true);
    case "$inGroup": {
      if (isNewGroupType(savedGroups[expected])) return null;
      const values = getSavedGroupArrayValues(savedGroups[expected]);
      return values === null ? false : isIn(actual, values);
    }
    case "$notInGroup": {
      if (isNewGroupType(savedGroups[expected])) return null;
      // No values means matching nobody. An empty list would pass everyone.
      const values = getSavedGroupArrayValues(savedGroups[expected]);
      return values === null ? false : !isIn(actual, values);
    }
    case "$nin":
      if (!Array.isArray(expected)) return false;
      return !isIn(actual, expected);
    case "$nini":
      if (!Array.isArray(expected)) return false;
      return !isIn(actual, expected, true);
    case "$not":
      return not(
        evalConditionValue(expected, actual, savedGroups, false, visited),
      );
    case "$size":
      if (!Array.isArray(actual)) return false;
      return evalConditionValue(
        expected,
        actual.length,
        savedGroups,
        false,
        visited,
      );
    case "$elemMatch":
      return elemMatch(actual, expected, savedGroups, visited);
    case "$all":
      if (!Array.isArray(expected)) return false;
      return isInAll(actual, expected, savedGroups, false, visited);
    case "$alli":
      if (!Array.isArray(expected)) return false;
      return isInAll(actual, expected, savedGroups, true, visited);
    case "$regex":
      try {
        return getRegex(expected).test(actual);
      } catch (e) {
        return false;
      }
    case "$regexi":
      try {
        return getRegex(expected, true).test(actual);
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

// Recursive $or rule
function evalOr(
  obj: TestedObj,
  conditions: ConditionInterface[],
  savedGroups: SavedGroupsPayload,
  visited: Set<string>,
): Result {
  if (!conditions.length) return true;
  let result: Result = false;
  for (let i = 0; i < conditions.length; i++) {
    const r = evalConditionResult(obj, conditions[i], savedGroups, visited);
    if (r === true) return true;
    if (r === null) result = null;
  }
  return result;
}

// Recursive $and rule
function evalAnd(
  obj: TestedObj,
  conditions: ConditionInterface[],
  savedGroups: SavedGroupsPayload,
  visited: Set<string>,
): Result {
  let result: Result = true;
  for (let i = 0; i < conditions.length; i++) {
    const r = evalConditionResult(obj, conditions[i], savedGroups, visited);
    if (r === false) return false;
    if (r === null) result = null;
  }
  return result;
}
