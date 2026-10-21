import type { PopulationStep } from "shared/validators";
import {
  getPopulationRuleViolations,
  isValidPopulationAggregateFilter,
  type PopulationRuleFactTable,
} from "shared/populations";
import { isRowFilterComplete } from "@/components/FactTables/rowFilterUtils";

// The editor only supports single-step Populations for now, so a draft holds
// one step and saves it as `steps: [step]`.
export type PopulationDraft = {
  name: string;
  description: string;
  datasource: string;
  userIdTypes: string[];
  step: PopulationStep;
};

export function newPopulationStep(): PopulationStep {
  return {
    source: { type: "factTable", factTableId: "" },
    rowFilters: [],
    windowSettings: {
      type: "",
      delayValue: 0,
      delayUnit: "days",
      windowValue: 0,
      windowUnit: "days",
    },
  };
}

// Picks the identifier type the most fact tables in the Data Source support,
// so the fact table picker isn't empty. Ties keep the Data Source order.
export function getDefaultPopulationUserIdType(
  userIdTypes: string[],
  factTables: { datasource: string; userIdTypes: string[] }[],
  datasource: string,
): string | null {
  let best: string | null = null;
  let bestCount = -1;
  for (const t of userIdTypes) {
    const count = factTables.filter(
      (ft) => ft.datasource === datasource && ft.userIdTypes.includes(t),
    ).length;
    if (count > bestCount) {
      best = t;
      bestCount = count;
    }
  }
  return best;
}

// The first reason the draft can't be saved yet, or null when it's complete.
// Incomplete fields come first, then the same rules the server enforces.
// `factTables` must carry full columns (with jsonFields) for the step's fact
// table, or JSON sub-field aggregates are rejected.
export function getPopulationDraftIssue(
  draft: PopulationDraft,
  factTables: PopulationRuleFactTable[],
): string | null {
  const { step } = draft;
  if (!draft.name.trim()) return "Enter a name.";
  if (!draft.datasource) return "Choose a Data Source.";
  if (!draft.userIdTypes.length) return "Choose an identifier type.";
  if (!step.source.factTableId) return "Choose a fact table.";
  if (!step.rowFilters.every(isRowFilterComplete)) {
    return "Finish the row filter.";
  }
  if (
    step.aggregateFilterColumn &&
    !isValidPopulationAggregateFilter(step.aggregateFilter ?? "")
  ) {
    return "Finish the aggregate filter.";
  }
  const { type, windowValue } = step.windowSettings;
  if (type && !(windowValue > 0)) return "Enter a window length.";
  const [violation] = getPopulationRuleViolations({
    datasource: draft.datasource,
    userIdTypes: draft.userIdTypes,
    steps: [step],
    factTables,
  });
  return violation ?? null;
}
