import type { OrganizationInterface } from "shared/types/organization";
import type { AccountPlan, LicenseInterface } from "./license-consts";

export type AdminOrgStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "suspended"
  | "disabled";

export type AdminOrgSummary = {
  plan: AccountPlan;
  status: AdminOrgStatus;
  seats: number | null;
};

// Orb keeps a declining subscription active; our open payment failure marks it past due.
export function isOrbPaymentPastDue(
  license: Pick<LicenseInterface, "orbSubscription" | "paymentFailure"> | null,
): boolean {
  return (
    !!license?.orbSubscription?.id &&
    license.orbSubscription.status === "active" &&
    !!license.paymentFailure?.invoiceId
  );
}

// Unlike getAccountPlan, this skips the legacy pro_sso fallback for orgs
// without a license, so the admin plan filter can match it with a licenses query.
export function getAdminOrgSummary(
  org: Pick<OrganizationInterface, "enterprise" | "suspended" | "disabled">,
  license: Pick<
    LicenseInterface,
    | "plan"
    | "seats"
    | "isTrial"
    | "orbSubscription"
    | "stripeSubscription"
    | "paymentFailure"
  > | null,
): AdminOrgSummary {
  return {
    plan: org.enterprise ? "enterprise" : license?.plan || "starter",
    status: getAdminOrgStatus(org, license),
    seats: license?.seats ?? null,
  };
}

function getAdminOrgStatus(
  org: Pick<OrganizationInterface, "suspended" | "disabled">,
  license: Pick<
    LicenseInterface,
    "isTrial" | "orbSubscription" | "stripeSubscription" | "paymentFailure"
  > | null,
): AdminOrgStatus {
  if (org.disabled) return "disabled";
  if (org.suspended) return "suspended";
  if (isOrbPaymentPastDue(license)) return "past_due";
  // Same precedence as getSubscriptionFromLicense: Orb first, then Stripe
  const sub = license?.orbSubscription?.id
    ? license.orbSubscription
    : license?.stripeSubscription?.id
      ? license.stripeSubscription
      : null;
  if (
    sub?.status === "past_due" ||
    sub?.status === "canceled" ||
    sub?.status === "trialing"
  ) {
    return sub.status;
  }
  if (license?.isTrial) return "trialing";
  return "active";
}
