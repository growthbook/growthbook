import { ReactNode } from "react";

const docLinks = {
  "/": "",
  "/features": "/app/features",
  "/experiment": "/app/experiments",
  "/experiments": "/app/experiments",
  "/metric": "/app/metrics",
  "/metrics": "/app/metrics",
  "/segments": "/app/datasources",
  "/dimensions": "/app/dimensions",
  "/datasources": "/app/datasources",
  "/dashboard": "/app/experiments",
  "/settings/keys": "/app/api",
  "/settings/environments": "/app/api",
  "/settings/webhooks": "/app/webhooks",
  //DataSourceType
  athena: "/app/datasources#aws-athena",
  mixpanel: "/guide/mixpanel",
  bigquery: "/guide/bigquery",
  google_analytics: "/app/datasources#google-analytics",
  //Language
  sdks: "/lib",
  javascript: "/lib/js",
  tsx: "/lib/react",
  go: "/lib/go",
  kotlin: "/lib/kotlin",
  ruby: "/lib/ruby",
  php: "/lib/php",
  python: "/lib/python",
  //Other
  user_guide: "/app",
  config: "/self-host/config",
  config_yml: "/self-host/config#configyml",
  config_domains_and_ports: "/self-host/config#domains-and-ports",
  config_organization_settings: "/self-host/config#organization-settings",
  visual_editor: "/app/visual",
};

export type DocsKeys = keyof typeof docLinks;

//for testing use "http://localhost:3200"
const docsOrigin = "https://docs.growthbook.io";

/*
Checks for key, value matches in docsLinks. Starts with full url path then
removes a subdirectory every iteration and checks for a match again.
 
url=http://localhost:3000/metric/a/b
1./metric/a/b
2./metric/a
3./metric
*/
export function inferDocsLink() {
  const subDirectories = window.location.pathname.split("/").slice(1);
  const numSubDirectories = subDirectories.length;

  for (let i = numSubDirectories; i > 0; i--) {
    const key = "/" + subDirectories.join("/");
    const docsPath = docLinks[key as DocsKeys];
    if (docsPath) return docsOrigin + docsPath;
    subDirectories.pop();
  }

  return docsOrigin;
}

export function getDocsLink(key: DocsKeys, fallBackKey: DocsKeys = "/") {
  const docsPath = docLinks[key]
    ? docLinks[key]
    : docLinks[fallBackKey]
    ? docLinks[fallBackKey]
    : "";
  return docsOrigin + docsPath;
}

interface DocLinkProps {
  docKey: DocsKeys;
  fallBackKey?: DocsKeys;
  className?: string;
  children: ReactNode;
}

export function DocLink({
  docKey,
  fallBackKey = "/",
  className = "",
  children,
}: DocLinkProps) {
  return (
    <a
      href={getDocsLink(docKey, fallBackKey)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}
