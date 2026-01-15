import { FormatOptions } from "sql-formatter";

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

// SQL formatter dialect type that automatically stays in sync with sql-formatter
export type FormatDialect = FormatOptions["language"] | "";
