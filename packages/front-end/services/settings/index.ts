import { useMemo } from "react";
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
    project: true,
    experiment: true,
    metric: true,
    report: true,
  }),
  northStar: genDefaultResolver("northStar", {
    project: true,
  }),
  metricDefaults: genDefaultResolver("metricDefaults", {
    // Example use of string to override the field name
    project: "metricDefaults",
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
      project: true,
      experiment: true,
      report: true,
    }
  ),
  defaultRole: genDefaultResolver("defaultRole"),
  statsEngine: genDefaultResolver("statsEngine", {
    project: true,
    // experiment: true,
    report: true,
  }),
  pValueThreshold: genDefaultResolver("pValueThreshold", {
    project: true,
    experiment: true,
    metric: true,
    report: true,
  }),
  regressionAdjustmentEnabled: regressionAdjustmentResolver("enabled"),
  regressionAdjustmentDays: regressionAdjustmentResolver("days"),
  attributionModel: genDefaultResolver("attributionModel", {
    project: true,
    experiment: true,
    report: true,
  }),
  conversionDelayHours: genMetricOverrideResolver("conversionDelayHours"),
  conversionWindowHours: genMetricOverrideResolver("conversionWindowHours"),
  winRisk: genMetricOverrideResolver("winRisk"),
  loseRisk: genMetricOverrideResolver("loseRisk"),
};

const scopeSettings = (
  baseSettings: ScopedSettings,
  scopes?: ScopeDefinition
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
      // @ts-ignore - todo: we need to figure out how to resolve the type
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

const normalizeInputSettings = (
  inputSettings: InputSettings
): ScopedSettings => {
  const scopedSettings: ScopedSettings = {} as ScopedSettings;
  const baseSettings = genDefaultSettings();

  for (const key in baseSettings) {
    scopedSettings[key as keyof Settings] = {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - todo: we need to figure out how to resolve the type
      value:
        inputSettings[key as keyof Settings] ??
        baseSettings[key as keyof Settings],
      meta: {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        reason: "org-level setting applied",
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        scopeApplied: "organization",
      },
    };
  }

  return scopedSettings;
};

export const useScopedSettings = (
  baseSettings: InputSettings,
  scopes?: ScopeDefinition
): ScopedSettingsReturn => {
  return useMemo(() => {
    const settings = normalizeInputSettings(baseSettings);

    if (
      scopes?.metric &&
      scopes.metric.denominator &&
      !scopes.denominatorMetric
    ) {
      // eslint-disable-next-line no-console
      console.warn('Scope "metric" requires "denominatorMetric"');
    }

    return scopeSettings(settings, scopes);
  }, [baseSettings, scopes]);
};
