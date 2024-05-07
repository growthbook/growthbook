import { getAccountPlan } from "../src";

describe("Entitlements", () => {
  it("Determines account plan", () => {
    expect(getAccountPlan({})).toBe("oss");

    process.env.IS_CLOUD = "true";
    expect(getAccountPlan({})).toBe("starter");
    expect(
      getAccountPlan({
        enterprise: true,
      }),
    ).toBe("enterprise");
    expect(
      getAccountPlan({
        restrictAuthSubPrefix: "something",
      }),
    ).toBe("pro_sso");
    expect(
      getAccountPlan({
        restrictLoginMethod: "something",
      }),
    ).toBe("pro_sso");
    expect(
      getAccountPlan({
        subscription: {
          status: "canceled",
        },
      }),
    ).toBe("starter");
    expect(
      getAccountPlan({
        subscription: {
          status: "active",
        },
      }),
    ).toBe("pro");
    expect(
      getAccountPlan({
        subscription: {
          status: "trialing",
        },
      }),
    ).toBe("pro");
    expect(
      getAccountPlan({
        subscription: {
          status: "past_due",
        },
      }),
    ).toBe("pro");
  });
});
