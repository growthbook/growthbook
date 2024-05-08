import genDefaultResolver from "./resolvers/genDefaultResolver";
import genMetricOverrideResolver from "./resolvers/genMetricOverrideResolver";
import genDefaultSettings from "./resolvers/genDefaultSettings";
import {
  Settings,
  SettingsResolver,
  ScopedSettings,
  ScopeDefinition,
  SettingsContext,
  ScopeSettingsFn,
  InputSettings,
  ScopedSettingsReturn,
} from "./types";
import regressionAdjustmentResolver from "./resolvers/regressionAdjustmentEnabledResolver";

export const resolvers: Record<
  keyof Settings,
  SettingsResolver<Settings[keyof Settings]>
> = {
  confidenceLevel: genDefaultResolver("confidenceLevel", {
    project: "settings.confidenceLevel",
    experiment: true,
    metric: true,
    report: true,
  }),
  northStar: genDefaultResolver("northStar", {
    project: "settings.northStar",
  }),
  metricDefaults: genDefaultResolver("metricDefaults", {
    // Example use of string to override the field name
    project: "settings.metricDefaults",
    experiment: true,
    metric: true,
    report: true,
  }),
  pastExperimentsMinLength: genDefaultResolver("pastExperimentsMinLength", {
    datasource: true,
  }),
  metricAnalysisDays: genDefaultResolver("metricAnalysisDays"),
  updateSchedule: genDefaultResolver("updateSchedule", {
    datasource: true,
    experiment: true,
  }),
  sdkInstructionsViewed: genDefaultResolver("sdkInstructionsViewed"),
  videoInstructionsViewed: genDefaultResolver("videoInstructionsViewed"),
  multipleExposureMinPercent: genDefaultResolver(
    "multipleExposureMinPercent",

    {
      project: "settings.multipleExposureMinPercent",
      experiment: true,
      report: true,
    }
  ),
  defaultRole: genDefaultResolver("defaultRole"),
  statsEngine: genDefaultResolver(
    "statsEngine",
    {
      project: "settings.statsEngine",
      experiment: true,
      report: true,
    },
    {
      bypassEmpty: true,
    }
  ),
  pValueThreshold: genDefaultResolver("pValueThreshold", {
    project: "settings.pValueThreshold",
    experiment: true,
    metric: true,
    report: true,
  }),
  regressionAdjustmentEnabled: regressionAdjustmentResolver("enabled"),
  regressionAdjustmentDays: regressionAdjustmentResolver("days"),
  attributionModel: genDefaultResolver("attributionModel", {
    project: "settings.attributionModel",
    experiment: true,
    report: true,
  }),
  delayHours: genMetricOverrideResolver("delayHours"),
  windowType: genMetricOverrideResolver("windowType"),
  windowHours: genMetricOverrideResolver("windowHours"),
  winRisk: genMetricOverrideResolver("winRisk"),
  loseRisk: genMetricOverrideResolver("loseRisk"),
  secureAttributeSalt: genDefaultResolver("secureAttributeSalt"),
  killswitchConfirmation: genDefaultResolver("killswitchConfirmation"),
  requireReviews: genDefaultResolver("requireReviews"),
  featureKeyExample: genDefaultResolver("featureKeyExample"),
  featureRegexValidator: genDefaultResolver("featureRegexValidator"),
};

const scopeSettings = (
  baseSettings: ScopedSettings,
  scopes: ScopeDefinition
): {
  settings: ScopedSettings;
  scopeSettings: ScopeSettingsFn;
} => {
  const ctx: SettingsContext = {
    baseSettings,
    scopes,
  };

  // iterate over resolvers and apply them to the base settings
  const settings = Object.entries(resolvers).reduce(
    (acc, [fieldName, resolver]) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error - todo: we need to figure out how to resolve the type
      acc[fieldName as keyof Settings] = resolver(ctx);
      return acc;
    },
    {} as ScopedSettings
  );

  return {
    settings,
    scopeSettings: (scopes) => scopeSettings(settings, scopes),
  };
};

// todo: currently for org-level interface
// turns an InputSettings into ScopedSettings
const normalizeInputSettings = (
  inputSettings: InputSettings
): ScopedSettings => {
  const scopedSettings: ScopedSettings = {} as ScopedSettings;
  const baseSettings = genDefaultSettings();

  for (const key in baseSettings) {
    scopedSettings[key as keyof Settings] = {
      value:
        inputSettings[key as keyof Settings] ??
        baseSettings[key as keyof Settings],
      meta: {
        reason: "org-level setting applied",
        scopeApplied: "organization",
      },
      // eslint-disable-next-line
    } as any;
  }

  return scopedSettings;
};

export const getScopedSettings = (
  scopes: ScopeDefinition
): ScopedSettingsReturn => {
  const settings = normalizeInputSettings(scopes.organization.settings || {});

  if (
    scopes?.metric &&
    scopes.metric.denominator &&
    !scopes.denominatorMetric
  ) {
    // eslint-disable-next-line no-console
    console.warn('Scope "metric" requires "denominatorMetric"');
  }

  return scopeSettings(settings, scopes);
};

export type { ScopedSettings } from "./types";
