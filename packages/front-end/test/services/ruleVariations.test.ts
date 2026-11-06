import { describe, expect, it } from "vitest";
import {
  newRuleVariation,
  prefillVariationValue,
  removeRuleVariation,
  RuleVariation,
} from "@/services/ruleVariations";

describe("prefillVariationValue", () => {
  it.each([
    ["boolean", "true", ["true", "false", "true", "false"]],
    ["number", "5", ["5", "6", "7", "8"]],
    ["number", "abc", ["abc", "1", "2", "3"]],
    ["string", "on", ["on", "on-1", "on-2", "on-3"]],
    ["string", "", ["", "variation-1", "variation-2", "variation-3"]],
    ["json", "{}", ["{}", "{}", "{}", "{}"]],
  ] as const)("%s %j", (type, defaultValue, expected) => {
    expect(
      [0, 1, 2, 3].map((i) => prefillVariationValue(type, defaultValue, i)),
    ).toEqual(expected);
  });
});

describe("newRuleVariation", () => {
  it("names Control first, then numbered variations", () => {
    expect(newRuleVariation("string", "on", 0).name).toBe("Control");
    expect(newRuleVariation("string", "on", 2)).toMatchObject({
      name: "Variation 2",
      value: "on-2",
      weight: 0,
    });
  });
});

describe("removeRuleVariation", () => {
  const variation = (name: string, weight: number): RuleVariation => ({
    id: name,
    name,
    value: "",
    weight,
  });

  it("renumbers default names and keeps given ones", () => {
    const next = removeRuleVariation(
      [
        variation("Control", 0.25),
        variation("Variation 1", 0.25),
        variation("Blue", 0.25),
        variation("Variation 3", 0.25),
      ],
      1,
    );
    expect(next.map((v) => v.name)).toEqual(["Control", "Blue", "Variation 2"]);
  });

  it("keeps an even split even", () => {
    const next = removeRuleVariation(
      [
        variation("Control", 1 / 3),
        variation("Variation 1", 1 / 3),
        variation("Variation 2", 1 / 3),
      ],
      2,
    );
    expect(next.map((v) => v.weight)).toEqual([0.5, 0.5]);
  });

  it("keeps an uneven split's proportions", () => {
    const next = removeRuleVariation(
      [
        variation("Control", 0.6),
        variation("Variation 1", 0.2),
        variation("Variation 2", 0.2),
      ],
      2,
    );
    expect(next[0].weight).toBeCloseTo(0.75);
    expect(next[1].weight).toBeCloseTo(0.25);
  });

  it("splits evenly when the rest have no weight", () => {
    const next = removeRuleVariation(
      [
        variation("Control", 0),
        variation("Variation 1", 0),
        variation("Variation 2", 1),
      ],
      2,
    );
    expect(next.map((v) => v.weight)).toEqual([0.5, 0.5]);
  });
});
