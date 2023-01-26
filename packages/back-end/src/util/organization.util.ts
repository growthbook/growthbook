import type Stripe from "stripe";
import {
  AccountPlan,
  CommercialFeature,
  CommercialFeaturesMap,
  MemberRole,
  MemberRoleInfo,
  OrganizationInterface,
  Permission,
  Role,
} from "../../types/organization";
import { getLicense } from "../init/license";
import { IS_CLOUD } from "./secrets";

export function isActiveSubscriptionStatus(
  status?: Stripe.Subscription.Status
) {
  return ["active", "trialing", "past_due"].includes(status || "");
}
export const accountFeatures: CommercialFeaturesMap = {
  oss: new Set<CommercialFeature>([]),
  starter: new Set<CommercialFeature>([]),
  pro: new Set<CommercialFeature>([
    "advanced-permissions",
    "encrypt-features-endpoint",
    "schedule-feature-flag",
    "override-metrics",
  ]),
  pro_sso: new Set<CommercialFeature>([
    "sso",
    "advanced-permissions",
    "encrypt-features-endpoint",
    "schedule-feature-flag",
    "override-metrics",
  ]),
  enterprise: new Set<CommercialFeature>([
    "sso",
    "advanced-permissions",
    "encrypt-features-endpoint",
    "schedule-feature-flag",
    "override-metrics",
  ]),
};
export function getAccountPlan(org: OrganizationInterface): AccountPlan {
  if (IS_CLOUD) {
    if (org.enterprise) return "enterprise";
    if (org.restrictAuthSubPrefix || org.restrictLoginMethod) return "pro_sso";
    if (isActiveSubscriptionStatus(org.subscription?.status)) return "pro";
    return "starter";
  }

  // For self-hosted deployments
  return getLicense()?.plan || "oss";
}
export function planHasPremiumFeature(
  plan: AccountPlan,
  feature: CommercialFeature
): boolean {
  return accountFeatures[plan].has(feature);
}
export function orgHasPremiumFeature(
  org: OrganizationInterface,
  feature: CommercialFeature
): boolean {
  return planHasPremiumFeature(getAccountPlan(org), feature);
}

export const ENV_SCOPED_PERMISSIONS = [
  "publishFeatures",
  "manageEnvironments",
] as const;

export const PROJECT_SCOPED_PERMISSIONS = [
  "addComments",
  "createFeatureDrafts",
  "manageFeatures",
  "createAnalyses",
  "createIdeas",
  "createMetrics",
  "createDatasources",
  "editDatasourceSettings",
  "runQueries",
] as const;

export const GLOBAL_PERMISSIONS = [
  "createPresentations",
  "createDimensions",
  "createSegments",
  "organizationSettings",
  "superDelete",
  "manageTeam",
  "manageTags",
  "manageProjects",
  "manageApiKeys",
  "manageIntegrations",
  "manageWebhooks",
  "manageBilling",
  "manageNorthStarMetric",
  "manageTargetingAttributes",
  "manageNamespaces",
  "manageSavedGroups",
  "viewEvents",
] as const;

export const ALL_PERMISSIONS = [
  ...GLOBAL_PERMISSIONS,
  ...PROJECT_SCOPED_PERMISSIONS,
  ...ENV_SCOPED_PERMISSIONS,
];

export function getPermissionsByRole(
  role: MemberRole,
  org: OrganizationInterface
): Permission[] {
  const roles = getRoles(org);
  const orgRole = roles.find((r) => r.id === role);
  const permissions = new Set<Permission>(orgRole?.permissions || []);
  return Array.from(permissions);
}

export function getRoles(_organization: OrganizationInterface): Role[] {
  // TODO: support custom roles?
  return [
    {
      id: "readonly",
      description: "View all features and experiment results",
      permissions: [],
    },
    {
      id: "collaborator",
      description: "Add comments and contribute ideas",
      permissions: ["addComments", "createIdeas", "createPresentations"],
    },
    {
      id: "engineer",
      description: "Manage features",
      permissions: [
        "addComments",
        "createIdeas",
        "createPresentations",
        "publishFeatures",
        "manageFeatures",
        "createFeatureDrafts",
        "manageTargetingAttributes",
        "manageEnvironments",
        "manageNamespaces",
        "manageSavedGroups",
      ],
    },
    {
      id: "analyst",
      description: "Analyze experiments",
      permissions: [
        "addComments",
        "createIdeas",
        "createPresentations",
        "createAnalyses",
        "createDimensions",
        "createMetrics",
        "runQueries",
        "editDatasourceSettings",
      ],
    },
    {
      id: "experimenter",
      description: "Manage features AND Analyze experiments",
      permissions: [
        "addComments",
        "createIdeas",
        "createPresentations",
        "publishFeatures",
        "manageFeatures",
        "createFeatureDrafts",
        "manageTargetingAttributes",
        "manageEnvironments",
        "manageNamespaces",
        "manageSavedGroups",
        "createAnalyses",
        "createDimensions",
        "createSegments",
        "createMetrics",
        "runQueries",
        "editDatasourceSettings",
      ],
    },
    {
      id: "admin",
      description:
        "All access + invite teammates and configure organization settings",
      permissions: [...ALL_PERMISSIONS],
    },
  ];
}

export function getDefaultRole(
  organization: OrganizationInterface
): MemberRoleInfo {
  return (
    organization.settings?.defaultRole || {
      environments: [],
      limitAccessByEnvironment: false,
      role: "collaborator",
    }
  );
}
