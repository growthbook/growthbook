import { ReactNode } from "react";
import { DocSection, docSections, docsOrigin } from "@/components/docSections";
import Link from "@/ui/Link";

export type { DocSection };

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
  faq: "FAQ",
  cloudCdnUsageLimits: "Cloud CDN Usage Limits",
  aiIntegrations: "AI Integrations",
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
  useRadix = true,
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
