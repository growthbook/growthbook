import type { PopulationStep } from "shared/validators";

export * from "./population-sql";
export * from "./population-snapshots";

// Same preset names, labels and UTC day boundaries as Product Analytics'
// `calculateProductAnalyticsDateRange`, which lives in enterprise code.
export const POPULATION_DATE_RANGE_PRESETS = [
  "last30Days",
  "last90Days",
  "last12Months",
] as const;
export type PopulationDateRangePreset =
  (typeof POPULATION_DATE_RANGE_PRESETS)[number];
export const POPULATION_DATE_RANGE_LABELS: Record<
  PopulationDateRangePreset,
  string
> = {
  last30Days: "Past 30 days",
  last90Days: "Past 90 days",
  last12Months: "Past 12 months",
};

export function getPopulationDateRange(
  preset: PopulationDateRangePreset,
  now: Date = new Date(),
): { startDate: Date; endDate: Date } {
  const startDate = new Date(now);
  if (preset === "last12Months") {
    startDate.setUTCMonth(startDate.getUTCMonth() - 12);
    startDate.setUTCDate(startDate.getUTCDate() + 1);
  } else {
    startDate.setUTCDate(
      startDate.getUTCDate() - (preset === "last30Days" ? 29 : 89),
    );
  }
  startDate.setUTCHours(0, 0, 0, 0);
  return { startDate, endDate: new Date(now) };
}
import type { FactTableInterface } from "shared/types/fact-table";

export type PopulationRuleFactTable = Pick<
  FactTableInterface,
  "id" | "datasource" | "userIdTypes"
>;

export type PopulationRuleInput = {
  datasource: string;
  userIdTypes: string[];
  steps: PopulationStep[];
  factTables: PopulationRuleFactTable[];
};

export function getPopulationFactTableIds(steps: PopulationStep[]): string[] {
  return [...new Set(steps.map((step) => step.source.factTableId))];
}

// Falls back to the fact table id when the name is unknown, e.g. the fact
// table was deleted or isn't visible in the current project.
export function getPopulationStepsLabel(
  steps: PopulationStep[],
  getFactTableName: (factTableId: string) => string | undefined,
): string {
  return steps
    .map(
      (step) =>
        getFactTableName(step.source.factTableId) || step.source.factTableId,
    )
    .join(" → ");
}

function formatDuration(value: number, unit: string): string {
  return `${value} ${value === 1 ? unit.replace(/s$/, "") : unit}`;
}

// Returns "" when the step has no window.
export function getPopulationStepWindowLabel({
  type,
  delayValue,
  delayUnit,
  windowValue,
  windowUnit,
}: PopulationStep["windowSettings"]): string {
  if (type === "lookback") {
    return `In the last ${formatDuration(windowValue, windowUnit)}`;
  }
  if (type === "conversion") {
    const label = `Within ${formatDuration(windowValue, windowUnit)} of the previous step`;
    return delayValue > 0
      ? `${label}, after a delay of ${formatDuration(delayValue, delayUnit)}`
      : label;
  }
  return "";
}

// Returns every violation so an editor can show them all at once.
export function getPopulationRuleViolations({
  datasource,
  userIdTypes,
  steps,
  factTables,
}: PopulationRuleInput): string[] {
  const violations: string[] = [];

  if (steps[0]?.windowSettings.type === "conversion") {
    violations.push("The first step cannot use a conversion window.");
  }

  const factTableMap = new Map(factTables.map((f) => [f.id, f]));
  for (const factTableId of getPopulationFactTableIds(steps)) {
    const factTable = factTableMap.get(factTableId);
    if (!factTable) {
      violations.push(`Fact table ${factTableId} not found.`);
      continue;
    }
    if (factTable.datasource !== datasource) {
      violations.push(
        `Fact table ${factTableId} is not in Data Source ${datasource}.`,
      );
      continue;
    }
    const missing = userIdTypes.filter(
      (t) => !factTable.userIdTypes.includes(t),
    );
    if (missing.length) {
      violations.push(
        `Fact table ${factTableId} does not support identifier types: ${missing.join(", ")}.`,
      );
    }
  }

  return violations;
}
