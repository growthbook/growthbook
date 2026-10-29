import { linkedFeatureEnvStates } from "shared/util";

describe("linkedFeatureEnvStates", () => {
  it("combines each environment's flag toggle and rule", () => {
    expect(
      linkedFeatureEnvStates({
        a: { flagEnabled: true, rule: "on" },
        b: { flagEnabled: true, rule: "off" },
        c: { flagEnabled: false, rule: "on" },
        d: { flagEnabled: false, rule: "missing" },
      }),
    ).toEqual({
      a: "active",
      b: "disabled-rule",
      c: "disabled-env",
      d: "missing",
    });
  });
});
