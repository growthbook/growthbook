import { get } from "lodash";
import { DataSourceInterface } from "../../types/datasource";
import { ExperimentInterface, AttributionModel } from "../../types/experiment";
import { MetricInterface } from "../../types/metric";
import {
  OrganizationSettings,
  NorthStarMetric,
  MetricDefaults,
  ExperimentUpdateSchedule,
  MemberRoleInfo,
} from "../../types/organization";
import { StatsEngine } from "../../types/stats";
import { ProjectInterface } from "../../types/project";
import { ReportInterface } from "../../types/report";
import { DEFAULT_METRIC_ANALYSIS_DAYS } from "./experiments";

interface SettingMetadata {
  reason?: string;
}

interface Setting<T> {
  value: T;
  meta: SettingMetadata;
}

interface SettingsContext {
  baseSettings: ScopedSettings;
  scopes?: ScopeDefinition;
}

type SettingsResolver<T> = (ctx: SettingsContext) => Setting<T>;

interface ScopeDefinition {
  project?: ProjectInterface;
  datasource?: DataSourceInterface;
  experiment?: ExperimentInterface;
  metric?: MetricInterface;
  report?: ReportInterface;
}

type ScopeSettingsFn = (
  scopes: ScopeDefinition
) => {
  settings: ScopedSettings;
  scopeSettings: ScopeSettingsFn;
};

interface Settings {
  confidenceLevel: number;
  northStar: NorthStarMetric | null;
  metricDefaults: MetricDefaults;
  pastExperimentsMinLength: number;
  metricAnalysisDays: number;
  updateSchedule: ExperimentUpdateSchedule | null;
  sdkInstructionsViewed: boolean;
  videoInstructionsViewed: boolean;
  multipleExposureMinPercent: number;
  defaultRole: MemberRoleInfo;
  statsEngine: StatsEngine;
  pValueThreshold: number;
  regressionAdjustmentEnabled: boolean;
  regressionAdjustmentDays: number;
  attributionModel: AttributionModel;
}

type ScopedSettings = Record<keyof Settings, Setting<Settings[keyof Settings]>>;

interface UseScopedSettingsReturn {
  settings: ScopedSettings;
  scopeSettings: ScopeSettingsFn;
}

type InputSettings = OrganizationSettings | Settings;

const scopeOrder: Array<keyof ScopeDefinition> = [
  "project",
  "datasource",
  "experiment",
  "metric",
  "report",
];

const genDefaultResolver = (
  baseFieldName: keyof Settings,
  scopesToApply:
    | Partial<Record<keyof ScopeDefinition, boolean | string>>
    | undefined = {}
): SettingsResolver<Settings[keyof Settings]> => {
  const filteredScopes = scopeOrder
    .filter((s) => scopesToApply[s])
    .map((s) => ({
      scope: s,
      fieldName:
        typeof scopesToApply[s] === "string" ? scopesToApply[s] : baseFieldName,
    }));
  return (ctx) => {
    const baseSetting = ctx.baseSettings[baseFieldName]?.value;
    return filteredScopes.reduce(
      (acc, { scope, fieldName }) => {
        const scopedValue = get(ctx.scopes, `${scope}.${fieldName}`);
        if (!scopedValue) return acc;
        return {
          value: scopedValue,
          meta: {
            reason: `${scope}-level setting applied`,
          },
        };
      },
      {
        value: baseSetting,
        meta: {
          reason: "org-level setting applied",
        },
      }
    );
  };
};

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
    experiment: true,
    report: true,
  }),
  pValueThreshold: genDefaultResolver("pValueThreshold", {
    project: true,
    experiment: true,
    metric: true,
    report: true,
  }),
  regressionAdjustmentEnabled: (ctx) => {
    // TODO implement killswitch logic
    return (
      ctx.baseSettings.regressionAdjustmentEnabled || {
        value: null,
        meta: {
          reason: "no setting found",
        },
      }
    );
  },
  regressionAdjustmentDays: genDefaultResolver("regressionAdjustmentDays", {
    project: true,
    experiment: true,
    metric: true,
    report: true,
  }),
  attributionModel: genDefaultResolver("attributionModel", {
    project: true,
    experiment: true,
    report: true,
  }),
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

// Default values for Settings
const genBaseSettingsObject = (): Settings => ({
  confidenceLevel: 0.95,
  attributionModel: "firstExposure",
  defaultRole: {
    environments: [],
    limitAccessByEnvironment: false,
    role: "collaborator",
  },
  metricAnalysisDays: DEFAULT_METRIC_ANALYSIS_DAYS,
  metricDefaults: {
    maxPercentageChange: 0.5,
    minPercentageChange: 0.005,
    minimumSampleSize: 150,
  },
  multipleExposureMinPercent: 0.01,
  northStar: null,
  pastExperimentsMinLength: 6,
  pValueThreshold: 0.05,
  regressionAdjustmentDays: 14,
  regressionAdjustmentEnabled: false,
  sdkInstructionsViewed: false,
  statsEngine: "bayesian",
  updateSchedule: null,
  videoInstructionsViewed: false,
});

const normalizeInputSettings = (
  inputSettings: InputSettings
): ScopedSettings => {
  const scopedSettings: ScopedSettings = {} as ScopedSettings;
  const baseSettings = genBaseSettingsObject();

  for (const key in baseSettings) {
    scopedSettings[key as keyof Settings] = {
      value:
        inputSettings[key as keyof Settings] ??
        baseSettings[key as keyof Settings],
      meta: {
        reason: "org-level setting applied",
      },
    };
  }

  return scopedSettings;
};

export const useScopedSettings = (
  baseSettings: InputSettings,
  scopes?: ScopeDefinition
): UseScopedSettingsReturn => {
  const settings = normalizeInputSettings(baseSettings);
  return scopeSettings(settings, scopes);
};
