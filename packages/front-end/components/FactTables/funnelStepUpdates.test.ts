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
    "b",
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
    "a",
  ]);
});

it("resumes inheritance when relinked, resetting filters to table defaults", () => {
  const changed = updateFunnelSteps(steps, 1, { factTableId: "b" }, new Set());
  expect(changed.steps.map((s) => s.factTableId)).toEqual(["a", "b", "b"]);
  const filters = [{ column: "event", operator: "=" as const, values: [""] }];
  const linked = updateFunnelSteps(
    changed.steps,
    1,
    {},
    new Set(),
    () => filters,
  );
  expect(linked.steps.map((s) => s.factTableId)).toEqual(["a", "a", "a"]);
  expect(linked.steps[2].rowFilters).toEqual(filters);
});

it("keeps an unlinked table independent even before it is changed", () => {
  const result = updateFunnelSteps(
    steps,
    0,
    { factTableId: "b" },
    new Set([1]),
  );
  expect(result.steps.map((s) => s.factTableId)).toEqual(["b", "a", "a"]);
});

it("inherits from the new preceding step when an override is removed", () => {
  const changed = updateFunnelSteps(steps, 1, { factTableId: "b" }, new Set());
  const remaining = changed.steps.filter((step, index) => index !== 1);
  const result = updateFunnelSteps(remaining, 0, {}, new Set());
  expect(result.steps.map((step) => step.factTableId)).toEqual(["a", "a"]);
});
