export type SettingsSectionDef = {
  id: string;
  title: string;
  description: string;
};

/** Sections of the General settings page, in display order. Ids double as element ids and `#hash` targets. */
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: "organization",
    title: "Organization",
    description: "Name, owner, and plan for this organization.",
  },
  {
    id: "experiments",
    title: "Experiments",
    description:
      "Launch requirements, how results refresh, sticky bucketing, health checks, and shipping decisions.",
  },
  {
    id: "statistics",
    title: "Statistics",
    description:
      "The default stats engine, variance reduction, Bandit defaults, and Learning statuses.",
  },
  {
    id: "metrics",
    title: "Metrics & data",
    description:
      "Defaults for new metrics, Data Source lookbacks, and North Star metrics.",
  },
  {
    id: "features",
    title: "Feature flags",
    description:
      "Key naming, defaults for new flags, Configs, publishing checks, code references, and ramp schedules.",
  },
  {
    id: "approvals",
    title: "Approvals",
    description:
      "Require review before changes to flags, Configs, Constants, and Saved Groups go live.",
  },
  {
    id: "sdk",
    title: "SDK configuration",
    description:
      "Project scoping for SDK Connections, Saved Group limits, and attribute validation.",
  },
  {
    id: "ai",
    title: "AI",
    description:
      "Who can use AI, Assistant skills, providers, and the prompts used across GrowthBook.",
  },
  {
    id: "import",
    title: "Import & export",
    description:
      "Move settings between GrowthBook accounts or bring data in from another service.",
  },
  {
    id: "markdown",
    title: "Custom markdown",
    description:
      "Organization-specific guidance and documentation shown to your team on key pages in GrowthBook.",
  },
];

// Tab hashes from the old tabbed page, so links elsewhere in the app keep landing.
const LEGACY_TAB_SECTION: Record<string, string> = {
  experiment: "experiments",
  feature: "features",
  "approval-flow": "approvals",
  custom: "markdown",
};

/** Element id a `/settings#...` hash should scroll to, or null when there is no hash. */
export function resolveSettingsHash(hash: string | undefined): string | null {
  if (!hash) return null;
  const [tab, section] = hash.split("/");
  if (section) return section;
  return LEGACY_TAB_SECTION[tab] ?? tab;
}

/** Search keywords for Organization pages, keyed by their sidebar href. */
export const ORG_PAGE_KEYWORDS: Record<string, string> = {
  "/projects": "project group organize",
  "/settings/team": "people users roles teams invite seats",
  "/settings/tags": "labels color",
  "/settings/customfields": "metadata",
  "/settings/keys": "secret rest token",
  "/settings/personal-access-tokens": "personal access tokens pats",
  "/settings/webhooks": "events secrets endpoints",
  "/events": "audit log events history changes",
  "/integrations/slack": "notifications channels integration",
  "/settings/usage": "cdn requests bandwidth clickhouse",
  "/settings/custom-hooks": "scripts",
  "/settings/billing": "plan invoice payment subscription",
  "/admin": "super admin organizations",
};

export function tokenizeSettingsQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every token must appear somewhere in the haystack. */
export function matchesSettingsQuery(
  haystack: string,
  tokens: string[],
): boolean {
  const h = haystack.toLowerCase();
  return tokens.every((t) => h.includes(t));
}
