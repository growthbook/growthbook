import { ReactNode } from "react";
import Link from "@/ui/Link";

const docSections = {
  //Pages
  home: "",
  features: "/app/features",
  experimentConfiguration: "/app/experiment-configuration",
  experimentResults: "/app/experiment-results",
  experimentDecisionFramework: "/app/experiment-decisions",
  experimentsOverview: "/experiments",
  featureFlagExperiments: "/feature-flag-experiments",
  experimentTimeSeries: "/app/experiment-time-series",
  experimentTemplates: "/running-experiments/experiment-templates",
  makingExperimentChanges: "/app/making-experiment-changes",
  experimentDashboards: "/app/experiment-dashboards",
  importingExperiments: "/app/importing-experiments",
  clusterExperiments: "/experimentation-analysis/cluster-experiments",
  preLaunchChecklist: "/app/pre-launch-checklist",
  banditsConfig: "/bandits/config",
  banditsResults: "/bandits/results",
  stickyBucketing: "/app/sticky-bucketing",
  metrics: "/app/metrics",
  factTables: "/app/metrics",
  dimensions: "/app/dimensions",
  datasources: "/app/datasources",
  insights: "/insights",
  powerCalculator: "/statistics/power",
  api: "/app/api",
  eventWebhooks: "/app/webhooks/event-webhooks",
  sdkWebhooks: "/app/webhooks/sdk-webhooks",
  productAnalytics: "/app/product-analytics",
  "sdkWebhooks#payload-format": "/app/webhooks/sdk-webhooks#payload-format",
  webhookSecrets: "/app/webhooks#webhook-secrets",
  bandits: "/bandits/overview",
  targeting: "/features/targeting",
  namespaces: "/features/rules#namespaces",
  environments: "/features/environments",
  archetypes: "/features/rules#archetype",
  team: "/account/user-permissions#teams",
  codeReferences: "/features/code-references",
  featureBasics: "/features/basics",
  featureRules: "/features/rules",
  safeRollouts: "/features/safe-rollouts",
  publishingAndApprovalFlows: "/features/publishing-and-approval-flows",
  staleDetection: "/features/stale-detection",
  featureDiagnostics: "/features/diagnostics",
  customHooks: "/features/custom-hooks",
  customRoles: "/account/user-permissions#custom-roles",
  //DataSourceType
  athena: "/app/datasources#aws-athena",
  mixpanel: "/guide/mixpanel",
  bigquery: "/guide/bigquery",
  presto: "/warehouses/prestodb-or-trino",
  snowflake: "/warehouses/snowflake",
  vertica: "/warehouses/vertica",
  databricks: "/warehouses/databricks",
  clickhouse: "/warehouses/clickhouse",
  postgres: "/warehouses/postgres",
  mysql: "/warehouses/mysql-or-mariadb",
  mssql: "/warehouses/ms-sql-or-sql-server",
  redshift: "/warehouses/redshift",
  google_analytics: "/app/datasources#google-analytics",
  growthbook_clickhouse: "/app/managed-warehouse",
  //Language
  buildYourOwn: "/lib/build-your-own",
  sdks: "/lib",
  javascript: "/lib/js",
  javascriptAutoAttributes: "/lib/js#auto-attributes",
  tsx: "/lib/react",
  nextjs: "/lib/nextjs",
  go: "/lib/go",
  kotlin: "/lib/kotlin",
  swift: "/lib/swift",
  ruby: "/lib/ruby",
  php: "/lib/php",
  python: "/lib/python",
  java: "/lib/java",
  csharp: "/lib/csharp",
  elixir: "/lib/elixir",
  flutter: "/lib/flutter",
  rust: "/lib/rust",
  nocode: "/lib/script-tag",
  cloudflare: "/lib/edge/cloudflare",
  fastly: "/lib/edge/fastly",
  lambda: "/lib/edge/lambda",
  edge: "/lib/edge/other",
  roku: "/lib/roku",
  //Other
  user_guide: "/app",
  config: "/self-host/config",
  config_yml: "/self-host/config",
  config_domains_and_ports: "/self-host/env#domains-and-ports",
  config_organization_settings: "/self-host/config#organization-settings",
  env_prod: "/self-host/env#production-settings",
  visual_editor: "/app/visual",
  url_redirects: "/app/url-redirects",
  temporaryRollout: "/app/visual#stopping-an-experiment",
  encryptedSDKEndpoints: "/lib/js#loading-features",
  hashSecureAttributes: "/lib/js#secure-attributes",
  autoMetrics: "/app/metrics/legacy#auto-generate-metrics",
  targetingChanges:
    "/app/experiment-configuration#making-changes-while-running",
  shopify: "/integrations/shopify",
  webflow: "/integrations/webflow",
  wordpress: "/integrations/wordpress",
  prerequisites: "/features/prerequisites",
  statisticsOverview: "/statistics/overview",
  statisticsDetails: "/statistics/details",
  statisticsQuantile: "/statistics/quantile",
  statisticsCuped: "/statistics/cuped",
  statisticsSequential: "/statistics/sequential",
  statisticsMultipleCorrections: "/statistics/multiple-corrections",
  statisticsAggregation: "/statistics/aggregation",
  statisticsPowerTechnical: "/statistics/power-technical",
  statisticsCupedTechnical: "/statistics/cuped-technical",
  statisticsPostStratification: "/statistics/post-stratification",
  customMarkdown: "/using/growthbook-best-practices#custom-markdown",
  customMetadata: "/using/growthbook-best-practices#custom-fields",
  savedGroups: "/features/targeting#saved-groups",
  ga4BigQuery: "/guide/GA4-google-analytics",
  gtmSetup: "/guide/google-tag-manager-and-growthbook",
  gtmCustomTracking:
    "/guide/google-tag-manager-and-growthbook#4-tracking-via-datalayer-and-gtm",
  apiPostEnvironment: "/api#tag/environments/operation/postEnvironment",
  idLists: "/features/targeting#id-lists",
  queryOptimization: "/app/query-optimization",
  metricGroups: "/app/metrics#metric-groups",
  managedWarehouseTracking: "/app/managed-warehouse#sending-events",
  devTools: "/tools/chrome-extension",
  pipelineMode: "/app/data-pipeline",
  holdouts: "/app/holdouts",
  autoSlices: "/app/metrics#auto-slices",
  customSlices: "/app/metrics#custom-slices",
};

