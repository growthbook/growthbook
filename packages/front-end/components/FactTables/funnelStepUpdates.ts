import { FunnelStep } from "shared/types/fact-table";

export function updateFunnelSteps(
  steps: FunnelStep[],
  index: number,
  updates: Partial<FunnelStep>,
  overriddenTables: ReadonlySet<number>,
) {
  const tableChanged =
    updates.factTableId !== undefined &&
    updates.factTableId !== steps[index].factTableId;
  const overrides = new Set(overriddenTables);
  if (index > 0 && tableChanged) overrides.add(index);

  return {
    overriddenTables: overrides,
    steps: steps.map((step, i) => {
      if (i === index) return { ...step, ...updates };
      if (
        index === 0 &&
        tableChanged &&
        updates.factTableId !== undefined &&
        !overrides.has(i) &&
        step.factTableId !== updates.factTableId
      ) {
        return {
          ...step,
          factTableId: updates.factTableId,
          rowFilters: updates.rowFilters ?? [],
        };
      }
      return step;
    }),
  };
}
