import {
  getAdminOrgSummary,
  isOrbPaymentPastDue,
  orbPaymentFailureCancelAt,
} from "../src/enterprise/adminOrganizations";

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

  it("marks an active Orb subscription with an open invoice as past due", () => {
    const license = {
      orbSubscription: sub("orb_1", "active"),
      paymentFailure: {
        invoiceId: "inv_1",
        downgradeAt: "2026-11-19T00:00:00.000Z",
      },
    } as never;
    expect(isOrbPaymentPastDue(license)).toBe(true);
    expect(getAdminOrgSummary({}, license).status).toBe("past_due");
  });

  it("is not past due once the payment failure is cleared", () => {
    const license = { orbSubscription: sub("orb_1", "active") } as never;
    expect(isOrbPaymentPastDue(license)).toBe(false);
    expect(getAdminOrgSummary({}, license).status).toBe("active");
  });

  it("ignores a stale payment failure on a canceled subscription", () => {
    const license = {
      orbSubscription: sub("orb_1", "canceled"),
      paymentFailure: {
        invoiceId: "inv_1",
        downgradeAt: "2026-11-19T00:00:00.000Z",
      },
    } as never;
    expect(isOrbPaymentPastDue(license)).toBe(false);
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

describe("orbPaymentFailureCancelAt", () => {
  const downgradeAt = "2026-11-19T00:00:00.000Z";

  it("keeps the deadline when auto-cancel was not recorded", () => {
    expect(orbPaymentFailureCancelAt({ downgradeAt })).toBe(downgradeAt);
  });

  it("keeps the deadline when auto-cancel is on", () => {
    expect(
      orbPaymentFailureCancelAt({
        downgradeAt,
        autoCancel: true,
      }),
    ).toBe(downgradeAt);
  });

  it("hides the deadline when this failure will not cancel the plan", () => {
    expect(
      orbPaymentFailureCancelAt({
        downgradeAt,
        autoCancel: false,
      }),
    ).toBeNull();
  });

  it("hides the deadline once the cancel time is cleared", () => {
    expect(orbPaymentFailureCancelAt({ autoCancel: false })).toBeNull();
  });
});
