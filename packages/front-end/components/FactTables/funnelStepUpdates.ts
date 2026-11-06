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
 * - overrides move with their steps
 * - a step whose table now differs from its new predecessor becomes overridden
 */
export function moveFunnelStep(
  steps: FunnelStep[],
  from: number,
  to: number,
  overriddenTables: ReadonlySet<number>,
) {
  if (from === to || from < 1 || to < 1 || to >= steps.length) return null;
  const order = steps.map((_, i) => i);
  order.splice(to, 0, ...order.splice(from, 1));
  const next = renumberStepNames(order.map((i) => steps[i]));
  const overrides = new Set(
    order.flatMap((orig, i) =>
      i > 0 &&
      (overriddenTables.has(orig) ||
        next[i].factTableId !== next[i - 1].factTableId)
        ? [i]
        : [],
    ),
  );
  return { steps: next, overriddenTables: overrides };
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
