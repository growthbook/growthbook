import { dropStaleForceCoverage } from "../src/validators/features";

const base = {
  id: "fr_1",
  description: "",
  enabled: true,
  allEnvironments: true,
  value: "true",
};

describe("dropStaleForceCoverage", () => {
  it("drops sub-100% coverage from a force rule", () => {
    const out = dropStaleForceCoverage<Record<string, unknown>>({
      ...base,
      type: "force",
      coverage: 0.98,
    });
    expect(out.coverage).toBeUndefined();
    expect(out.type).toBe("force");
  });

  it("keeps the hash settings ramps read off force rules", () => {
    const out = dropStaleForceCoverage<Record<string, unknown>>({
      ...base,
      type: "force",
      coverage: 0.98,
      hashAttribute: "user_id",
      seed: "cohort-1",
      hashVersion: 1,
    });
    expect(out.hashAttribute).toBe("user_id");
    expect(out.seed).toBe("cohort-1");
    expect(out.hashVersion).toBe(1);
  });

  it("leaves a force rule at full coverage untouched", () => {
    const rule = { ...base, type: "force", coverage: 1 };
    expect(dropStaleForceCoverage(rule)).toBe(rule);
  });

  it("leaves rollouts untouched", () => {
    const rule = { ...base, type: "rollout", coverage: 0.5 };
    expect(dropStaleForceCoverage(rule)).toBe(rule);
  });
});
