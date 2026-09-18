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
