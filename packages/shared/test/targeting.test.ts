/// <reference types="jest" />

import {
  hasAttributeCondition,
  hasTargetingConfigured,
} from "../src/experiments/targeting";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
};

describe("hasAttributeCondition", () => {
  it("returns false for empty / missing conditions", () => {
    expect(hasAttributeCondition(undefined)).toBe(false);
    expect(hasAttributeCondition("")).toBe(false);
    expect(hasAttributeCondition("{}")).toBe(false);
  });

  it("returns true for a non-empty condition", () => {
    expect(hasAttributeCondition('{"country":"US"}')).toBe(true);
  });
});

describe("hasTargetingConfigured", () => {
  it("returns false when nothing is configured", () => {
    expect(hasTargetingConfigured(undefined)).toBe(false);
    expect(hasTargetingConfigured({})).toBe(false);
    expect(
      hasTargetingConfigured({
        condition: "{}",
        savedGroups: [],
        prerequisites: [],
      }),
    ).toBe(false);
  });

  it("returns true when an attribute condition is set", () => {
    expect(
      hasTargetingConfigured({
        condition: '{"country":{"$in":["US","CA"]},"age":{"$gte":18}}',
      }),
    ).toBe(true);
  });

  it("returns true when saved groups are set", () => {
    expect(
      hasTargetingConfigured({
        savedGroups: [{ match: "all", ids: ["grp_1"] }],
      }),
    ).toBe(true);
  });

  it("returns true when prerequisites are set", () => {
    expect(
      hasTargetingConfigured({
        prerequisites: [{ id: "prereq_1", condition: '{"value":true}' }],
      }),
    ).toBe(true);
  });
});
