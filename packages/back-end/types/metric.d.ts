import {
  CappingType,
  MetricCappingSettings,
  MetricPriorSettings,
  MetricWindowSettings,
} from "./fact-table";
import { Queries } from "./query";
import { TemplateVariables } from "./sql";

export type Operator = "=" | "!=" | "~" | "!~" | ">" | "<" | "<=" | ">=" | "=>";
export type MetricType = "binomial" | "count" | "duration" | "revenue";
export type MetricStatus = "active" | "archived";

// Keep MetricStats in sync with gbstats
export interface MetricStats {
  users: number;
  count: number;
  stddev: number;
  mean: number;
}

export interface MetricAnalysis {
  createdAt: Date;
  segment?: string;
  average: number;
  stddev?: number;
  count?: number;
  histogram?: { b: string; c: number }[];
  dates: { d: Date; v: number; s?: number; c?: number }[];
}

export interface Condition {
  column: string;
  operator: Operator;
  value: string;
}

export type ManagedBy = "" | "config" | "api";

export interface MetricInterface {
  id: string;
  organization: string;
  managedBy?: ManagedBy;
  owner: string;
  datasource: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
  name: string;
  description: string;
  tags?: string[];
  projects?: string[];
  status?: MetricStatus;

  userIdTypes?: string[];
  userIdColumns?: Record<string, string>;
  sql?: string;
  templateVariables?: TemplateVariables;
  segment?: string;
  type: MetricType;
  denominator?: string;
  inverse: boolean;
  aggregation?: string;

  ignoreNulls: boolean;
  earlyStart?: boolean;

  cappingSettings: MetricCappingSettings;
  windowSettings: MetricWindowSettings;
  priorSettings: MetricPriorSettings;

  winRisk?: number;
  loseRisk?: number;
  maxPercentChange?: number;
  minPercentChange?: number;
  minSampleSize?: number;

  regressionAdjustmentOverride?: boolean;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentDays?: number;

  // metric analysis fields
  queries: Queries;
  runStarted: Date | null;
  analysis?: MetricAnalysis;
  analysisError?: string;

  // Query Builder Props (alternative to sql)
  table?: string;
  column?: string;
  timestampColumn?: string;
  conditions?: Condition[];
  queryFormat?: "sql" | "builder";
}

export type LegacyMetricInterface = Omit<
  MetricInterface,
  "cappingSettings" | "windowSettings" | "priorSettings"
> & {
  // make new mandatory fields optional
  cappingSettings?: MetricCappingSettings;
  windowSettings?: MetricWindowSettings;
  priorSettings?: MetricPriorSettings;

  // keep old fields around for migration
  cap?: number;
  capping?: CappingType;
  capValue?: number;
  conversionWindowHours?: number;
  conversionDelayHours?: number;
  userIdType?: "anonymous" | "user" | "either";
  userIdColumn?: string;
  anonymousIdColumn?: string;
};

export type InsertMetricProps = Pick<
  MetricInterface,
  | "name"
  | "type"
  | "sql"
  | "id"
  | "organization"
  | "datasource"
  | "dateCreated"
  | "dateUpdated"
  | "userIdTypes"
>;
