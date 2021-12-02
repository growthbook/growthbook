/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  RuleSet,
  TestedObj,
  RuleValue,
  Operator,
  OperatorRule,
  VarType,
} from "./types";

export class Rule {
  private _regexCache: { [key: string]: RegExp } = {};
  private _definition: RuleSet;
  constructor(definition: RuleSet) {
    this._definition = definition;
  }

  test(obj: TestedObj): boolean {
    return this.evalRuleSet(obj, this._definition);
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

  private evalRuleSet(obj: TestedObj, def: RuleSet): boolean {
    if ("$or" in def) {
      return this.evalOr(obj, def["$or"] as RuleSet[]);
    }
    if ("$nor" in def) {
      return !this.evalOr(obj, def["$nor"] as RuleSet[]);
    }
    if ("$and" in def) {
      return this.evalAnd(obj, def["$and"] as RuleSet[]);
    }
    if ("$not" in def) {
      return !this.evalRuleSet(obj, def["$not"] as RuleSet);
    }

    for (const [k, v] of Object.entries(def)) {
      if (!this.evalRuleValue(v, this.getPath(obj, k))) return false;
    }
    return true;
  }

  private evalRuleValue(rule: RuleValue, value: any) {
    if (typeof rule === "string") {
      return value + "" === rule;
    }
    if (typeof rule === "number") {
      return value * 1 === rule;
    }
    if (typeof rule === "boolean") {
      return !!value === rule;
    }
    if (Array.isArray(rule) || !this.isOperatorObject(rule)) {
      return JSON.stringify(value) === JSON.stringify(rule);
    }

    // This is a special operator rule and we should evaluate each one separately
    for (const op in rule) {
      if (
        !this.evalOperatorRule(
          op as Operator,
          value,
          rule[op as keyof OperatorRule]
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
      ? (v: any) => this.evalRuleValue(expected, v)
      : (v: any) => this.evalRuleSet(v, expected);
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] && check(actual[i])) {
        return true;
      }
    }
    return false;
  }

  private evalOperatorRule(
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
        return !this.evalRuleValue(expected, actual);
      case "$size":
        if (!Array.isArray(actual)) return false;
        if (typeof expected === "number") {
          return actual.length === expected;
        }
        return this.evalRuleValue(expected, actual.length);
      case "$elemMatch":
        return this.elemMatch(actual, expected);
      case "$all":
        if (!Array.isArray(actual)) return false;
        for (let i = 0; i < expected.length; i++) {
          let passed = false;
          for (let j = 0; j < actual.length; j++) {
            if (this.evalRuleValue(expected[i], actual[j])) {
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

  private evalOr(obj: TestedObj, rules: RuleSet[]): boolean {
    if (!rules.length) return true;
    for (let i = 0; i < rules.length; i++) {
      if (this.evalRuleSet(obj, rules[i])) {
        return true;
      }
    }
    return false;
  }

  private evalAnd(obj: TestedObj, rules: RuleSet[]): boolean {
    for (let i = 0; i < rules.length; i++) {
      if (!this.evalRuleSet(obj, rules[i])) {
        return false;
      }
    }
    return true;
  }
}
