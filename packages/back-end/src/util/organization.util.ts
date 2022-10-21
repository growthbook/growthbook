import type Stripe from "stripe";
import {
  AccountPlan,
  AccountPlanFeature,
  AccountPlanFeatures,
  MemberRole,
  OrganizationInterface,
  Permission,
} from "../../types/organization";
import { getLicense } from "../init/license";
import { IS_CLOUD } from "./secrets";

export function isActiveSubscriptionStatus(
  status?: Stripe.Subscription.Status
) {
  return ["active", "trialing", "past_due"].includes(status || "");
}
export const accountFeatures: AccountPlanFeatures = {
  starter: new Set([]),
  pro: new Set(["customRoles"]),
  pro_sso: new Set(["sso", "customRoles"]),
  enterprise: new Set(["sso", "customRoles"]),
};
export function getAccountPlan(org: OrganizationInterface): AccountPlan {
  if (IS_CLOUD) {
    if (org.enterprise) return "enterprise";
    if (org.restrictAuthSubPrefix || org.restrictLoginMethod) return "pro_sso";
    if (isActiveSubscriptionStatus(org.subscription?.status)) return "pro";
    return "starter";
  }

  if (getLicense()) return "enterprise";
  return "starter";
}
export function orgHasPremiumFeature(
  org: OrganizationInterface,
  feature: AccountPlanFeature
): boolean {
  return accountFeatures[getAccountPlan(org)].has(feature);
}

export const ALL_PERMISSIONS = [
  "addComments",
  "runQueries",
  "createPresentations",
  "createIdeas",
  "createAnalyses",
  "createMetrics",
  "createDimensions",
  "createSegments",
  "editDatasourceSettings",
  "publishFeatures",
  "createFeatures",
  "createFeatureDrafts",
  "organizationSettings",
  "createDatasources",
  "superDelete",
  "manageTeam",
  "manageTags",
  "manageProjects",
  "manageApiKeys",
  "manageWebhooks",
  "manageBilling",
  "manageNorthStarMetric",
  "manageTargetingAttributes",
  "manageNamespaces",
  "manageEnvironments",
  "manageSavedGroups",
] as const;

export function getPermissionsByRole(
  role: MemberRole,
  org: OrganizationInterface
): Permission[] {
  return org.roles.find((r) => r.id === role)?.permissions || [];
}
