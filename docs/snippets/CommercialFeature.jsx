export const CommercialFeature = ({ feature, description }) => {
  const commercialFeatures = {
    "adv-presentations": {
      plan: "enterprise",
      displayName: "Adv Presentations",
    },
    "advanced-permissions": {
      plan: "pro",
      displayName: "Advanced Permissions",
    },
    "ai-suggestions": {
      plan: "enterprise",
      displayName: "AI Suggestions",
    },
    archetypes: {
      plan: "pro",
      displayName: "Archetypes",
    },
    "audit-logging": {
      plan: "enterprise",
      displayName: "Audit Logging",
    },
    "cloud-proxy": {
      plan: "pro",
      displayName: "Cloud Proxy",
    },
    "code-references": {
      plan: "pro",
      displayName: "Code References",
    },
    "custom-hooks": {
      plan: "enterprise",
      displayName: "Custom Hooks",
    },
    "custom-launch-checklist": {
      plan: "enterprise",
      displayName: "Custom Launch Checklist",
    },
    "custom-markdown": {
      plan: "enterprise",
      displayName: "Custom Markdown",
    },
    "custom-metadata": {
      plan: "enterprise",
      displayName: "Custom Metadata",
    },
    "custom-roles": {
      plan: "enterprise",
      displayName: "Custom Roles",
    },
    dashboards: {
      plan: "enterprise",
      displayName: "Dashboards",
    },
    "decision-framework": {
      plan: "pro",
      displayName: "Decision Framework",
    },
    "encrypt-features-endpoint": {
      plan: "pro",
      displayName: "Encrypt Features Endpoint",
    },
    "environment-inheritance": {
      plan: "enterprise",
      displayName: "Environment Inheritance",
    },
    "events-forwarder": {
      plan: "pro",
      displayName: "Events Forwarder",
    },
    "experiment-impact": {
      plan: "enterprise",
      displayName: "Experiment Impact",
    },
    "hash-secure-attributes": {
      plan: "pro",
      displayName: "Hash Secure Attributes",
    },
    "historical-power": {
      plan: "pro",
      displayName: "Historical Power",
    },
    holdouts: {
      plan: "enterprise",
      displayName: "Holdouts",
    },
    "incremental-refresh": {
      plan: "enterprise",
      displayName: "Incremental Refresh",
    },
    "json-validation": {
      plan: "enterprise",
      displayName: "JSON Validation",
    },
    "large-saved-groups": {
      plan: "enterprise",
      displayName: "Large Saved Groups",
    },
    livechat: {
      plan: "pro",
      displayName: "Livechat",
    },
    "manage-official-resources": {
      plan: "enterprise",
      displayName: "Manage Official Resources",
    },
    "metric-correlations": {
      plan: "enterprise",
      displayName: "Metric Correlations",
    },
    "metric-effects": {
      plan: "enterprise",
      displayName: "Metric Effects",
    },
    "metric-groups": {
      plan: "enterprise",
      displayName: "Metric Groups",
    },
    "metric-populations": {
      plan: "pro",
      displayName: "Metric Populations",
    },
    "metric-slices": {
      plan: "enterprise",
      displayName: "Metric Slices",
    },
    "multi-armed-bandits": {
      plan: "pro",
      displayName: "Multi Armed Bandits",
    },
    "multi-metric-queries": {
      plan: "enterprise",
      displayName: "Multi Metric Queries",
    },
    "multi-org": {
      plan: "enterprise",
      displayName: "Multi Org",
    },
    "multiple-sdk-webhooks": {
      plan: "pro",
      displayName: "Multiple Sdk Webhooks",
    },
    "no-access-role": {
      plan: "enterprise",
      displayName: "No Access Role",
    },
    "override-metrics": {
      plan: "pro",
      displayName: "Override Metrics",
    },
    "pipeline-mode": {
      plan: "enterprise",
      displayName: "Pipeline Mode",
    },
    "post-stratification": {
      plan: "enterprise",
      displayName: "Post Stratification",
    },
    "precomputed-dimensions": {
      plan: "pro",
      displayName: "Precomputed Dimensions",
    },
    "prerequisite-targeting": {
      plan: "enterprise",
      displayName: "Prerequisite Targeting",
    },
    prerequisites: {
      plan: "pro",
      displayName: "Prerequisites",
    },
    "product-analytics-dashboards": {
      plan: "pro",
      displayName: "Product Analytics Dashboards",
    },
    "project-admin-role": {
      plan: "enterprise",
      displayName: "Project Admin Role",
    },
    "quantile-metrics": {
      plan: "pro",
      displayName: "Quantile Metrics",
    },
    "ramp-schedules": {
      plan: "pro",
      displayName: "Ramp Schedules",
    },
    redirects: {
      plan: "pro",
      displayName: "Redirects",
    },
    "regression-adjustment": {
      plan: "pro",
      displayName: "CUPED",
    },
    "remote-evaluation": {
      plan: "pro",
      displayName: "Remote Evaluation",
    },
    "require-approvals": {
      plan: "enterprise",
      displayName: "Require Approvals",
    },
    "require-project-for-features-setting": {
      plan: "enterprise",
      displayName: "Require Project For Features Setting",
    },
    "require-project-for-sdk-connections-setting": {
      plan: "enterprise",
      displayName: "Require Project For Sdk Connections Setting",
    },
    "retention-metrics": {
      plan: "pro",
      displayName: "Retention Metrics",
    },
    "safe-rollout": {
      plan: "pro",
      displayName: "Safe Rollout",
    },
    saveSqlExplorerQueries: {
      plan: "pro",
      displayName: "Save SQL Explorer Queries",
    },
    "schedule-feature-flag": {
      plan: "pro",
      displayName: "Schedule Feature Flag",
    },
    "scheduled-revisions": {
      plan: "enterprise",
      displayName: "Scheduled Revisions",
    },
    scim: {
      plan: "enterprise",
      displayName: "SCIM",
    },
    "sequential-testing": {
      plan: "pro",
      displayName: "Sequential Testing",
    },
    "share-product-analytics-dashboards": {
      plan: "enterprise",
      displayName: "Share Product Analytics Dashboards",
    },
    simulate: {
      plan: "pro",
      displayName: "Simulate",
    },
    sso: {
      plan: "enterprise",
      displayName: "SSO",
    },
    "sticky-bucketing": {
      plan: "pro",
      displayName: "Sticky Bucketing",
    },
    teams: {
      plan: "enterprise",
      displayName: "Teams",
    },
    templates: {
      plan: "enterprise",
      displayName: "Templates",
    },
    "unlimited-managed-warehouse-usage": {
      plan: "pro",
      displayName: "Unlimited Managed Warehouse Usage",
    },
    "visual-editor": {
      plan: "pro",
      displayName: "Visual Editor",
    },
  };

  const { plan, displayName } = commercialFeatures[feature];
  const isEnterprise = plan === "enterprise";

  const defaultDescription = isEnterprise
    ? "is available on Enterprise plans."
    : "is available on Pro and Enterprise plans.";

  const planLabel = isEnterprise ? "Enterprise" : "Pro";

  const containerStyle = isEnterprise
    ? { backgroundColor: "color-mix(in srgb, var(--indigo-a3) 60%, transparent)" }
    : { backgroundColor: "color-mix(in srgb, var(--amber-a3) 60%, transparent)" };

  const badgeStyle = isEnterprise
    ? { boxShadow: "inset 0 0 0 1px var(--indigo-a8)", color: "var(--indigo-a11)" }
    : { boxShadow: "inset 0 0 0 1px var(--amber-a8)", color: "var(--amber-a11)" };

  return (
    <div
      className="flex items-start gap-2 mb-4 p-3 text-sm leading-[1.4] rounded-lg"
      style={containerStyle}
      role="note"
    >
      <span
        className="inline-flex items-center justify-center px-1.5 h-5 text-xs font-medium rounded-full shrink-0 leading-none"
        style={badgeStyle}
      >
        {planLabel}
      </span>
      <div className="flex-1 leading-[1.3]">
        <strong className="font-semibold">{displayName}</strong> {defaultDescription} {description}
      </div>
    </div>
  );
};
