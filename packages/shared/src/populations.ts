import type { PopulationStep } from "shared/validators";
import type { FactTableInterface } from "shared/types/fact-table";

export const MAX_POPULATION_STEPS = 20;
/** Distinct fact tables a population's steps may read from. */
export const MAX_POPULATION_FACT_TABLES = 5;

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

// Returns every violation so an editor can show them all at once.
export function getPopulationRuleViolations({
  datasource,
  userIdTypes,
  steps,
  factTables,
}: PopulationRuleInput): string[] {
  const violations: string[] = [];

  if (steps.length > MAX_POPULATION_STEPS) {
    violations.push(
      `Populations can have at most ${MAX_POPULATION_STEPS} steps (this one has ${steps.length}).`,
    );
  }

  if (steps[0]?.windowSettings.type === "conversion") {
    violations.push("The first step cannot use a conversion window.");
  }

  const factTableIds = getPopulationFactTableIds(steps);
  if (factTableIds.length > MAX_POPULATION_FACT_TABLES) {
    violations.push(
      `Populations can read from at most ${MAX_POPULATION_FACT_TABLES} distinct fact tables (this one reads from ${factTableIds.length}).`,
    );
  }

  const factTableMap = new Map(factTables.map((f) => [f.id, f]));
  for (const factTableId of factTableIds) {
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
