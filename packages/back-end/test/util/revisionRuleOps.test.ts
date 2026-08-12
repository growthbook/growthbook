import { FeatureRule } from "shared/types/feature";
import {
  moveRuleInEnv,
  projectRulesForEnv,
  removeRuleAtEnvIndex,
  stampRuleForEnvs,
  updateRuleAtEnvIndex,
} from "back-end/src/util/revisionRuleOps";

// Helpers to make fixtures readable
const envRule = (
  id: string,
  env: string,
  extras: Partial<FeatureRule> = {},
): FeatureRule =>
  ({
    id,
    description: "",
    type: "force",
    value: "v",
    allEnvironments: false,
    environments: [env],
    ...extras,
  }) as FeatureRule;

const allEnvRule = (
  id: string,
  extras: Partial<FeatureRule> = {},
): FeatureRule =>
  ({
    id,
    description: "",
    type: "force",
    value: "v",
    allEnvironments: true,
    ...extras,
  }) as FeatureRule;

describe("projectRulesForEnv", () => {
  it("preserves order and captures parent indices", () => {
    const dev1 = envRule("dev1", "dev");
    const prod1 = envRule("prod1", "prod");
    const shared = allEnvRule("shared");
    const dev2 = envRule("dev2", "dev");
    const rules = [dev1, prod1, shared, dev2];

    const { envRules, parentIndices } = projectRulesForEnv(rules, "dev");
    expect(envRules).toEqual([dev1, shared, dev2]);
    expect(parentIndices).toEqual([0, 2, 3]);
  });

  it("returns empty when no rules apply", () => {
    const rules = [envRule("a", "prod"), envRule("b", "prod")];
    const { envRules, parentIndices } = projectRulesForEnv(rules, "dev");
    expect(envRules).toEqual([]);
    expect(parentIndices).toEqual([]);
  });
});

describe("updateRuleAtEnvIndex", () => {
  it("replaces the i-th env rule in place; non-env rules untouched", () => {
    const dev1 = envRule("dev1", "dev");
    const prod1 = envRule("prod1", "prod");
    const dev2 = envRule("dev2", "dev");
    const rules = [dev1, prod1, dev2];

    const {
      rules: next,
      updated,
      existing,
    } = updateRuleAtEnvIndex(
      rules,
      "dev",
      1, // second dev-projected rule = dev2 at parent idx 2
      (r) => ({ ...r, value: "v2" }),
    );

    expect(existing).toBe(dev2);
    expect(updated.value).toBe("v2");
    expect(next).toEqual([dev1, prod1, updated]);
    // Original array untouched
    expect(rules).toEqual([dev1, prod1, dev2]);
  });

  it("throws when i out of range", () => {
    const rules = [envRule("a", "dev")];
    expect(() => updateRuleAtEnvIndex(rules, "dev", 5, (r) => r)).toThrow(
      "Unknown rule",
    );
  });
});

describe("removeRuleAtEnvIndex", () => {
  it("removes the rule globally for single-env scope", () => {
    const dev1 = envRule("dev1", "dev");
    const prod1 = envRule("prod1", "prod");
    const rules = [dev1, prod1];

    const { rules: next, removed } = removeRuleAtEnvIndex(rules, "dev", 0);
    expect(removed).toBe(dev1);
    expect(next).toEqual([prod1]);
  });

  it("removes `allEnvironments: true` rule globally", () => {
    const shared = allEnvRule("shared");
    const prod1 = envRule("prod1", "prod");
    const rules = [shared, prod1];

    const { rules: next } = removeRuleAtEnvIndex(rules, "prod", 0);
    expect(next).toEqual([prod1]);
  });

  it("narrows scope when rule is explicitly multi-env", () => {
    const multi = envRule("multi", "dev", { environments: ["dev", "prod"] });
    const rules = [multi];

    const { rules: next } = removeRuleAtEnvIndex(rules, "dev", 0);
    expect(next).toHaveLength(1);
    expect(next[0].environments).toEqual(["prod"]);
    expect(next[0].allEnvironments).toBe(false);
  });

  it("throws on bad index", () => {
    const rules = [envRule("a", "dev")];
    expect(() => removeRuleAtEnvIndex(rules, "dev", 5)).toThrow(
      "Invalid rule index",
    );
  });
});

describe("moveRuleInEnv", () => {
  it("reorders within env projection; other-env rules keep positions", () => {
    const dev1 = envRule("dev1", "dev");
    const prod1 = envRule("prod1", "prod");
    const dev2 = envRule("dev2", "dev");
    const shared = allEnvRule("shared");
    const dev3 = envRule("dev3", "dev");
    const rules = [dev1, prod1, dev2, shared, dev3];

    // dev projection = [dev1, dev2, shared, dev3]; move 0 → 2 → [dev2, shared, dev1, dev3]
    const { rules: next, moved } = moveRuleInEnv(rules, "dev", 0, 2);
    expect(moved).toBe(dev1);
    expect(next).toEqual([dev2, prod1, shared, dev1, dev3]);
  });

  it("is a no-op when from === to", () => {
    const dev1 = envRule("dev1", "dev");
    const prod1 = envRule("prod1", "prod");
    const rules = [dev1, prod1];
    const { rules: next } = moveRuleInEnv(rules, "dev", 0, 0);
    expect(next).toEqual([dev1, prod1]);
  });

  it("throws on bad indices", () => {
    const rules = [envRule("a", "dev")];
    expect(() => moveRuleInEnv(rules, "dev", 0, 1)).toThrow(
      "Invalid rule index",
    );
  });
});

describe("stampRuleForEnvs", () => {
  it("forces allEnvironments=false and sets environments[]", () => {
    const r = allEnvRule("x");
    const stamped = stampRuleForEnvs(r, ["dev"]);
    expect(stamped.allEnvironments).toBe(false);
    expect(stamped.environments).toEqual(["dev"]);
  });
});
