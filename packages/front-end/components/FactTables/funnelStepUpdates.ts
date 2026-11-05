import { FunnelStep } from "shared/types/fact-table";

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
 * Moves a step to a new position; returns null for moves involving step 1.
 * - step 1 is pinned: it's the metric's primary fact table
 * - each step keeps its own fact table: overrides are recomputed from the new
 *   order instead of re-inheriting from the new predecessor
 * - default "Step N" names follow position
 */
export function moveFunnelStep(steps: FunnelStep[], from: number, to: number) {
  if (from === to || from < 1 || to < 1 || to >= steps.length) return null;
  const order = steps.map((_, i) => i);
  order.splice(to, 0, ...order.splice(from, 1));
  const next = order.map((originalIndex, i) => {
    const step = steps[originalIndex];
    return step.name === `Step ${originalIndex + 1}`
      ? { ...step, name: `Step ${i + 1}` }
      : step;
  });
  const overriddenTables = new Set(
    next.flatMap((step, i) =>
      i > 0 && step.factTableId !== next[i - 1].factTableId ? [i] : [],
    ),
  );
  return { steps: next, overriddenTables };
}

/**
 * Inserts `newStep` at `atIndex`, shifting later steps down.
 * - overrides move with their steps; the new step inherits (not overridden)
 * - default "Step N" names follow position
 */
export function insertFunnelStep(
  steps: FunnelStep[],
  atIndex: number,
  newStep: FunnelStep,
  overriddenTables: ReadonlySet<number>,
) {
  const next = [
    ...steps.slice(0, atIndex),
    newStep,
    ...steps
      .slice(atIndex)
      .map((step, i) =>
        step.name === `Step ${atIndex + i + 1}`
          ? { ...step, name: `Step ${atIndex + i + 2}` }
          : step,
      ),
  ];
  const overrides = new Set(
    [...overriddenTables].map((i) => (i >= atIndex ? i + 1 : i)),
  );
  return { steps: next, overriddenTables: overrides };
}
