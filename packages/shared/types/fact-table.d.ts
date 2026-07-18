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
  quantileSettingsValidator,
  priorSettingsValidator,
  columnAggregationValidator,
  legacyWindowSettingsValidator,
  jsonColumnFieldsValidator,
  rowFilterValidator,
  aggregatedFactTableSettingsValidator,
} from "shared/validators";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { TestQueryRow } from "shared/types/integrations";

export type FactTableColumnType = z.infer<typeof factTableColumnTypeValidator>;
export type NumberFormat = z.infer<typeof numberFormatValidator>;

export type JSONColumnFields = z.infer<typeof jsonColumnFieldsValidator>;

export interface ColumnInterface {
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  column: string;
  datatype: FactTableColumnType;
  numberFormat: NumberFormat;
  alwaysInlineFilter?: boolean;
  topValues?: string[];
  topValuesDate?: Date;
  jsonFields?: JSONColumnFields;
  deleted: boolean;
  isAutoSliceColumn?: boolean;
  autoSlices?: string[];
  lockedAutoSlices?: string[];
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
  managedBy?: "" | "api" | "admin";
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
  columnRefreshPending?: boolean;
  filters: FactFilterInterface[];
  archived?: boolean;
  timestampColumn?: string;
  autoSliceUpdatesEnabled?: boolean;
  // Null/undefined means the pipeline is disabled for this fact table.
  aggregatedFactTableSettings?: z.infer<
    typeof aggregatedFactTableSettingsValidator
  > | null;
}

// A column with the heavy `jsonFields` map excluded. Fetch the full fact table
// by id (useFullFactTable) when JSON sub-fields are needed (e.g. the
// metric/filter editors). Direct `.jsonFields` access on this type is a compile
// error, but the guard is only structural: because `jsonFields` is optional on
// ColumnInterface, a slim column still assigns to a `ColumnInterface` /
// `Pick<FactTableInterface, "columns">` param, so passing a definitions fact
// table into a helper that reads `jsonFields` internally (e.g.
// getColumnExpression) is NOT caught by the compiler — always source such
// helpers from the full fact table.
export type FactTableColumnDefinition = Omit<ColumnInterface, "jsonFields">;

// Slimmed fact table returned by the definitions endpoint. The `sql` field is
// excluded and each column omits `jsonFields`; fetch the full fact table by id
// when either is needed.
export type FactTableDefinition = Omit<
  FactTableInterface,
  "sql" | "columns"
> & {
  columns: FactTableColumnDefinition[];
};

export type AggregatedFactTableSettings = z.infer<
  typeof aggregatedFactTableSettingsValidator
>;

export type ColumnRef = z.infer<typeof columnRefValidator>;

export type FactMetricType = z.infer<typeof metricTypeValidator>;

export type ColumnAggregation = z.infer<typeof columnAggregationValidator>;

export type MetricQuantileSettings = z.infer<typeof quantileSettingsValidator>;

export type CappingType = z.infer<typeof cappingTypeValidator>;
export type MetricCappingSettings = z.infer<typeof cappingSettingsValidator>;

export type ConversionWindowUnit = z.infer<
  typeof conversionWindowUnitValidator
>;
export type MetricWindowSettings = z.infer<typeof windowSettingsValidator>;
export type LegacyMetricWindowSettings = z.infer<
  typeof legacyWindowSettingsValidator
>;
export type MetricPriorSettings = z.infer<typeof priorSettingsValidator>;

export type FactMetricInterface = z.infer<typeof factMetricValidator>;

export type LegacyColumnRef = ColumnRef & {
  filters?: string[];
  inlineFilters?: Record<string, string[]>;
};

export type RowFilter = z.infer<typeof rowFilterValidator>;

export type LegacyFactMetricInterface = Omit<
  FactMetricInterface,
  "windowSettings"
> & {
  windowSettings: LegacyMetricWindowSettings;
  capping?: CappingType;
  capValue?: number;

  conversionDelayHours?: number;
  hasConversionWindow?: boolean;
  conversionWindowValue?: number;
  conversionWindowUnit?: ConversionWindowUnit;

  numerator: LegacyColumnRef;
  denominator: LegacyColumnRef | null;
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

// Accepts both full fact tables and slimmed definitions. Use for utils that
// don't read `sql` or per-column `jsonFields`.
export type FactTableDefinitionMap = Map<string, FactTableDefinition>;

export type FactFilterTestResults = {
  sql: string;
  duration?: number;
  error?: string;
  results?: TestQueryRow[];
};
