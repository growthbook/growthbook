import { date, daysBetween } from "shared/dates";
import type { AccountPlan, SubscriptionInfo } from "shared/enterprise";

export type SubscriptionBillingKind =
  | "canceled"
  | "self_serve_pending_cancel"
  | "self_serve_active"
  | "enterprise_active"
  | "enterprise_contract_ending";

export type PaymentMethodNotice = "none" | "valid" | "missing";

export type SubscriptionBillingInput = {
  subscription: SubscriptionInfo | null;
  accountPlan: AccountPlan | undefined;
  canSubscribe: boolean;
};

type BillingActions = {
  showStripeManageButton: boolean;
  showUpdateInvoiceButton: boolean;
  showRenewButton: boolean;
  showCancelButton: boolean;
  invoiceBlocked: boolean;
};

type BillingBase = BillingActions & {
  isTrialing: boolean;
};

export type SubscriptionBillingState =
  | (BillingBase & {
      kind: "canceled";
      cancelationDate: string | null;
    })
  | (BillingBase & {
      kind: "self_serve_pending_cancel";
      pendingCancelDate: string | null;
    })
  | (BillingBase & {
      kind: "self_serve_active";
      nextBillDate: string | null;
      paymentMethodNotice: PaymentMethodNotice;
    })
  | (BillingBase & {
      kind: "enterprise_active";
      nextBillDate: string | null;
      paymentMethodNotice: PaymentMethodNotice;
    })
  | (BillingBase & {
      kind: "enterprise_contract_ending";
      contractExpirationDate: string;
      contractExpirationHelper: string;
      nextBillDate: string | null;
      paymentMethodNotice: PaymentMethodNotice;
    });

function parseBillingDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  // Backend formats missing Stripe cancel_at / period end as epoch
  // (e.g. "Wed Dec 31 1969").
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() <= 1970) {
    return null;
  }
  return parsed;
}

function formatBillingDate(value: string | undefined): string | null {
  const parsed = parseBillingDate(value);
  return parsed ? date(parsed) : null;
}

function isSameOrAdjacentDay(a: Date, b: Date): boolean {
  if (date(a) === date(b)) return true;
  return Math.abs(daysBetween(a, b)) <= 1;
}

function getActions(
  subscription: SubscriptionInfo | null,
  isEnterprise: boolean,
  canSubscribe: boolean,
): BillingActions {
  const isOrb = subscription?.billingPlatform === "orb";
  const isActive = subscription?.status === "active";

  return {
    showStripeManageButton: subscription?.billingPlatform === "stripe",
    showUpdateInvoiceButton:
      isOrb && isActive && !!subscription?.stripeCustomerId,
    showRenewButton: subscription?.status === "canceled" && canSubscribe,
    showCancelButton:
      isOrb &&
      isActive &&
      !!parseBillingDate(subscription?.nextBillDate) &&
      !subscription?.pendingCancelation &&
      !isEnterprise,
    invoiceBlocked: isOrb && isActive && !subscription?.stripeCustomerId,
  };
}

export function getSubscriptionBillingState({
  subscription,
  accountPlan,
  canSubscribe,
}: SubscriptionBillingInput): SubscriptionBillingState {
  const isEnterprise = accountPlan === "enterprise";
  const isTrialing = subscription?.status === "trialing";
  const actions = getActions(subscription, isEnterprise, canSubscribe);

  if (subscription?.status === "canceled") {
    return {
      kind: "canceled",
      isTrialing: false,
      cancelationDate: formatBillingDate(subscription.cancelationDate),
      ...actions,
    };
  }

  if (isEnterprise) {
    const contractExpiration = parseBillingDate(subscription?.dateToBeCanceled);
    const nextBill = parseBillingDate(subscription?.nextBillDate);
    const notice: PaymentMethodNotice =
      subscription?.hasPaymentMethod === true ? "valid" : "none";

    if (contractExpiration) {
      const hideNextBill =
        !!nextBill && isSameOrAdjacentDay(contractExpiration, nextBill);
      return {
        kind: "enterprise_contract_ending",
        isTrialing,
        contractExpirationDate: date(contractExpiration),
        contractExpirationHelper: hideNextBill
          ? "You will continue to be billed until this date."
          : "Billing continues until the contract ends.",
        nextBillDate: hideNextBill || !nextBill ? null : date(nextBill),
        paymentMethodNotice: notice,
        ...actions,
      };
    }

    return {
      kind: "enterprise_active",
      isTrialing,
      nextBillDate: nextBill ? date(nextBill) : null,
      paymentMethodNotice: notice,
      ...actions,
    };
  }

  if (subscription?.pendingCancelation) {
    return {
      kind: "self_serve_pending_cancel",
      isTrialing,
      pendingCancelDate: formatBillingDate(subscription.dateToBeCanceled),
      ...actions,
    };
  }

  return {
    kind: "self_serve_active",
    isTrialing,
    nextBillDate: formatBillingDate(subscription?.nextBillDate),
    paymentMethodNotice:
      subscription?.hasPaymentMethod === true
        ? "valid"
        : subscription?.hasPaymentMethod === false
          ? "missing"
          : "none",
    ...actions,
  };
}
