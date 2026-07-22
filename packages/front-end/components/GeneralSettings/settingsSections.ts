export const SETTINGS_TAB = {
  experiment: "experiment",
  feature: "feature",
  metrics: "metrics",
  "approval-flow": "approval-flow",
  sdk: "sdk",
  import: "import",
  custom: "custom",
  ai: "ai",
} as const;

type SettingsTabValue = (typeof SETTINGS_TAB)[keyof typeof SETTINGS_TAB];

const DEFAULT_SETTINGS_TAB = SETTINGS_TAB.experiment;

function isSettingsTab(value: string | undefined): value is SettingsTabValue {
  return value !== undefined && value in SETTINGS_TAB;
}

const SETTINGS_SECTIONS = {
  "data-source-settings": SETTINGS_TAB.metrics,
  "top-values-lookback": SETTINGS_TAB.metrics,
} as const satisfies Record<string, SettingsTabValue>;

type SettingsSectionId = keyof typeof SETTINGS_SECTIONS;

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return value in SETTINGS_SECTIONS;
}

export function parseSettingsHash(hash: string | undefined): {
  tab: SettingsTabValue;
  section: SettingsSectionId | null;
} {
  const [tabSegment, sectionSegment] = (hash ?? "").split("/");
  const section =
    sectionSegment && isSettingsSectionId(sectionSegment)
      ? sectionSegment
      : null;
  return {
    tab: section
      ? SETTINGS_SECTIONS[section]
      : isSettingsTab(tabSegment)
        ? tabSegment
        : DEFAULT_SETTINGS_TAB,
    section,
  };
}
