import { DataSourceInterface } from "back-end/types/datasource";
import {
  ExperimentInterface,
  AttributionModel,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import { MetricInterface } from "back-end/types/metric";
import {
  OrganizationSettings,
  NorthStarMetric,
  MetricDefaults,
  ExperimentUpdateSchedule,
  MemberRoleInfo,
  OrganizationInterface,
  RequireReview,
} from "back-end/types/organization";
import { StatsEngine, PValueCorrection } from "back-end/types/stats";
import { ProjectInterface } from "back-end/types/project";
import { ReportInterface } from "back-end/types/report";
import { MetricWindowSettings } from "back-end/types/fact-table";
import { ExperimentMetricInterface } from "../experiments";

interface SettingMetadata {
  scopeApplied?: keyof ScopeDefinition | "organization";
  reason?: string;
  warning?: string;
}

interface Setting<T> {
  value: T;
  meta: SettingMetadata;
}

export interface SettingsContext {
  baseSettings: ScopedSettings;
  scopes?: ScopeDefinition;
}

export type SettingsResolver<T> = (ctx: SettingsContext) => Setting<T>;

export interface ScopeDefinition {
  organization: Partial<OrganizationInterface>;
  project?: ProjectInterface;
  datasource?: DataSourceInterface;
  experiment?: ExperimentInterface | ExperimentInterfaceStringDates;
  metric?: ExperimentMetricInterface;
  denominatorMetric?: MetricInterface;
  report?: ReportInterface;
}

export type ScopeSettingsFn = (scopes: ScopeDefinition) => {
  settings: ScopedSettings;
  scopeSettings: ScopeSettingsFn;
};

interface MetricSettings {
  windowType: MetricWindowSettings["type"];
  windowHours: number;
  delayHours: number;

  winRisk: number;
  loseRisk: number;
  targetMDE: number;
}

interface BaseSettings {
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
  pValueCorrection: PValueCorrection;
  regressionAdjustmentEnabled: boolean;
  regressionAdjustmentDays: number;
  sequentialTestingEnabled: boolean;
  sequentialTestingTuningParameter: number;
  attributionModel: AttributionModel;
  srmThreshold: number;
  secureAttributeSalt: string;
  killswitchConfirmation: boolean;
  requireReviews: boolean | RequireReview[];
  featureKeyExample: string;
  featureRegexValidator: string;
  banditScheduleValue: number;
  banditScheduleUnit: "hours" | "days";
  banditBurnInValue: number;
  banditBurnInUnit: "hours" | "days";
  experimentMinLengthDays: number;
  experimentMaxLengthDays: number | undefined;
  maxMetricSliceLevels: number;
  useStickyBucketing: boolean;
}

// todo: encapsulate all settings, including experiment
export type Settings = BaseSettings & MetricSettings;

// export type ScopedSettings = Record<
//   keyof Settings,
//   Setting<Settings[keyof Settings]>
// >;

export type ScopedSettings = {
  [K in keyof Settings]: Setting<Settings[K]>;
};

export interface ScopedSettingsReturn {
  settings: ScopedSettings;
  scopeSettings: ScopeSettingsFn;
}

export type InputSettings = Partial<OrganizationSettings & Settings>;
