import type { SqlLanguage } from "sql-formatter";

export type TemplateVariables = {
  eventName?: string;
  valueColumn?: string;
};

export type PhaseSQLVar = {
  index?: string;
};

export type SQLVars = {
  startDate: Date;
  endDate?: Date;
  experimentId?: string;
  phase?: PhaseSQLVar;
  customFields?: Record<string, unknown>;
  templateVariables?: TemplateVariables;
};

// SQL formatter dialect type - uses sql-formatter's SqlLanguage, plus "" for no formatting
export type FormatDialect = SqlLanguage | "";

export type DateTruncGranularity = "hour" | "day" | "week" | "month" | "year";

export interface SqlHelpers {
  escapeStringLiteral: (s: string) => string;
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string;
  evalBoolean: (col: string, value: boolean) => string;
  dateTrunc: (
    column: string,
    granularity: "hour" | "day" | "week" | "month" | "year",
  ) => string;
  percentileApprox: (column: string, percentile: number) => string;
  toTimestamp: (date: Date) => string;
  castToFloat: (column: string) => string;
  formatDialect: FormatDialect;
}
