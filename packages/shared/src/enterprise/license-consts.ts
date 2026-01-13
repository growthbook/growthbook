import type Stripe from "stripe";
import { stringToBoolean } from "../util";

export type AccountPlan = "oss" | "starter" | "pro" | "pro_sso" | "enterprise";
export const accountPlans: Set<AccountPlan> = new Set([
  "oss",
  "starter",
  "pro",
  "pro_sso",
  "enterprise",
]);

export type CommercialFeature =
  | "ai-suggestions"
  | "scim"
  | "sso"
  | "advanced-permissions"
  | "encrypt-features-endpoint"
  | "schedule-feature-flag"
  | "custom-metadata"
  | "override-metrics"
  | "regression-adjustment"
  | "post-stratification"
  | "sequential-testing"
  | "pipeline-mode"
  | "audit-logging"
  | "visual-editor"
  | "archetypes"
  | "simulate"
  | "cloud-proxy"
  | "hash-secure-attributes"
  | "livechat"
  | "json-validation"
  | "remote-evaluation"
  | "multi-org"
  | "custom-launch-checklist"
  | "multi-metric-queries"
  | "no-access-role"
  | "teams"
  | "sticky-bucketing"
  | "require-approvals"
  | "code-references"
  | "prerequisites"
  | "prerequisite-targeting"
  | "redirects"
  | "multiple-sdk-webhooks"
  | "custom-roles"
  | "quantile-metrics"
  | "retention-metrics"
  | "custom-markdown"
  | "experiment-impact"
  | "metric-populations"
  | "large-saved-groups"
  | "multi-armed-bandits"
  | "metric-groups"
  | "environment-inheritance"
  | "templates"
  | "historical-power"
  | "decision-framework"
  | "unlimited-cdn-usage"
  | "unlimited-managed-warehouse-usage"
  | "safe-rollout"
  | "require-project-for-features-setting"
  | "holdouts"
  | "saveSqlExplorerQueries"
  | "metric-effects"
  | "metric-correlations"
  | "dashboards"
  | "product-analytics-dashboards"
  | "share-product-analytics-dashboards"
  | "precomputed-dimensions"
  | "custom-hooks"
  | "metric-slices"
  | "manage-official-resources"
  | "incremental-refresh";

export type CommercialFeaturesMap = Record<AccountPlan, Set<CommercialFeature>>;

export type SubscriptionInfo = {
  billingPlatform?: "stripe" | "orb";
  externalId: string;
  trialEnd: Date | null;
  status: "active" | "canceled" | "past_due" | "trialing" | "";
  hasPaymentMethod: boolean;
  nextBillDate: string;
  dateToBeCanceled: string;
  cancelationDate: string;
  pendingCancelation: boolean;
  isVercelIntegration: boolean;
};

export interface LicenseInterface {
  id: string; // Unique ID for the license key
  companyName: string; // Name of the organization on the license
  organizationId?: string; // OrganizationId (keys prior to 12/2022 do not contain this field)
  seats: number; // Maximum number of seats on the license
  hardCap: boolean; // True if this license has a hard cap on the number of seats
  dateCreated: string; // Date the license was issued
  dateExpires: string; // Date the license expires
  name: string; // Name of the person who signed up for the license
  email: string; // Billing email of the person who signed up for the license
  emailVerified: boolean; // True if the email has been verified
  isTrial: boolean; // True if this is a trial license
  plan?: AccountPlan; // The assigned plan (pro, enterprise, etc.) for this license
  seatsInUse: number; // Number of seats currently in use
  remoteDowngrade: boolean; // True if the license was downgraded remotely
  message?: {
    text: string; // The text to show in the account notice
    className: string; // The class name to apply to the account notice
    tooltipText: string; // The text to show in the tooltip
    showAllUsers: boolean; // True if all users should see the notice rather than just the admins
  };
  vercelInstallationId?: string;
  stripeSubscription?: {
    id: string;
    qty: number;
    trialEnd: Date | null;
    status: Stripe.Subscription.Status;
    current_period_end: number;
    cancel_at: number | null;
    canceled_at: number | null;
    cancel_at_period_end: boolean;
    planNickname: string | null;
    priceId?: string;
    price?: number; // The price of the license
    discountAmount?: number; // The amount of the discount
    discountMessage?: string; // The message of the discount
    hasPaymentMethod?: boolean;
  };
  orbSubscription?: {
    id: string;
    customerId: string;
    qty: number;
    trialEnd: Date | null;
    status: Stripe.Subscription.Status;
    current_period_end: number;
    cancel_at: number | null;
    canceled_at: number | null;
    cancel_at_period_end: boolean;
    planId: string;
    hasPaymentMethod: boolean;
  };
  freeTrialDate?: Date; // Date the free trial was started
  installationUsers: {
    [installationId: string]: {
      date: string;
      installationName?: string;
      userHashes: string[];
      licenseUserCodes?: LicenseUserCodes;
    };
  }; // Map of first 7 chars of user email shas to the last time they were in a usage request
  archived: boolean; // True if this license has been deleted/archived
  dateUpdated: string; // Date the license was last updated
  usingMongoCache: boolean; // True if the license data was retrieved from the cache
  firstFailedFetchDate?: Date; // Date of the first failed fetch
  lastFailedFetchDate?: Date; // Date of the last failed fetch
  lastServerErrorMessage?: string; // The last error message from a failed fetch
  signedChecksum: string; // Checksum of the license data signed with the private key
}

