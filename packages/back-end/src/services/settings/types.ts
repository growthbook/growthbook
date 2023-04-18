import { DataSourceInterface } from "../../../types/datasource";
import {
  ExperimentInterface,
  AttributionModel,
} from "../../../types/experiment";
import { MetricInterface } from "../../../types/metric";
import {
  OrganizationSettings,
  NorthStarMetric,
  MetricDefaults,
  ExperimentUpdateSchedule,
  MemberRoleInfo,
} from "../../../types/organization";
import { StatsEngine } from "../../../types/stats";
import { ProjectInterface } from "../../../types/project";
import { ReportInterface } from "../../../types/report";

interface SettingMetadata {
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
  project?: ProjectInterface;
  datasource?: DataSourceInterface;
  experiment?: ExperimentInterface;
  metric?: MetricInterface;
  report?: ReportInterface;
}

export type ScopeSettingsFn = (
  scopes: ScopeDefinition
) => {
  settings: ScopedSettings;
  scopeSettings: ScopeSettingsFn;
};

interface MetricSettings {
  conversionWindowHours: number | null;
  conversionDelayHours: number | null;
  winRisk: number | null;
  loseRisk: number | null;
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
  regressionAdjustmentEnabled: boolean;
  regressionAdjustmentDays: number;
  attributionModel: AttributionModel;
}

export type Settings = BaseSettings & MetricSettings;

export type ScopedSettings = Record<
  keyof Settings,
  Setting<Settings[keyof Settings]>
>;

export interface UseScopedSettingsReturn {
  settings: ScopedSettings;
  scopeSettings: ScopeSettingsFn;
}

export type InputSettings = Partial<OrganizationSettings & Settings>;
