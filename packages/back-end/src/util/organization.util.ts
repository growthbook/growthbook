import type Stripe from "stripe";
import {
  AccountPlan,
  CommercialFeature,
  CommercialFeaturesMap,
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
  pro: new Set<CommercialFeature>(["env-permissions"]),
  pro_sso: new Set<CommercialFeature>(["sso", "env-permissions"]),
  enterprise: new Set<CommercialFeature>(["sso", "env-permissions"]),
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

export const GLOBAL_PERMISSIONS = [
  "addComments",
  "runQueries",
  "createPresentations",
  "createIdeas",
  "createAnalyses",
  "createMetrics",
  "createDimensions",
  "createSegments",
  "editDatasourceSettings",
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
  "manageFeatures",
] as const;
export const ENV_SCOPED_PERMISSIONS = ["publishFeatures"] as const;

export const ALL_PERMISSIONS = [
  ...GLOBAL_PERMISSIONS,
  ...ENV_SCOPED_PERMISSIONS,
];

export function getPermissionsByRole(
  role: MemberRoleInfo,
  org: OrganizationInterface
): Permission[] {
  const roles = getRoles(org);
  const orgRole = roles.find((r) => r.id === role.role);
  const permissions = new Set<Permission>(orgRole?.permissions || []);

  // If limiting access by environment, swap global permissions with env-scoped ones
  if (role.limitAccessByEnvironment) {
    ENV_SCOPED_PERMISSIONS.forEach((p) => {
      if (permissions.has(p)) {
        permissions.delete(p);
        role.environments.forEach((env) => {
          permissions.add(`${p}.${env}`);
        });
      }
    });
  }

  return [...permissions];
}

// eslint-disable-next-line
export function getRoles(organization: OrganizationInterface): Role[] {
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
      default: true,
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
      description: "Analyze Experiments",
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
      description: "Manage features AND analyze experiments",
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