export type DocSection = keyof typeof docSections;

/** Display-only titles for Cmd+K / search; keys stay aligned with `docSections`. */
const docSectionDisplayTitles: Partial<Record<DocSection, string>> = {
  growthbook_clickhouse: "Managed Warehouse",
  buildYourOwn: "Build Your Own SDK",
  ga4BigQuery: "GA4 BigQuery",
  sdks: "SDKs",
  javascript: "JavaScript SDK",
  javascriptAutoAttributes: "JavaScript SDK (Auto Attributes)",
  tsx: "React SDK",
  nextjs: "Next.js SDK",
  go: "Go SDK",
  kotlin: "Kotlin SDK",
  swift: "Swift SDK",
  ruby: "Ruby SDK",
  php: "PHP SDK",
  python: "Python SDK",
  java: "Java SDK",
  csharp: "C# SDK",
  elixir: "Elixir SDK",
  flutter: "Flutter SDK",
  rust: "Rust SDK",
  nocode: "HTML Script Tag",
  cloudflare: "Cloudflare SDK",
  fastly: "Fastly SDK",
  lambda: "AWS Lambda SDK",
  edge: "Edge SDK (Other)",
  roku: "Roku SDK",
};

const uppercaseAcronymTokens = new Set(["api", "gtm", "sdk", "url"]);

