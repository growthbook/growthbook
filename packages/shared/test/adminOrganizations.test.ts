import { getAdminOrgSummary } from "../src/enterprise/adminOrganizations";

const sub = (id: string, status: "active" | "past_due" | "canceled") =>
  ({ id, status }) as never;

describe("getAdminOrgSummary", () => {
  it("treats orgs without a license as Starter and active", () => {
    expect(getAdminOrgSummary({}, null)).toEqual({
      plan: "starter",
      status: "active",
      seats: null,
    });
  });

  it("uses the legacy enterprise flag over the license plan", () => {
    expect(
      getAdminOrgSummary({ enterprise: true }, {
        plan: "pro",
        seats: 5,
      } as never).plan,
    ).toBe("enterprise");
  });

  it("puts disabled ahead of suspended ahead of the subscription", () => {
    const license = { orbSubscription: sub("orb_1", "past_due") } as never;
    expect(
      getAdminOrgSummary({ disabled: true, suspended: true }, license).status,
    ).toBe("disabled");
    expect(getAdminOrgSummary({ suspended: true }, license).status).toBe(
      "suspended",
    );
    expect(getAdminOrgSummary({}, license).status).toBe("past_due");
  });

  it("reads the Orb subscription before the Stripe one", () => {
    const license = {
      orbSubscription: sub("orb_1", "active"),
      stripeSubscription: sub("sub_1", "canceled"),
    } as never;
    expect(getAdminOrgSummary({}, license).status).toBe("active");
  });

  it("falls back to Stripe when the Orb subscription has no id", () => {
    const license = {
      orbSubscription: sub("", "active"),
      stripeSubscription: sub("sub_1", "canceled"),
    } as never;
    expect(getAdminOrgSummary({}, license).status).toBe("canceled");
  });

  it("marks trial licenses without a subscription as trialing", () => {
    expect(
      getAdminOrgSummary({}, {
        plan: "enterprise",
        isTrial: true,
        seats: 20,
      } as never),
    ).toEqual({ plan: "enterprise", status: "trialing", seats: 20 });
  });
});
