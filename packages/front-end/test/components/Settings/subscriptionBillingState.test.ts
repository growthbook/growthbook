import { describe, it, expect } from "vitest";
import { date } from "shared/dates";
import type { SubscriptionInfo } from "shared/enterprise";
import { getSubscriptionBillingState } from "@/components/Settings/subscriptionBillingState";

function formatted(value: string): string {
  return date(new Date(value));
}

function sub(overrides: Partial<SubscriptionInfo> = {}): SubscriptionInfo {
  return {
    externalId: "sub_123",
    trialEnd: null,
    status: "active",
    hasPaymentMethod: true,
    nextBillDate: "Thu Oct 01 2026",
    dateToBeCanceled: "",
    cancelationDate: "",
    pendingCancelation: false,
    isVercelIntegration: false,
    billingPlatform: "orb",
    stripeCustomerId: "cus_123",
    ...overrides,
  };
}

describe("getSubscriptionBillingState", () => {
  it("self-serve active: next bill date and cancel action", () => {
    const state = getSubscriptionBillingState({
      subscription: sub(),
      accountPlan: "pro",
      canSubscribe: false,
    });
    expect(state.kind).toBe("self_serve_active");
    if (state.kind !== "self_serve_active") return;
    expect(state.nextBillDate).toBe(formatted("Thu Oct 01 2026"));
    expect(state.paymentMethodNotice).toBe("valid");
    expect(state.showCancelButton).toBe(true);
  });

  it("self-serve pending cancel: hides next bill, shows access-until date", () => {
    const state = getSubscriptionBillingState({
      subscription: sub({
        pendingCancelation: true,
        dateToBeCanceled: "Thu Oct 01 2026",
      }),
      accountPlan: "pro",
      canSubscribe: false,
    });
    expect(state.kind).toBe("self_serve_pending_cancel");
    if (state.kind !== "self_serve_pending_cancel") return;
    expect(state.pendingCancelDate).toBe(formatted("Thu Oct 01 2026"));
    expect(state.showCancelButton).toBe(false);
  });

  it("canceled wins over enterprise contract dates", () => {
    const state = getSubscriptionBillingState({
      subscription: sub({
        status: "canceled",
        cancelationDate: "Mon Aug 03 2026",
        dateToBeCanceled: "Thu Dec 31 2026",
        pendingCancelation: true,
      }),
      accountPlan: "enterprise",
      canSubscribe: true,
    });
    expect(state.kind).toBe("canceled");
    if (state.kind !== "canceled") return;
    expect(state.cancelationDate).toBe(formatted("Mon Aug 03 2026"));
    expect(state.showRenewButton).toBe(true);
    expect(state.showCancelButton).toBe(false);
  });

  it("enterprise active: next bill date, no missing-payment warning", () => {
    const state = getSubscriptionBillingState({
      subscription: sub({ hasPaymentMethod: false }),
      accountPlan: "enterprise",
      canSubscribe: false,
    });
    expect(state.kind).toBe("enterprise_active");
    if (state.kind !== "enterprise_active") return;
    expect(state.nextBillDate).toBe(formatted("Thu Oct 01 2026"));
    expect(state.paymentMethodNotice).toBe("none");
    expect(state.showCancelButton).toBe(false);
  });

  it("enterprise contract ending: keeps both dates when next bill is earlier", () => {
    const state = getSubscriptionBillingState({
      subscription: sub({
        pendingCancelation: true,
        nextBillDate: "Thu Oct 01 2026",
        dateToBeCanceled: "Thu Dec 31 2026",
      }),
      accountPlan: "enterprise",
      canSubscribe: false,
    });
    expect(state.kind).toBe("enterprise_contract_ending");
    if (state.kind !== "enterprise_contract_ending") return;
    expect(state.contractExpirationDate).toBe(formatted("Thu Dec 31 2026"));
    expect(state.nextBillDate).toBe(formatted("Thu Oct 01 2026"));
    expect(state.contractExpirationHelper).toBe(
      "Billing continues until the contract ends.",
    );
  });

  it("enterprise contract ending: hides next bill when it matches contract end", () => {
    const state = getSubscriptionBillingState({
      subscription: sub({
        pendingCancelation: true,
        nextBillDate: "Thu Dec 31 2026",
        dateToBeCanceled: "Thu Dec 31 2026",
      }),
      accountPlan: "enterprise",
      canSubscribe: false,
    });
    expect(state.kind).toBe("enterprise_contract_ending");
    if (state.kind !== "enterprise_contract_ending") return;
    expect(state.nextBillDate).toBeNull();
    expect(state.contractExpirationHelper).toBe(
      "You will continue to be billed until this date.",
    );
  });
});
