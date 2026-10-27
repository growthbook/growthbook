import isEqualWith from "lodash/isEqualWith";
import isPlainObject from "lodash/isPlainObject";

type SettingsSectionDef = {
  id: string;
  title: string;
  description: string;
};

// In display order; ids are also element ids and hash targets.
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
    title: "Metrics & Data",
    description:
      "Defaults for new metrics, Data Source lookbacks, and North Star metrics.",
  },
  {
    id: "features",
    title: "Feature Flags",
    description:
      "Key naming, defaults for new Feature Flags, Configs, publishing checks, code references, and ramp schedules.",
  },
  {
    id: "approvals",
    title: "Approvals",
    description:
      "Require review before changes to flags, Configs, Constants, and Saved Groups go live.",
  },
  {
    id: "sdk",
    title: "SDK Configuration",
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
    title: "Import & Export",
    description:
      "Move settings between GrowthBook accounts or bring data in from another service.",
  },
  {
    id: "markdown",
    title: "Custom Markdown",
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

export function resolveSettingsHash(hash: string | undefined): string | null {
  if (!hash) return null;
  const [tab, section] = hash.split("/");
  if (section) return section;
  return LEGACY_TAB_SECTION[tab] ?? tab;
}

export const ORG_PAGE_KEYWORDS: Record<string, string> = {
  "/projects": "project group organize",
  "/settings/team": "people users roles teams invite seats",
  "/settings/tags": "labels color",
  "/settings/customfields": "metadata",
  "/settings/keys": "secret rest token",
  "/settings/personal-access-tokens": "personal access tokens pats",
  "/settings/webhooks": "events secrets endpoints",
  "/events": "logs audit log events history changes",
  "/integrations/slack": "notifications channels integration",
  "/settings/usage": "cdn requests bandwidth clickhouse",
  "/settings/custom-hooks": "scripts",
  "/settings/billing": "plan invoice payment subscription",
  "/admin": "super admin organizations",
};

export function tokenizeSettingsQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesSettingsQuery(
  haystack: string,
  tokens: string[],
): boolean {
  const h = haystack.toLowerCase();
  return tokens.every((t) => h.includes(t));
}

const SECTION_FIELDS: Record<string, string[]> = {
  experiments: [
    "pastExperimentsMinLength",
    "updateSchedule",
    "runHealthTrafficQuery",
    "srmThreshold",
    "multipleExposureMinPercent",
    "attributionModel",
    "disablePrecomputedDimensions",
    "useStickyBucketing",
    "stickyBucketingOnByDefault",
    "useFallbackAttributes",
    "requireExperimentTemplates",
    "requireUniqueExperimentTrackingKeys",
    "experimentKeyExample",
    "experimentKeyRegexValidator",
    "experimentMinLengthDays",
    "experimentMaxLengthDays",
    "decisionFrameworkEnabled",
    "defaultDecisionCriteriaId",
  ],
  statistics: [
    "statsEngine",
    "confidenceLevel",
    "pValueThreshold",
    "pValueCorrection",
    "regressionAdjustmentEnabled",
    "regressionAdjustmentDays",
    "sequentialTestingEnabled",
    "sequentialTestingTuningParameter",
    "postStratificationEnabled",
    "banditScheduleValue",
    "banditScheduleUnit",
    "banditBurnInValue",
    "banditBurnInUnit",
    "learningStatuses",
  ],
  metrics: [
    "metricAnalysisDays",
    "metricDefaults",
    "disableLegacyMetricCreation",
    "maxMetricSliceLevels",
    "defaultDataSource",
    "testQueryDays",
    "topValuesLookbackValue",
    "northStar",
  ],
  features: [
    "featureKeyExample",
    "featureRegexValidator",
    "requireProjectForFeatures",
    "requireScopedFeatureRules",
    "sparseJSONRulesByDefault",
    "configsExtensibleByDefault",
    "configExperimentGuardDefault",
    "blockPublishOnSchemaError",
    "maxConcurrentDrafts",
    "preferredEnvironment",
    "codeReferencesEnabled",
    "codeRefsBranchesToFilter",
    "codeRefsPlatformUrl",
    "secureAttributeSalt",
    "killswitchConfirmation",
  ],
  approvals: [
    "requireReviews",
    "targetingReviewMode",
    "restApiBypassesReviews",
    "requireRebaseBeforePublish",
    "revertsBypassApproval",
    "approvalFlows",
  ],
  sdk: [
    "requireProjectForSdkConnections",
    "savedGroupSizeLimit",
    "enforceSavedGroupProjectScope",
    "requireRegisteredAttributes",
  ],
  ai: [
    "aiEnabled",
    "aiAskDataEnabled",
    "aiAutocompleteEnabled",
    "aiAutocompleteModel",
    "disabledAgentSkills",
    "defaultAIModel",
    "embeddingModel",
    "sttModel",
    "visualEditorAIModel",
    "visualEditorImageModel",
    "visualEditorAIContext",
  ],
  markdown: [
    "featureListMarkdown",
    "featurePageMarkdown",
    "experimentListMarkdown",
    "experimentPageMarkdown",
    "metricListMarkdown",
    "metricPageMarkdown",
  ],
};

const FIELD_SECTION: Record<string, string> = Object.fromEntries(
  Object.entries(SECTION_FIELDS).flatMap(([section, fields]) =>
    fields.map((f) => [f, section]),
  ),
);

export function sectionForField(field: string): string | null {
  return FIELD_SECTION[field] ?? null;
}

// "2 unsaved changes in AI and Custom Markdown", or "… in 3 sections".
export function describeUnsavedChanges(
  count: number,
  sectionIds: string[],
): string {
  const titles = sectionIds
    .map((id) => SETTINGS_SECTIONS.find((s) => s.id === id)?.title)
    .filter((t): t is string => !!t);
  const where =
    titles.length <= 2 ? titles.join(" and ") : `${titles.length} sections`;
  return `${count} unsaved change${count === 1 ? "" : "s"}${where ? ` in ${where}` : ""}`;
}

export function scrollToSettingsSection(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "instant", block: "start" });
}

const isAbsent = (v: unknown) =>
  v === undefined || v === null || v === "" || Number.isNaN(v);

// Treats unset values alike at any depth, since saving drops undefined keys.
export function sameSetting(a: unknown, b: unknown): boolean {
  return isEqualWith(a, b, (x: unknown, y: unknown) => {
    if (isAbsent(x) && isAbsent(y)) return true;
    if (!isPlainObject(x) || !isPlainObject(y)) return undefined;
    const xo = x as Record<string, unknown>;
    const yo = y as Record<string, unknown>;
    const keys = new Set([...Object.keys(xo), ...Object.keys(yo)]);
    return [...keys].every((k) => sameSetting(xo[k], yo[k]));
  });
}
