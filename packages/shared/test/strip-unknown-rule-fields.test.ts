import { stripUnknownRuleFields } from "../src/validators/features";

describe("stripUnknownRuleFields", () => {
  it("drops fields an experiment-ref rule does not store", () => {
    const out = stripUnknownRuleFields({
      type: "experiment-ref",
      id: "r1",
      description: "",
      enabled: true,
      allEnvironments: true,
      condition: "",
      scheduleRules: [],
      experimentId: "exp_1",
      variations: [],
      // widget-only fields the rule form carries for every type
      hashVersion: 2,
      disableStickyBucketing: false,
      coverage: 1,
    } as never) as Record<string, unknown>;
    expect(out.hashVersion).toBeUndefined();
    expect(out.disableStickyBucketing).toBeUndefined();
    expect(out.coverage).toBeUndefined();
    expect(out.experimentId).toBe("exp_1");
    expect(out.allEnvironments).toBe(true);
  });

  it("keeps fields the type does store", () => {
    const out = stripUnknownRuleFields({
      type: "rollout",
      id: "r2",
      description: "",
      enabled: true,
      allEnvironments: true,
      condition: "",
      scheduleRules: [],
      value: "a",
      coverage: 0.5,
      hashAttribute: "id",
      hashVersion: 2,
    } as never) as Record<string, unknown>;
    expect(out.coverage).toBe(0.5);
    expect(out.hashVersion).toBe(2);
  });

  it("leaves an unrecognised type alone", () => {
    const rule = { type: "nope", weird: 1 } as never;
    expect(stripUnknownRuleFields(rule)).toBe(rule);
  });
});
