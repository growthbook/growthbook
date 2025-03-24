export type AccountPlan = "oss" | "starter" | "pro" | "pro_sso" | "enterprise";
export const accountPlans: Set<AccountPlan> = new Set([
  "oss",
  "starter",
  "pro",
  "pro_sso",
  "enterprise",
]);

export type CommercialFeature =
  | "scim"
  | "sso"
  | "advanced-permissions"
  | "encrypt-features-endpoint"
  | "schedule-feature-flag"
  | "custom-metadata"
  | "override-metrics"
  | "regression-adjustment"
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
  | "decision-framework";

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
};