/**
 * Human-readable title for search (e.g. Cmd+K). Handles camelCase (including
 * acronyms such as `SDK`), snake_case, and #anchors in keys (e.g.
 * `sdkWebhooks#payload-format`).
 */
export function docTitleForSection(section: DocSection): string {
  const titled = docSectionDisplayTitles[section];
  if (titled !== undefined) return titled;

  const raw = section as string;
  const withSpaces = raw.replace(/#/g, " ").replace(/-/g, " ");
  const splitCamel = withSpaces
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return splitCamel
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const normalized = w.toLowerCase();
      if (uppercaseAcronymTokens.has(normalized)) {
        return normalized.toUpperCase();
      }
      // Preserve acronym tokens already split from camelCase (e.g. "SDK").
      if (/^[A-Z0-9]+$/.test(w) && /[A-Z]/.test(w)) {
        return w;
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

const urlPathMapping: Record<string, DocSection> = {
  "/": "home",
  "/features": "features",
  "/bandits": "bandits",
  "/bandit": "bandits",
  "/experiment": "experimentResults",
  "/experiments": "experimentConfiguration",
  "/metric": "metrics",
  "/metrics": "metrics",
  "/fact-tables": "factTables",
  "/fact-metrics": "metrics",
  "/power-calculator": "powerCalculator",
  "/segments": "datasources",
  "/dimensions": "dimensions",
  "/datasources": "datasources",
  "/dashboard": "insights",
  "/learnings": "insights",
  "/timeline": "insights",
  "/metric-effects": "insights",
  "/correlations": "insights",
  "/settings/keys": "api",
  "/account/personal-access-tokens": "api",
  "/environments": "environments",
  "/settings/webhooks": "eventWebhooks",
  "/sdks": "sdks",
  "/attributes": "targeting",
  "/namespaces": "namespaces",
  "/saved-groups": "savedGroups",
  "/archetypes": "archetypes",
  "/settings/team": "team",
  "/product-analytics": "productAnalytics",
};

//for testing use "http://localhost:3200"
const docsOrigin = "https://docs.growthbook.io";

/*
Checks for key, value matches in docSections. Starts with full url path then
removes a subdirectory every iteration and checks for a match again.

url=http://localhost:3000/metric/a/b
1./metric/a/b
2./metric/a
3./metric
*/
export function inferDocUrl() {
  const subDirectories = window.location.pathname.split("/").slice(1);
  const numSubDirectories = subDirectories.length;

  for (let i = numSubDirectories; i > 0; i--) {
    const urlPath = "/" + subDirectories.join("/");
    const docsPath = docSections[urlPathMapping[urlPath]];
    if (docsPath) return docsOrigin + docsPath;
    subDirectories.pop();
  }

  return docsOrigin;
}

interface DocLinkProps {
  docSection: DocSection;
  fallBackSection?: DocSection;
  className?: string;
  children: ReactNode;
  useRadix?: boolean;
}

export const docUrl = (docSection: DocSection, fallBackSection = "home") => {
  const docsPath = docSections[docSection]
    ? docSections[docSection]
    : docSections[fallBackSection]
      ? docSections[fallBackSection]
      : "";

  return docsOrigin + docsPath;
};

/** Stable rows for indexing documentation in the command palette. */
export function getDocSectionsForCommandPalette(): {
  section: DocSection;
  title: string;
  url: string;
  tags: string;
}[] {
  return (Object.keys(docSections) as DocSection[]).map((section) => ({
    section,
    title: docTitleForSection(section),
    url: docUrl(section),
    tags: `${section} documentation`,
  }));
}

export function DocLink({
  docSection,
  fallBackSection = "home",
  className = "",
  useRadix,
  children,
}: DocLinkProps) {
  if (useRadix) {
    return (
      <Link
        href={docUrl(docSection, fallBackSection)}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </Link>
    );
  }

  return (
    <a
      href={docUrl(docSection, fallBackSection)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}
