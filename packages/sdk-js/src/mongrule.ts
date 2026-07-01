/* eslint-disable @typescript-eslint/no-explicit-any */

import { SavedGroupsValues } from "./types/growthbook";
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
  savedGroups?: SavedGroupsValues,
): boolean {
  savedGroups = savedGroups || {};
  // Resolve any `{ $ref: "path" }` markers against the tested object ONCE, up
  // front, so a rule can compare one field to another. The whole tree is
  // resolved here, so the recursive evaluation below never has to re-resolve.
  return evalConditionResolved(
    obj,
    resolveConditionRefs(condition, obj),
    savedGroups,
  );
}

// Evaluate a condition whose `$ref` markers have already been resolved against
// `obj`. Logical operators recurse here (same object, no re-resolution);
// `$elemMatch` crosses into a new object and re-enters `evalCondition`.
function evalConditionResolved(
  obj: TestedObj,
  condition: ConditionInterface,
  savedGroups: SavedGroupsValues,
): boolean {
  // Condition is an object, keys are either specific operators or object paths
  // values are either arguments for operators or conditions for paths
  for (const [k, v] of Object.entries(condition)) {
    switch (k) {
      case "$or":
        if (!evalOr(obj, v as ConditionInterface[], savedGroups)) return false;
        break;
      case "$nor":
        if (evalOr(obj, v as ConditionInterface[], savedGroups)) return false;
        break;
      case "$and":
        if (!evalAnd(obj, v as ConditionInterface[], savedGroups)) return false;
        break;
      case "$not":
        if (evalConditionResolved(obj, v as ConditionInterface, savedGroups))
          return false;
        break;
      default:
        if (!evalConditionValue(v, getPath(obj, k), savedGroups)) return false;
    }
  }
  return true;
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

// Resolve `{ $ref: "<path>" }` markers in a condition to the tested object's
// value at that dot-path — enabling field-to-field comparisons, e.g.
// `{ streams: { $lte: { $ref: "devices" } } }`. Returns the input unchanged
// (same reference) when there are no refs, so the common path allocates nothing.
function resolveConditionRefs(node: any, obj: TestedObj): any {
  if (Array.isArray(node)) {
    let changed = false;
    const out = node.map((n) => {
      const r = resolveConditionRefs(n, obj);
      if (r !== n) changed = true;
      return r;
    });
    return changed ? out : node;
  }
  if (node && typeof node === "object") {
    const keys = Object.keys(node);
    if (
      keys.length === 1 &&
      keys[0] === "$ref" &&
      typeof node.$ref === "string"
    ) {
      return getPath(obj, node.$ref);
    }
    let changed = false;
    const out: { [k: string]: any } = {};
    for (const k of keys) {
      const r = resolveConditionRefs(node[k], obj);
      out[k] = r;
      if (r !== node[k]) changed = true;
    }
    return changed ? out : node;
  }
  return node;
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
  savedGroups: SavedGroupsValues,
  insensitive: boolean = false,
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
function elemMatch(actual: any, expected: any, savedGroups: SavedGroupsValues) {
  if (!Array.isArray(actual)) return false;
  const check = isOperatorObject(expected)
    ? (v: any) => evalConditionValue(expected, v, savedGroups)
    : (v: any) => evalCondition(v, expected, savedGroups);
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] && check(actual[i])) {
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

function isInAll(
  actual: any,
  expected: ConditionValue[],
  savedGroups: SavedGroupsValues,
  insensitive: boolean = false,
): boolean {
  if (!Array.isArray(actual)) return false;
  for (let i = 0; i < expected.length; i++) {
    let passed = false;
    for (let j = 0; j < actual.length; j++) {
      if (
        evalConditionValue(expected[i], actual[j], savedGroups, insensitive)
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
  savedGroups: SavedGroupsValues,
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
      return isIn(actual, savedGroups[expected] || []);
    case "$notInGroup":
      return !isIn(actual, savedGroups[expected] || []);
    case "$nin":
      if (!Array.isArray(expected)) return false;
      return !isIn(actual, expected);
    case "$nini":
      if (!Array.isArray(expected)) return false;
      return !isIn(actual, expected, true);
    case "$not":
      return !evalConditionValue(expected, actual, savedGroups);
    case "$size":
      if (!Array.isArray(actual)) return false;
      return evalConditionValue(expected, actual.length, savedGroups);
    case "$elemMatch":
      return elemMatch(actual, expected, savedGroups);
    case "$all":
      if (!Array.isArray(expected)) return false;
      return isInAll(actual, expected, savedGroups);
    case "$alli":
      if (!Array.isArray(expected)) return false;
      return isInAll(actual, expected, savedGroups, true);
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

// Recursive $or rule. `conditions` share the already-resolved `obj`, so recurse
// via evalConditionResolved rather than re-resolving refs per branch.
function evalOr(
  obj: TestedObj,
  conditions: ConditionInterface[],
  savedGroups: SavedGroupsValues,
): boolean {
  if (!conditions.length) return true;
  for (let i = 0; i < conditions.length; i++) {
    if (evalConditionResolved(obj, conditions[i], savedGroups)) {
      return true;
    }
  }
  return false;
}

// Recursive $and rule
function evalAnd(
  obj: TestedObj,
  conditions: ConditionInterface[],
  savedGroups: SavedGroupsValues,
): boolean {
  for (let i = 0; i < conditions.length; i++) {
    if (!evalConditionResolved(obj, conditions[i], savedGroups)) {
      return false;
    }
  }
  return true;
}