// Old/Airgapped style license keys where the license data is encrypted in the key itself
export type LicenseData = {
  // Unique id for the license key
  ref: string;
  // Name of organization on the license
  sub: string;
  // Organization ID (keys prior to 12/2022 do not contain this field)
  org?: string;
  // Max number of seats
  qty: number;
  // True if this license has a hard cap on the number of seats (keys prior to 03/2024 do not contain this field)
  hardCap?: boolean;
  // Date issued
  iat: string;
  // Expiration date
  exp: string;
  // If it's a trial or not
  trial: boolean;
  // The plan (pro, enterprise, etc.)
  plan: AccountPlan;
  /**
   * Expiration date (old style)
   * @deprecated
   */
  eat?: string;
};

export const accountFeatures: CommercialFeaturesMap = {
  oss: new Set<CommercialFeature>([]),
  starter: new Set<CommercialFeature>([]),
  pro: new Set<CommercialFeature>([
    "advanced-permissions",
    "encrypt-features-endpoint",
    "schedule-feature-flag",
    "override-metrics",
    "regression-adjustment",
    "sequential-testing",
    "visual-editor",
    "archetypes",
    "simulate",
    "cloud-proxy",
    "hash-secure-attributes",
    "livechat",
    "remote-evaluation",
    "sticky-bucketing",
    "code-references",
    "prerequisites",
    "redirects",
    "multiple-sdk-webhooks",
    "quantile-metrics",
    "retention-metrics",
    "metric-populations",
    "multi-armed-bandits",
    "historical-power",
    "decision-framework",
    "safe-rollout",
    "unlimited-managed-warehouse-usage",
    "saveSqlExplorerQueries",
    "precomputed-dimensions",
    "product-analytics-dashboards",
  ]),
  pro_sso: new Set<CommercialFeature>([
    "sso",
    "advanced-permissions",
    "encrypt-features-endpoint",
    "schedule-feature-flag",
    "override-metrics",
    "regression-adjustment",
    "sequential-testing",
    "visual-editor",
    "archetypes",
    "simulate",
    "cloud-proxy",
    "hash-secure-attributes",
    "livechat",
    "remote-evaluation",
    "sticky-bucketing",
    "code-references",
    "prerequisites",
    "redirects",
    "multiple-sdk-webhooks",
    "quantile-metrics",
    "retention-metrics",
    "metric-populations",
    "multi-armed-bandits",
    "historical-power",
    "decision-framework",
    "safe-rollout",
    "unlimited-managed-warehouse-usage",
    "saveSqlExplorerQueries",
    "precomputed-dimensions",
    "product-analytics-dashboards",
  ]),
  enterprise: new Set<CommercialFeature>([
    "ai-suggestions",
    "scim",
    "sso",
    "advanced-permissions",
    "audit-logging",
    "encrypt-features-endpoint",
    "schedule-feature-flag",
    "custom-metadata",
    "override-metrics",
    "regression-adjustment",
    "post-stratification",
    "sequential-testing",
    "pipeline-mode",
    "multi-metric-queries",
    "visual-editor",
    "archetypes",
    "simulate",
    "cloud-proxy",
    "hash-secure-attributes",
    "json-validation",
    "livechat",
    "remote-evaluation",
    "multi-org",
    "teams",
    "custom-launch-checklist",
    "no-access-role",
    "sticky-bucketing",
    "require-approvals",
    "code-references",
    "prerequisites",
    "prerequisite-targeting",
    "redirects",
    "multiple-sdk-webhooks",
    "quantile-metrics",
    "retention-metrics",
    "custom-roles",
    "custom-markdown",
    "experiment-impact",
    "metric-populations",
    "large-saved-groups",
    "multi-armed-bandits",
    "metric-groups",
    "environment-inheritance",
    "templates",
    "historical-power",
    "decision-framework",
    "safe-rollout",
    "unlimited-managed-warehouse-usage",
    "require-project-for-features-setting",
    "holdouts",
    "saveSqlExplorerQueries",
    "metric-effects",
    "metric-correlations",
    "dashboards",
    "precomputed-dimensions",
    "custom-hooks",
    "metric-slices",
    "manage-official-resources",
    "product-analytics-dashboards",
    "share-product-analytics-dashboards",
    "incremental-refresh",
  ]),
};

if (stringToBoolean(process.env.IS_CLOUD)) {
  Object.values(accountFeatures).forEach((features) => {
    features.add("ai-suggestions"); // All plans on cloud have ai-suggestions, though the usage limits vary
  });
}

export interface LicenseUserCodes {
  invites: string[];
  fullMembers: string[];
  readOnlyMembers: string[];
}

export interface LicenseMetaData {
  installationId: string;
  installationName?: string;
  gitSha: string;
  gitCommitDate: string;
  sdkLanguages: string[];
  dataSourceTypes: string[];
  eventTrackers: string[];
  isCloud: boolean;
}
