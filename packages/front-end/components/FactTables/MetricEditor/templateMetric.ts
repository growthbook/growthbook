import { z } from "zod";
import dJSON from "dirty-json";
import {
  columnRefValidator,
  metricTypeValidator,
  quantileSettingsValidator,
  windowSettingsValidator,
} from "shared/validators";
import {
  ColumnRef,
  FactMetricInterface,
  FactTableDefinition,
  RowFilter,
} from "shared/types/fact-table";
import { canInlineFilterColumn } from "shared/experiments";

export const templateMetricValidator = z.object({
  metricType: metricTypeValidator.exclude(["funnel"]),
  name: z.string(),
  numerator: columnRefValidator,
  denominator: columnRefValidator.optional(),
  inverse: z.boolean().optional(),
  description: z.string().optional(),
  quantileSettings: quantileSettingsValidator.optional(),
  windowSettings: windowSettingsValidator.optional(),
});
export type TemplateMetric = z.infer<typeof templateMetricValidator>;

// MetricWorkspace's public "duplicateFrom" contract. numerator can still be
// null - a real, non-template duplicate of an existing *funnel* metric goes
// through this exact prop too, and a funnel's numerator is null by the
// stored type's own discriminated union, not this module's business. (Omit
// first, then re-add: intersecting Partial<FactMetricInterface> directly
// with a differently-typed numerator field makes every other field's type
// distribute per-union-member instead of staying the flat partial it should
// be here - this seed is deliberately not a real FactMetricInterface.)
export type FactMetricSeed = Omit<Partial<FactMetricInterface>, "numerator"> & {
  numerator: ColumnRef | null;
};

// What TemplateFieldMapping actually needs: a real, non-funnel seed with an
// inspectable numerator (never null - templateMetricValidator excludes
// "funnel" entirely) and an empty factTableId still to fill in. MetricWorkspace
// is what tells the two apart (a funnel duplicate's numerator is null, not
// an incomplete ColumnRef) before ever constructing one of these.
export type IncompleteFactMetricSeed = Omit<FactMetricSeed, "numerator"> & {
  numerator: ColumnRef;
};

// A template's numerator/denominator arrive with placeholder column names
// and no fact table - build a normalized copy with those fields blanked
// (TemplateFieldMapping fills them in) rather than mutating dJSON's own
// output, then validate.
export function parseMetricTemplate(raw: string): TemplateMetric {
  const json = dJSON.parse(raw);
  const normalized = {
    ...json,
    numerator: json.numerator
      ? {
          ...json.numerator,
          factTableId: "",
          rowFilters: json.numerator.rowFilters || [],
          column:
            json.metricType === "proportion" || json.metricType === "retention"
              ? "$$distinctUsers"
              : json.numerator.column || "",
        }
      : json.numerator,
    denominator: json.denominator
      ? {
          ...json.denominator,
          factTableId: "",
          rowFilters: json.denominator.rowFilters || [],
          column: json.denominator.column || "",
        }
      : json.denominator,
  };
  return templateMetricValidator.parse(normalized);
}

// A template's numerator/denominator carry placeholder column names, not
// real ones - collect them split by which kind of real column can fill each
// slot (matches FactMetricModal's own FieldMappingModal exactly: a count-
// distinct aggregation column and a row-filter column both resolve against
// the same inline-filterable string-column list, not two different ones).
export function placeholderColumns(seed: IncompleteFactMetricSeed) {
  const numeric = new Set<string>();
  const string = new Set<string>();
  const add = (set: Set<string>, column?: string) => {
    if (column && !column.startsWith("$$")) set.add(column);
  };
  const { numerator, denominator } = seed;
  add(
    numerator.aggregation === "count distinct" ? string : numeric,
    numerator.column,
  );
  if (denominator) {
    add(
      denominator.aggregation === "count distinct" ? string : numeric,
      denominator.column,
    );
  }
  add(numeric, numerator.aggregateFilterColumn);
  numerator.rowFilters?.forEach((f) => add(string, f.column));
  denominator?.rowFilters?.forEach((f) => add(string, f.column));
  return { numeric, string };
}

// Whether a placeholder name exactly matches a real column of the kind it
// needs, on the given fact table - the auto-fill convenience on fact-table
// change, and nothing else: a caller still has to persist the match.
export function autoFillsColumn(
  placeholder: string,
  isNumeric: boolean,
  factTable: FactTableDefinition,
): boolean {
  return isNumeric
    ? factTable.columns.some(
        (c) =>
          c.column === placeholder && !c.deleted && c.datatype === "number",
      )
    : canInlineFilterColumn(factTable, placeholder);
}

// A placeholder name can appear in both the numeric and string sets
// placeholderColumns builds (it's just a label the template author chose,
// not guaranteed unique per role) - the caller passes whichever map applies
// to this field. Returns the placeholder unchanged if it isn't tracked in
// that map at all (e.g. a $$ sentinel); returns the mapped value as-is
// otherwise, including "" for a still-unmapped placeholder - never falls
// back to the placeholder name itself, since that would silently pass off
// an unresolved mapping as a real column.
export function mappedColumn(
  column: string | undefined,
  columnMap: Record<string, string>,
): string | undefined {
  if (!column) return column;
  return column in columnMap ? columnMap[column] : column;
}

export function mappedRowFilters(
  filters: RowFilter[] | undefined,
  columnMap: Record<string, string>,
): RowFilter[] | undefined {
  return filters?.map((f) => ({
    ...f,
    column: (f.column && columnMap[f.column]) || f.column,
  }));
}
