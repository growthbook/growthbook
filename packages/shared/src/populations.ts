import type { PopulationStep } from "shared/validators";

export * from "./population-sql";
export * from "./population-snapshots";
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
