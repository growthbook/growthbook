import { FunnelStep } from "shared/types/fact-table";

const DEFAULT_STEP_NAME = /^Step \d+$/;

/** Default "Step N" names follow position; custom names are kept. */
export function renumberStepNames<T extends { name: string }>(steps: T[]): T[] {
  return steps.map((step, i) =>
    DEFAULT_STEP_NAME.test(step.name) && step.name !== `Step ${i + 1}`
      ? { ...step, name: `Step ${i + 1}` }
      : step,
  );
}

export function updateFunnelSteps(
  steps: FunnelStep[],
  index: number,
  updates: Partial<FunnelStep>,
  overriddenTables: ReadonlySet<number>,
  initialFilters: (id: string) => FunnelStep["rowFilters"] = () => [],
) {
  const overrides = new Set(overriddenTables);
  if (index > 0 && updates.factTableId !== undefined) overrides.add(index);
  const next = steps.map((step, i) =>
    i === index ? { ...step, ...updates } : step,
  );
  for (let i = 1; i < next.length; i++) {
    const factTableId = next[i - 1].factTableId;
    if (!overrides.has(i) && next[i].factTableId !== factTableId) {
      next[i] = {
        ...next[i],
        factTableId,
        rowFilters: initialFilters(factTableId),
      };
    }
  }
  return { overriddenTables: overrides, steps: next };
}

/**
 * Moves a step; null for moves involving pinned step 1.
 * - each step keeps its fact table: overrides recomputed from the new order
 */
export function moveFunnelStep(steps: FunnelStep[], from: number, to: number) {
  if (from === to || from < 1 || to < 1 || to >= steps.length) return null;
  const moved = [...steps];
  moved.splice(to, 0, ...moved.splice(from, 1));
  const next = renumberStepNames(moved);
  const overriddenTables = new Set(
    next.flatMap((step, i) =>
      i > 0 && step.factTableId !== next[i - 1].factTableId ? [i] : [],
    ),
  );
  return { steps: next, overriddenTables };
}

/** Inserts `newStep` at `atIndex`; overrides move with their steps. */
export function insertFunnelStep(
  steps: FunnelStep[],
  atIndex: number,
  newStep: FunnelStep,
  overriddenTables: ReadonlySet<number>,
) {
  const next = renumberStepNames([
    ...steps.slice(0, atIndex),
    newStep,
    ...steps.slice(atIndex),
  ]);
  const overrides = new Set(
    [...overriddenTables].map((i) => (i >= atIndex ? i + 1 : i)),
  );
  return { steps: next, overriddenTables: overrides };
}
