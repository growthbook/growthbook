import { getAccountPlan } from "back-end/src/enterprise";

describe("Entitlements", () => {
  it("Determines account plan", () => {
    expect(getAccountPlan({ id: "test-org" })).toBe("oss");

    process.env.IS_CLOUD = "true";
    expect(getAccountPlan({ id: "test-org" })).toBe("starter");
    expect(
      getAccountPlan({
        id: "test-org",
        enterprise: true,
      }),
    ).toBe("enterprise");
    expect(
      getAccountPlan({
        id: "test-org",
        restrictAuthSubPrefix: "something",
      }),
    ).toBe("pro_sso");
    expect(
      getAccountPlan({
        id: "test-org",
        restrictLoginMethod: "something",
      }),
    ).toBe("pro_sso");
    expect(
      getAccountPlan({
        id: "test-org",
      }),
    ).toBe("starter");
  });
});
