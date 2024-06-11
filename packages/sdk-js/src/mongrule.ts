/* eslint-disable @typescript-eslint/no-explicit-any */

import { IdLists } from "./types/growthbook";
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
  idLists: IdLists
): boolean {
  // Recursive condition
  if ("$or" in condition) {
    return evalOr(obj, condition["$or"] as ConditionInterface[], idLists);
  }
  if ("$nor" in condition) {
    return !evalOr(obj, condition["$nor"] as ConditionInterface[], idLists);
  }
  if ("$and" in condition) {
    return evalAnd(obj, condition["$and"] as ConditionInterface[], idLists);
  }
  if ("$not" in condition) {
    return !evalCondition(
      obj,
      condition["$not"] as ConditionInterface,
      idLists
    );
  }

  // Condition is an object, keys are object paths, values are the condition for that path
  for (const [k, v] of Object.entries(condition)) {
    if (!evalConditionValue(v, getPath(obj, k), idLists)) return false;
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

// Transform a regex string into a real RegExp object
function getRegex(regex: string): RegExp {
  if (!_regexCache[regex]) {
    _regexCache[regex] = new RegExp(regex.replace(/([^\\])\//g, "$1\\/"));
  }
  return _regexCache[regex];
}

// Evaluate a single value against a condition
function evalConditionValue(
  condition: ConditionValue,
  value: any,
  idLists: IdLists
) {
  // Simple equality comparisons
  if (typeof condition === "string") {
    return value + "" === condition;
  }
  if (typeof condition === "number") {
    return value * 1 === condition;
  }
  if (typeof condition === "boolean") {
    return !!value === condition;
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
        idLists
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
function elemMatch(actual: any, expected: any, idLists: IdLists) {
  if (!Array.isArray(actual)) return false;
  const check = isOperatorObject(expected)
    ? (v: any) => evalConditionValue(expected, v, idLists)
    : (v: any) => evalCondition(v, expected, idLists);
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] && check(actual[i])) {
      return true;
    }
  }
  return false;
}

function isIn(actual: any, expected: Array<any>): boolean {
  // Do an intersection is attribute is an array
  if (Array.isArray(actual)) {
    return actual.some((el) => expected.includes(el));
  }
  return expected.includes(actual);
}

// Evaluate a single operator condition
function evalOperatorCondition(
  operator: Operator,
  actual: any,
  expected: any,
  idLists: IdLists
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
    case "$ingroup":
      return isIn(actual, idLists[expected] || []);
    case "$ningroup":
      return !isIn(actual, idLists[expected] || []);
    case "$nin":
      if (!Array.isArray(expected)) return false;
      return !isIn(actual, expected);
    case "$not":
      return !evalConditionValue(expected, actual, idLists);
    case "$size":
      if (!Array.isArray(actual)) return false;
      return evalConditionValue(expected, actual.length, idLists);
    case "$elemMatch":
      return elemMatch(actual, expected, idLists);
    case "$all":
      if (!Array.isArray(actual)) return false;
      for (let i = 0; i < expected.length; i++) {
        let passed = false;
        for (let j = 0; j < actual.length; j++) {
          if (evalConditionValue(expected[i], actual[j], idLists)) {
            passed = true;
            break;
          }
        }
        if (!passed) return false;
      }
      return true;
    case "$regex":
      try {
        return getRegex(expected).test(actual);
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
  idLists: IdLists
): boolean {
  if (!conditions.length) return true;
  for (let i = 0; i < conditions.length; i++) {
    if (evalCondition(obj, conditions[i], idLists)) {
      return true;
    }
  }
  return false;
}

// Recursive $and rule
function evalAnd(
  obj: TestedObj,
  conditions: ConditionInterface[],
  idLists: IdLists
): boolean {
  for (let i = 0; i < conditions.length; i++) {
    if (!evalCondition(obj, conditions[i], idLists)) {
      return false;
    }
  }
  return true;
}
