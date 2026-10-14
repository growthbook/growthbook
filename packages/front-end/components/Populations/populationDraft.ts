import omit from "lodash/omit";
import type { PopulationStep } from "shared/validators";
import { isValidPopulationAggregateFilter } from "shared/populations";
import { isRowFilterComplete } from "@/components/FactTables/rowFilterUtils";

export type PopulationDraft = {
  name: string;
  description: string;
  datasource: string;
  userIdTypes: string[];
  steps: PopulationStep[];
};

export function newPopulationStep({
  isFirst,
  negation = false,
}: {
  isFirst: boolean;
  negation?: boolean;
}): PopulationStep {
  return {
    source: { type: "factTable", factTableId: "" },
    ...(negation && { negation: true }),
    rowFilters: [],
    windowSettings: {
      type: isFirst ? "" : "conversion",
      delayValue: 0,
      delayUnit: "days",
      windowValue: isFirst ? 0 : 7,
      windowUnit: "days",
    },
  };
}

// Picks the identifier type the most fact tables in the Data Source support,
// so the first fact table picker isn't empty. Ties keep the Data Source order.
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

// The first step can't be negationd or use a conversion window, so reordering
// or deleting steps has to clear both on whichever step lands first.
export function normalizePopulationSteps(
  steps: PopulationStep[],
): PopulationStep[] {
  if (!steps.length) return steps;
  const [first, ...rest] = steps;
  if (!first.negation && first.windowSettings.type !== "conversion") {
    return steps;
  }
  return [
    {
      ...omit(first, "negation"),
      windowSettings:
        first.windowSettings.type === "conversion"
          ? { ...first.windowSettings, type: "", windowValue: 0 }
          : first.windowSettings,
    },
    ...rest,
  ];
}

export function movePopulationStep(
  steps: PopulationStep[],
  from: number,
  to: number,
): PopulationStep[] {
  if (to < 0 || to >= steps.length || from === to) return steps;
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return normalizePopulationSteps(next);
}

export function removePopulationStep(
  steps: PopulationStep[],
  index: number,
): PopulationStep[] {
  return normalizePopulationSteps(steps.filter((_, i) => i !== index));
}

// The first reason the draft can't be saved yet, or null when it's complete.
export function getPopulationDraftIssue(draft: PopulationDraft): string | null {
  if (!draft.name.trim()) return "Enter a name.";
  if (!draft.datasource) return "Choose a Data Source.";
  if (!draft.userIdTypes.length) return "Choose an identifier type.";
  for (const [i, step] of draft.steps.entries()) {
    const n = i + 1;
    if (!step.source.factTableId) return `Choose a fact table for step ${n}.`;
    if (!step.rowFilters.every(isRowFilterComplete)) {
      return `Finish the row filter in step ${n}.`;
    }
    if (
      step.aggregateFilterColumn &&
      !isValidPopulationAggregateFilter(step.aggregateFilter ?? "")
    ) {
      return `Finish the aggregate filter in step ${n}.`;
    }
    const { type, windowValue } = step.windowSettings;
    if (type && !(windowValue > 0)) {
      return `Enter a window length for step ${n}.`;
    }
  }
  return null;
}
