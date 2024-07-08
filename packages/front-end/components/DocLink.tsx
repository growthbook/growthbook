import { ReactNode } from "react";

const docSections = {
  //Pages
  home: "",
  features: "/app/features",
  experimentConfiguration: "/app/experiment-configuration",
  experimentResults: "/app/experiment-results",
  stickyBucketing: "/app/sticky-bucketing",
  metrics: "/app/metrics",
  factTables: "/app/fact-tables",
  dimensions: "/app/dimensions",
  datasources: "/app/datasources",
  dashboard: "/app/experiment-configuration",
  api: "/app/api",
  eventWebhooks: "/app/webhooks/event-webhooks",
  sdkWebhooks: "/app/webhooks/sdk-webhooks",
  "sdkWebhooks#payload-format": "/app/webhooks/sdk-webhooks#payload-format",
  //DataSourceType
  athena: "/app/datasources#aws-athena",
  mixpanel: "/guide/mixpanel",
  bigquery: "/guide/bigquery",
  google_analytics: "/app/datasources#google-analytics",
  //Language
  buildYourOwn: "/lib/build-your-own",
  sdks: "/lib",
  javascript: "/lib/js",
  tsx: "/lib/react",
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
  nocode: "/lib/script-tag",
  cloudflare: "/lib/edge/cloudflare",
  fastly: "/lib/edge/fastly",
  lambda: "/lib/edge/lambda",
  edge: "/lib/edge/other",
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
  autoMetrics: "/app/metrics/#auto-generate-metrics",
  targetingChanges:
    "/app/experiment-configuration#making-changes-while-running",
  shopify: "/integrations/shopify",
  webflow: "/integrations/webflow",
  wordpress: "/integrations/wordpress",
  prerequisites: "/features/prerequisites",
  statisticsSequential: "/statistics/sequential",
};

export type DocSection = keyof typeof docSections;

const urlPathMapping: Record<string, DocSection> = {
  "/": "home",
  "/features": "features",
  "/experiment": "experimentResults",
  "/experiments": "experimentConfiguration",
  "/metric": "metrics",
  "/metrics": "metrics",
  "/segments": "datasources",
  "/dimensions": "dimensions",
  "/datasources": "datasources",
  "/dashboard": "experimentConfiguration",
  "/settings/keys": "api",
  "/environments": "api",
  "/settings/webhooks": "eventWebhooks",
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
}

export function DocLink({
  docSection,
  fallBackSection = "home",
  className = "",
  children,
}: DocLinkProps) {
  const docsPath = docSections[docSection]
    ? docSections[docSection]
    : docSections[fallBackSection]
    ? docSections[fallBackSection]
    : "";
  const docUrl = docsOrigin + docsPath;

  return (
    <a
      href={docUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}
