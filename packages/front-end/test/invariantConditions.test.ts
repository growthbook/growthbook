import { evaluateInvariants } from "shared/util";
import {
  conditionToMongo,
  parseCondition,
  Condition,
} from "@/components/Configs/invariantConditions";

const roundTrip = (c: Condition): Condition | null =>
  parseCondition(conditionToMongo(c));

// Evaluate through the production evaluator (the builder's output is only ever
// consumed by evaluateInvariants, never by raw evalCondition).
const matches = (
  value: Record<string, unknown>,
  mongo: Record<string, unknown>,
): boolean =>
  evaluateInvariants(value, [
    { name: "t", rule: JSON.stringify(mongo), message: "violated" },
  ]).length === 0;

describe("invariant conditions — object/array equality (G1)", () => {
  it("object equality is deep-compared and matches equal values", () => {
    const c: Condition = {
      field: "cfg",
      op: "==",
      rhsKind: "value",
      rhs: '{"a":1,"b":[2,3]}',
    };
    const mongo = conditionToMongo(c);
    expect(matches({ cfg: { a: 1, b: [2, 3] } }, mongo)).toBe(true);
    // Key order does not matter (the evaluator canonicalizes key order).
    expect(matches({ cfg: { b: [2, 3], a: 1 } }, mongo)).toBe(true);
    // A different object should fail.
    expect(matches({ cfg: { a: 1, b: [2, 4] } }, mongo)).toBe(false);
  });

  it("object inequality never matches an equal value and matches a different one", () => {
    const c: Condition = {
      field: "cfg",
      op: "!=",
      rhsKind: "value",
      rhs: '{"a":1}',
    };
    const mongo = conditionToMongo(c);
    // != should be FALSE when the values are deeply equal.
    expect(matches({ cfg: { a: 1 } }, mongo)).toBe(false);
    // != should be TRUE when they differ.
    expect(matches({ cfg: { a: 2 } }, mongo)).toBe(true);
  });

  it("array equality is deep-compared and matches equal arrays", () => {
    const c: Condition = {
      field: "cfg",
      op: "==",
      rhsKind: "value",
      rhs: "[1,2,3]",
    };
    const mongo = conditionToMongo(c);
    expect(matches({ cfg: [1, 2, 3] }, mongo)).toBe(true);
    expect(matches({ cfg: [1, 2] }, mongo)).toBe(false);
  });

  it("array inequality matches only when arrays differ", () => {
    const c: Condition = {
      field: "cfg",
      op: "!=",
      rhsKind: "value",
      rhs: "[1,2,3]",
    };
    const mongo = conditionToMongo(c);
    expect(matches({ cfg: [1, 2, 3] }, mongo)).toBe(false);
    expect(matches({ cfg: [1, 2] }, mongo)).toBe(true);
  });

  it("round-trips object equality through parseCondition", () => {
    const c: Condition = {
      field: "cfg",
      op: "==",
      rhsKind: "value",
      rhs: '{"a":1}',
    };
    expect(roundTrip(c)).toEqual(c);
  });

  it("round-trips object inequality through parseCondition", () => {
    const c: Condition = {
      field: "cfg",
      op: "!=",
      rhsKind: "value",
      rhs: '{"a":1}',
    };
    expect(roundTrip(c)).toEqual(c);
  });

  it("round-trips array equality/inequality", () => {
    for (const op of ["==", "!="] as const) {
      const c: Condition = {
        field: "cfg",
        op,
        rhsKind: "value",
        rhs: "[1,2]",
      };
      expect(roundTrip(c)).toEqual(c);
    }
  });
});

describe("invariant conditions — scalar ops still use $eq/$ne (regression)", () => {
  it("scalar equality emits $eq and matches", () => {
    const c: Condition = {
      field: "cfg",
      op: "==",
      rhsKind: "value",
      rhs: "5",
    };
    const mongo = conditionToMongo(c);
    expect(mongo).toEqual({ cfg: { $eq: 5 } });
    expect(matches({ cfg: 5 }, mongo)).toBe(true);
    expect(roundTrip(c)).toEqual(c);
  });

  it("string equality round-trips and matches", () => {
    const c: Condition = {
      field: "cfg",
      op: "==",
      rhsKind: "value",
      rhs: "hello",
    };
    const mongo = conditionToMongo(c);
    expect(matches({ cfg: "hello" }, mongo)).toBe(true);
    expect(roundTrip(c)).toEqual(c);
  });

  it("scalar inequality emits $ne", () => {
    const c: Condition = {
      field: "cfg",
      op: "!=",
      rhsKind: "value",
      rhs: "5",
    };
    expect(conditionToMongo(c)).toEqual({ cfg: { $ne: 5 } });
  });
});

describe("invariant conditions — field-to-field and unary (regression)", () => {
  it("field comparison emits $ref and round-trips", () => {
    const c: Condition = {
      field: "start",
      op: "<",
      rhsKind: "field",
      rhs: "end",
    };
    expect(conditionToMongo(c)).toEqual({ start: { $lt: { $ref: "end" } } });
    expect(roundTrip(c)).toEqual(c);
  });

  it("field comparison evaluates against the other field's value", () => {
    const c: Condition = {
      field: "start",
      op: "<",
      rhsKind: "field",
      rhs: "end",
    };
    const mongo = conditionToMongo(c);
    expect(matches({ start: 1, end: 2 }, mongo)).toBe(true);
    expect(matches({ start: 3, end: 2 }, mongo)).toBe(false);
  });

  it("unary ops round-trip", () => {
    for (const op of ["isTrue", "isFalse", "isNull", "isNotNull"] as const) {
      const c: Condition = { field: "f", op, rhsKind: "value", rhs: "" };
      expect(roundTrip(c)).toEqual(c);
    }
  });
});
