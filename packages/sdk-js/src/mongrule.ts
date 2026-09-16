/* eslint-disable @typescript-eslint/no-explicit-any */

import { SavedGroupsPayload } from "./types/growthbook";
import {
  ConditionInterface,
  TestedObj,
  ConditionValue,
  Operator,
  OperatorConditionValue,
  VarType,
} from "./types/mongrule";
import { paddedVersionString } from "./util";

const _regexCache: { [key: string]: RegExp } = {};

// The top-level condition evaluation function
export function evalCondition(
  obj: TestedObj,
  condition: ConditionInterface,
  // Must be included for `condition` to correctly evaluate group Operators
  savedGroups?: SavedGroupsPayload,
  // Saved groups already being resolved on this branch. Stops a group that
  // references itself, directly or through others, from recursing forever.
  visited?: Set<string>,
): boolean {
  savedGroups = savedGroups || {};
  visited = visited || new Set();
  // Condition is an object, keys are either specific operators or object paths
  // values are either arguments for operators or conditions for paths
  for (const [k, v] of Object.entries(condition)) {
    switch (k) {
      case "$or":
        if (!evalOr(obj, v as ConditionInterface[], savedGroups, visited))
          return false;
        break;
      case "$nor":
        if (evalOr(obj, v as ConditionInterface[], savedGroups, visited))
          return false;
        break;
      case "$and":
        if (!evalAnd(obj, v as ConditionInterface[], savedGroups, visited))
          return false;
        break;
      case "$not":
        if (evalCondition(obj, v as ConditionInterface, savedGroups, visited))
          return false;
        break;
      case "$savedGroup":
        if (!evalSavedGroup(obj, v, savedGroups, visited)) return false;
        break;
      default:
        if (
          !evalConditionValue(v, getPath(obj, k), savedGroups, false, visited)
        )
          return false;
    }
  }
  return true;
}

/**
 * Resolves a `$savedGroup` reference against the payload's saved groups.
 *
 * Returns false for anything it does not understand: a non-string id, an id
 * that is not in the payload, an entry in the older bare-array form, or a
 * `type` this SDK version does not know. A payload can be newer than the SDK
 * reading it, so an unknown shape must match nobody rather than throw.
 */
function evalSavedGroup(
  obj: TestedObj,

  id: any,
  savedGroups: SavedGroupsPayload,
  visited: Set<string>,
): boolean {
  if (typeof id !== "string" || visited.has(id)) return false;

  const entry = savedGroups[id];
  // Absent, or the v1 bare array, which this operator cannot resolve
  if (!entry || Array.isArray(entry) || typeof entry !== "object") return false;

  const next = new Set(visited).add(id);

  if (entry.type === "list") {
    if (typeof entry.attributeKey !== "string") return false;
    if (!Array.isArray(entry.values)) return false;
    return isIn(getPath(obj, entry.attributeKey), entry.values);
  }

  if (entry.type === "condition") {
    if (!entry.condition || typeof entry.condition !== "object") return false;
    return evalCondition(obj, entry.condition, savedGroups, next);
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
  savedGroups: SavedGroupsPayload,
  insensitive: boolean = false,
  visited: Set<string> = new Set(),
) {
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
  for (const op in condition) {
    if (
      !evalOperatorCondition(
        op as Operator,
        value,
        condition[op as keyof OperatorConditionValue],
        savedGroups,
        visited,
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

// At least one element of actual must match the expected condition/value
function elemMatch(
  actual: any,
  expected: any,
  savedGroups: SavedGroupsPayload,
  visited: Set<string>,
) {
  if (!Array.isArray(actual)) return false;
  const check = isOperatorObject(expected)
    ? (v: any) => evalConditionValue(expected, v, savedGroups, false, visited)
    : (v: any) => evalCondition(v, expected, savedGroups, visited);
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

// $inGroup can only resolve a legacy value-array entry. A savedGroupReferencesV2
// payload holds objects instead, and indexing one as an array throws, so treat
// anything that isn't an array as matching nothing.
// True for a savedGroupReferencesV2 entry, which `$inGroup`/`$notInGroup`
// cannot resolve. Absent ids are not typed entries and keep their own handling.
function isTypedSavedGroupEntry(
  entry: SavedGroupsPayload[string] | undefined,
): boolean {
  return !!entry && !Array.isArray(entry) && typeof entry === "object";
}

function asLegacyValuesArray(
  entry: SavedGroupsPayload[string] | undefined,
): Array<string | number> {
  return Array.isArray(entry) ? entry : [];
}

function isInAll(
  actual: any,
  expected: ConditionValue[],
  savedGroups: SavedGroupsPayload,
  insensitive: boolean = false,
  visited: Set<string> = new Set(),
): boolean {
  if (!Array.isArray(actual)) return false;
  for (let i = 0; i < expected.length; i++) {
    let passed = false;
    for (let j = 0; j < actual.length; j++) {
      if (
        evalConditionValue(
          expected[i],
          actual[j],
          savedGroups,
          insensitive,
          visited,
        )
      ) {
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
  savedGroups: SavedGroupsPayload,
  visited: Set<string> = new Set(),
): boolean {
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
    case "$inGroup":
      return isIn(actual, asLegacyValuesArray(savedGroups[expected]));
    case "$notInGroup":
      // A typed entry cannot be read by this operator. Treating it as an empty
      // list would make every user pass an exclusion rule, so fail closed.
      // An absent id still passes, which is the documented behaviour.
      if (isTypedSavedGroupEntry(savedGroups[expected])) return false;
      return !isIn(actual, asLegacyValuesArray(savedGroups[expected]));
    case "$nin":
      if (!Array.isArray(expected)) return false;
      return !isIn(actual, expected);
    case "$nini":
      if (!Array.isArray(expected)) return false;
      return !isIn(actual, expected, true);
    case "$not":
      return !evalConditionValue(expected, actual, savedGroups, false, visited);
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
      console.error("Unknown operator: " + operator);
      return false;
  }
}

// Recursive $or rule
function evalOr(
  obj: TestedObj,
  conditions: ConditionInterface[],
  savedGroups: SavedGroupsPayload,
  visited: Set<string>,
): boolean {
  if (!conditions.length) return true;
  for (let i = 0; i < conditions.length; i++) {
    if (evalCondition(obj, conditions[i], savedGroups, visited)) {
      return true;
    }
  }
  return false;
}

// Recursive $and rule
function evalAnd(
  obj: TestedObj,
  conditions: ConditionInterface[],
  savedGroups: SavedGroupsPayload,
  visited: Set<string>,
): boolean {
  for (let i = 0; i < conditions.length; i++) {
    if (!evalCondition(obj, conditions[i], savedGroups, visited)) {
      return false;
    }
  }
  return true;
}
