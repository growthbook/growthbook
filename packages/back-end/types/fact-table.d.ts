import { z } from "zod";
import {
  createFactFilterPropsValidator,
  createFactPropsValidator,
  createFactTablePropsValidator,
  createFactMetricPropsValidator,
  numberFormatValidator,
  updateFactFilterPropsValidator,
  updateFactPropsValidator,
  updateFactTablePropsValidator,
  updateFactMetricPropsValidator,
  factRefValidator,
  metricTypeValidator,
  cappingValidator,
  conversionWindowUnitValidator,
} from "../src/routers/fact-table/fact-table.validators";

export type FactNumberFormat = z.infer<typeof numberFormatValidator>;

export interface FactInterface {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  column: string;
  numberFormat: FactNumberFormat;
  filters: string[];
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
  facts: FactInterface[];
  filters: FactFilterInterface[];
}

export type FactRef = z.infer<typeof factRefValidator>;

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
  numerator: FactRef;
  denominator: FactRef | null;

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
export type UpdateFactProps = z.infer<typeof updateFactPropsValidator>;
export type CreateFactProps = z.infer<typeof createFactPropsValidator>;

export type CreateFactMetricProps = z.infer<
  typeof createFactMetricPropsValidator
>;
export type UpdateFactMetricProps = z.infer<
  typeof updateFactMetricPropsValidator
>;

export type FactTableMap = Map<string, FactTableInterface>;
