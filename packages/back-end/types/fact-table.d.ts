import { z } from "zod";
import {
  createFactFilterPropsValidator,
  createColumnPropsValidator,
  createFactTablePropsValidator,
  createFactMetricPropsValidator,
  numberFormatValidator,
  updateFactFilterPropsValidator,
  updateColumnPropsValidator,
  updateFactTablePropsValidator,
  updateFactMetricPropsValidator,
  columnRefValidator,
  metricTypeValidator,
  cappingValidator,
  conversionWindowUnitValidator,
  factTableColumnTypeValidator,
  testFactFilterPropsValidator,
} from "../src/routers/fact-table/fact-table.validators";
import { TestQueryRow } from "../src/types/Integration";

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
}

export interface FactTableInterface {
  organization: string;
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
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

export type CappingType = z.infer<typeof cappingValidator>;

export type ConversionWindowUnit = z.infer<
  typeof conversionWindowUnitValidator
>;

export interface FactMetricInterface {
  id: string;
  organization: string;
  owner: string;
  datasource: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  tags: string[];
  projects: string[];
  inverse: boolean;

  metricType: FactMetricType;
  numerator: ColumnRef;
  denominator: ColumnRef | null;

  capping: CappingType;
  capValue: number;

  maxPercentChange: number;
  minPercentChange: number;
  minSampleSize: number;
  winRisk: number;
  loseRisk: number;

  regressionAdjustmentOverride: boolean;
  regressionAdjustmentEnabled: boolean;
  regressionAdjustmentDays: number;

  conversionDelayHours: number;
  hasConversionWindow: boolean;
  conversionWindowValue: number;
  conversionWindowUnit: ConversionWindowUnit;
}

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

export type CreateFactMetricProps = z.infer<
  typeof createFactMetricPropsValidator
>;
export type UpdateFactMetricProps = z.infer<
  typeof updateFactMetricPropsValidator
>;

export type FactTableMap = Map<string, FactTableInterface>;

export type FactFilterTestResults = {
  sql: string;
  duration?: number;
  error?: string;
  results?: TestQueryRow[];
};
