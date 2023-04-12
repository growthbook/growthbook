import { DataSourceInterface } from "../../types/datasource";
import { ExperimentInterface } from "../../types/experiment";
import { MetricInterface } from "../../types/metric";
import {
  OrganizationInterface,
  OrganizationSettings,
} from "../../types/organization";
import { ProjectInterface } from "../../types/project";
import { ReportInterface } from "../../types/report";

interface SettingMetadata {
  reason?: string;
}

interface Setting<T> {
  value: T;
  meta: SettingMetadata;
}

interface SettingsContext {
  baseSettings: Partial<ScopedSettings>;
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

type ScopedSettings = Record<
  keyof OrganizationSettings,
  Setting<OrganizationSettings[keyof OrganizationSettings]>
>;

interface UseOrgSettingsReturn {
  settings: ScopedSettings;
  scopeSettings: ScopeSettingsFn;
}

const scopeOrder: Array<keyof ScopeDefinition> = [
  "project",
  "datasource",
  "experiment",
  "metric",
  "report",
];

const genDefaultResolver = (
  fieldName: keyof OrganizationSettings,
  scopesToApply:
    | Partial<Record<keyof ScopeDefinition, boolean>>
    | undefined = {}
): SettingsResolver<OrganizationSettings[keyof OrganizationSettings]> => {
  const filteredScopes = scopeOrder.filter((s) => scopesToApply[s]);
  return (ctx) => {
    const orgSetting = ctx.baseSettings[fieldName]?.value;
    return filteredScopes.reduce(
      (acc, scope) => {
        // @ts-expect-error we know that scopes may or may not have fieldnames defined
        const scopedValue = ctx.scopes?.[scope]?.[fieldName];
        if (!scopedValue) return acc;
        return {
          value: scopedValue,
          meta: {
            reason: `${scope}-level setting applied`,
          },
        };
      },
      {
        value: orgSetting,
        meta: {
          reason: "org-level setting applied",
        },
      }
    );
  };
};

export const resolvers: Record<
  keyof OrganizationSettings,
  SettingsResolver<OrganizationSettings[keyof OrganizationSettings]>
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
    project: true,
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
        value: "",
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
  // deprecated - to remove
  visualEditorEnabled: genDefaultResolver("visualEditorEnabled"),
  customized: genDefaultResolver("customized"),
  logoPath: genDefaultResolver("logoPath"),
  primaryColor: genDefaultResolver("primaryColor"),
  secondaryColor: genDefaultResolver("secondaryColor"),
  namespaces: genDefaultResolver("namespaces"), // move to top-level of org interface
  datasources: genDefaultResolver("datasources"),
  techsources: genDefaultResolver("techsources"),
  attributeSchema: genDefaultResolver("attributeSchema"), // move to top-level of org interface
  environments: genDefaultResolver("environments"), // move to top-level of org interface
  implementationTypes: genDefaultResolver("implementationTypes"),
};

const scopeSettings = (
  baseSettings: Partial<ScopedSettings>,
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
      acc[fieldName as keyof ScopedSettings] = resolver(ctx);
      return acc;
    },
    {} as ScopedSettings
  );

  return {
    settings,
    scopeSettings: (scopes) => scopeSettings(settings, scopes),
  };
};

// transform org settings into Setting objects
const normalizeOrgSettings = (
  orgSettings: OrganizationSettings
): Partial<ScopedSettings> => {
  const settings: ScopedSettings = {} as ScopedSettings;
  for (const [key, value] of Object.entries(orgSettings)) {
    settings[key as keyof OrganizationSettings] = {
      value,
      meta: {
        reason: "org-level setting applied",
      },
    };
  }
  return settings;
};

export const useOrgSettings = (
  org: OrganizationInterface,
  scopes?: ScopeDefinition
): UseOrgSettingsReturn => {
  const settings = org.settings ? normalizeOrgSettings(org.settings) : {};
  return scopeSettings(settings, scopes);
};
