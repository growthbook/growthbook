import { ReactNode } from "react";

const docSections = {
  //Pages
  home: "",
  features: "/app/features",
  experiments: "/app/experiments",
  metrics: "/app/metrics",
  dimensions: "/app/dimensions",
  datasources: "/app/datasources",
  dashboard: "/app/experiments",
  api: "/app/api",
  webhooks: "/app/webhooks",
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
  flutter: "/lib/flutter",
  //Other
  user_guide: "/app",
  config: "/self-host/config",
  config_yml: "/self-host/config",
  config_domains_and_ports: "/self-host/env#domains-and-ports",
  config_organization_settings: "/self-host/config#organization-settings",
  env_prod: "/self-host/env#production-settings",
  visual_editor: "/app/visual",
  encryptedSDKEndpoints: "/lib/js#loading-features",
};

export type DocSection = keyof typeof docSections;

const urlPathMapping: Record<string, DocSection> = {
  "/": "home",
  "/features": "features",
  "/experiment": "experiments",
  "/experiments": "experiments",
  "/metric": "metrics",
  "/metrics": "metrics",
  "/segments": "datasources",
  "/dimensions": "dimensions",
  "/datasources": "datasources",
  "/dashboard": "experiments",
  "/settings/keys": "api",
  "/environments": "api",
  "/settings/webhooks": "webhooks",
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
