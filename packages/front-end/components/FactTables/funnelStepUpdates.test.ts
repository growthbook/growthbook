import { FunnelStep } from "shared/types/fact-table";
import { updateFunnelSteps } from "./funnelStepUpdates";

const steps: FunnelStep[] = [1, 2, 3].map((number) => ({
  name: `Step ${number}`,
  factTableId: "a",
  optional: false,
  rowFilters: [{ operator: "=", column: "old_column", values: ["1"] }],
}));

it("updates inherited tables and clears filters without changing step behavior", () => {
  const result = updateFunnelSteps(
    steps,
    0,
    { factTableId: "b", rowFilters: [] },
    new Set(),
  );
  expect(result.steps.map((step) => step.factTableId)).toEqual(["b", "b", "b"]);
  expect(result.steps[1]).toEqual({
    ...steps[1],
    factTableId: "b",
    rowFilters: [],
  });
  expect(steps[1].factTableId).toBe("a");
});

it("keeps explicit overrides after the primary matches them and changes again", () => {
  const overridden = updateFunnelSteps(
    steps,
    1,
    { factTableId: "b", rowFilters: [] },
    new Set(),
  );
  const matched = updateFunnelSteps(
    overridden.steps,
    0,
    { factTableId: "b", rowFilters: [] },
    overridden.overriddenTables,
  );
  const changedAgain = updateFunnelSteps(
    matched.steps,
    0,
    { factTableId: "c", rowFilters: [] },
    matched.overriddenTables,
  );
  expect(changedAgain.steps.map((step) => step.factTableId)).toEqual([
    "c",
    "b",
    "c",
  ]);
});

it("does not treat a filter edit as a table override or propagate primary filters", () => {
  const edited = updateFunnelSteps(steps, 1, { rowFilters: [] }, new Set());
  expect(edited.overriddenTables.size).toBe(0);
  const primaryEdited = updateFunnelSteps(
    steps,
    0,
    { rowFilters: [] },
    new Set(),
  );
  expect(primaryEdited.steps[1]).toEqual(steps[1]);
});

it("keeps an explicit selection even when changed back to the primary table", () => {
  const selected = updateFunnelSteps(
    steps,
    1,
    { factTableId: "b", rowFilters: [] },
    new Set(),
  );
  const returned = updateFunnelSteps(
    selected.steps,
    1,
    { factTableId: "a", rowFilters: [] },
    selected.overriddenTables,
  );
  const changed = updateFunnelSteps(
    returned.steps,
    0,
    { factTableId: "c", rowFilters: [] },
    returned.overriddenTables,
  );
  expect(changed.steps.map((step) => step.factTableId)).toEqual([
    "c",
    "a",
    "c",
  ]);
});
