import { z } from "zod";
import {
  createFactFilterPropsValidator,
  createColumnPropsValidator,
  createFactTablePropsValidator,
  numberFormatValidator,
  updateFactFilterPropsValidator,
  updateColumnPropsValidator,
  updateFactTablePropsValidator,
  columnRefValidator,
  metricTypeValidator,
  factTableColumnTypeValidator,
  testFactFilterPropsValidator,
  conversionWindowUnitValidator,
  cappingSettingsValidator,
  windowSettingsValidator,
  cappingTypeValidator,
  factMetricValidator,
} from "../src/routers/fact-table/fact-table.validators";
import { TestQueryRow } from "../src/types/Integration";
import { CreateProps, UpdateProps } from "./models";

export type FactTableColumnType = z.infer<typeof factTableColumnTypeValidator>;
export type NumberFormat = z.infer<typeof numberFormatValidator>;

export interface ColumnInterface {
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  column: string;
  datatype: FactTableColumnType;
  numberFormat: NumberFormat;
  deleted: boolean;
}

export interface FactFilterInterface {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  value: string;
  managedBy?: "" | "api";
}

export interface FactTableInterface {
  organization: string;
  id: string;
  managedBy?: "" | "api";
  dateCreated: Date | null;
  dateUpdated: Date | null;
  name: string;
  description: string;
  owner: string;
  projects: string[];
  tags: string[];
  datasource: string;
  userIdTypes: string[];
  sql: string;
  eventName: string;
  columns: ColumnInterface[];
  columnsError?: string | null;
  filters: FactFilterInterface[];
}

export type ColumnRef = z.infer<typeof columnRefValidator>;

export type FactMetricType = z.infer<typeof metricTypeValidator>;

export type CappingType = z.infer<typeof cappingTypeValidator>;
export type MetricCappingSettings = z.infer<typeof cappingSettingsValidator>;

export type ConversionWindowUnit = z.infer<
  typeof conversionWindowUnitValidator
>;
export type MetricWindowSettings = z.infer<typeof windowSettingsValidator>;

export type FactMetricInterface = z.infer<typeof factMetricValidator>;

export type LegacyFactMetricInterface = FactMetricInterface & {
  capping?: CappingType;
  capValue?: number;

  conversionDelayHours?: number;
  hasConversionWindow?: boolean;
  conversionWindowValue?: number;
  conversionWindowUnit?: ConversionWindowUnit;
};

export type CreateFactTableProps = z.infer<
  typeof createFactTablePropsValidator
>;
export type UpdateFactTableProps = z.infer<
  typeof updateFactTablePropsValidator
>;
export type CreateFactFilterProps = z.infer<
  typeof createFactFilterPropsValidator
>;
export type UpdateFactFilterProps = z.infer<
  typeof updateFactFilterPropsValidator
>;
export type TestFactFilterProps = z.infer<typeof testFactFilterPropsValidator>;

export type UpdateColumnProps = z.infer<typeof updateColumnPropsValidator>;
export type CreateColumnProps = z.infer<typeof createColumnPropsValidator>;

export type CreateFactMetricProps = CreateProps<FactMetricInterface>;
export type UpdateFactMetricProps = UpdateProps<FactMetricInterface>;

export type FactTableMap = Map<string, FactTableInterface>;

export type FactFilterTestResults = {
  sql: string;
  duration?: number;
  error?: string;
  results?: TestQueryRow[];
};
