/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ConditionInterface,
  TestedObj,
  ConditionValue,
  Operator,
  OperatorConditionValue,
  VarType,
} from "./types/mongrule";

export class Condition {
  private _regexCache: { [key: string]: RegExp } = {};
  private _definition: ConditionInterface;
  constructor(definition: ConditionInterface) {
    this._definition = definition;
  }

  test(obj: TestedObj): boolean {
    return this.evalCondition(obj, this._definition);
  }

  private getPath(obj: TestedObj, path: string) {
    const parts = path.split(".");
    let current: any = obj;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] in current) {
        current = current[parts[i]];
      } else {
        return null;
      }
    }
    return current;
  }

  private getRegex(regex: string): RegExp {
    if (!this._regexCache[regex]) {
      this._regexCache[regex] = new RegExp(
        regex.replace(/([^\\])\//g, "$1\\/")
      );
    }
    return this._regexCache[regex];
  }

  private evalCondition(obj: TestedObj, def: ConditionInterface): boolean {
    if ("$or" in def) {
      return this.evalOr(obj, def["$or"] as ConditionInterface[]);
    }
    if ("$nor" in def) {
      return !this.evalOr(obj, def["$nor"] as ConditionInterface[]);
    }
    if ("$and" in def) {
      return this.evalAnd(obj, def["$and"] as ConditionInterface[]);
    }
    if ("$not" in def) {
      return !this.evalCondition(obj, def["$not"] as ConditionInterface);
    }

    for (const [k, v] of Object.entries(def)) {
      if (!this.evalConditionValue(v, this.getPath(obj, k))) return false;
    }
    return true;
  }

  private evalConditionValue(condition: ConditionValue, value: any) {
    if (typeof condition === "string") {
      return value + "" === condition;
    }
    if (typeof condition === "number") {
      return value * 1 === condition;
    }
    if (typeof condition === "boolean") {
      return !!value === condition;
    }
    if (Array.isArray(condition) || !this.isOperatorObject(condition)) {
      return JSON.stringify(value) === JSON.stringify(condition);
    }

    // This is a special operator condition and we should evaluate each one separately
    for (const op in condition) {
      if (
        !this.evalOperatorCondition(
          op as Operator,
          value,
          condition[op as keyof OperatorConditionValue]
        )
      ) {
        return false;
      }
    }
    return true;
  }

  private isOperatorObject(obj: any): boolean {
    const keys = Object.keys(obj);
    return (
      keys.length > 0 && keys.filter((k) => k[0] === "$").length === keys.length
    );
  }

  private getType(v: any): VarType | "unknown" {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    const t = typeof v;
    if (["string", "number", "boolean", "object", "undefined"].includes(t)) {
      return t as VarType;
    }
    return "unknown";
  }

  private elemMatch(actual: any, expected: any) {
    if (!Array.isArray(actual)) return false;
    const check = this.isOperatorObject(expected)
      ? (v: any) => this.evalConditionValue(expected, v)
      : (v: any) => this.evalCondition(v, expected);
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] && check(actual[i])) {
        return true;
      }
    }
    return false;
  }

  private evalOperatorCondition(
    operator: Operator,
    actual: any,
    expected: any
  ): boolean {
    switch (operator) {
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
        return expected ? actual !== null : actual === null;
      case "$in":
        return expected.includes(actual);
      case "$nin":
        return !expected.includes(actual);
      case "$not":
        return !this.evalConditionValue(expected, actual);
      case "$size":
        if (!Array.isArray(actual)) return false;
        if (typeof expected === "number") {
          return actual.length === expected;
        }
        return this.evalConditionValue(expected, actual.length);
      case "$elemMatch":
        return this.elemMatch(actual, expected);
      case "$all":
        if (!Array.isArray(actual)) return false;
        for (let i = 0; i < expected.length; i++) {
          let passed = false;
          for (let j = 0; j < actual.length; j++) {
            if (this.evalConditionValue(expected[i], actual[j])) {
              passed = true;
              break;
            }
          }
          if (!passed) return false;
        }
        return true;
      case "$regex":
        try {
          return this.getRegex(expected).test(actual);
        } catch (e) {
          return false;
        }
      case "$type":
        return this.getType(actual) === expected;
      default:
        console.error("Unknown operator: " + operator);
        return false;
    }
  }

  private evalOr(obj: TestedObj, conditions: ConditionInterface[]): boolean {
    if (!conditions.length) return true;
    for (let i = 0; i < conditions.length; i++) {
      if (this.evalCondition(obj, conditions[i])) {
        return true;
      }
    }
    return false;
  }

  private evalAnd(obj: TestedObj, conditions: ConditionInterface[]): boolean {
    for (let i = 0; i < conditions.length; i++) {
      if (!this.evalCondition(obj, conditions[i])) {
        return false;
      }
    }
    return true;
  }
}
