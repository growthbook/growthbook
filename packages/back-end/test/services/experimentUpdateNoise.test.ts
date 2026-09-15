import isEqual from "lodash/isEqual";
import { getObjectDiff } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import { isBookkeepingExperimentUpdate } from "back-end/src/events/experimentUpdateNoise";

const base = {
  id: "exp_1",
  name: "Checkout",
  status: "running",
  autoRefresh: true,
  phases: [{ seed: "a", trafficSplit: [0.5, 0.5] }],
};
const event = (data: unknown) => ({ event: "experiment.updated", data });
const empty = { added: {}, removed: {}, modified: [] };
const update = (
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
) =>
  event(
    JSON.parse(
      JSON.stringify({
        object: current,
        previous_attributes: Object.fromEntries(
          [...new Set([...Object.keys(previous), ...Object.keys(current)])]
            .filter((key) => !isEqual(previous[key], current[key]))
            .map((key) => [key, previous[key]]),
        ),
        changes: getObjectDiff(previous, current, {
          ignoredKeys: ["dateUpdated"],
        }),
      }),
    ),
  );

test("suppresses refresh bookkeeping without mutating snapshots", () => {
  const current = {
    ...base,
    dateUpdated: "today",
    lastSnapshotAttempt: "today",
    nextSnapshotAttempt: "tomorrow",
  };
  expect(isBookkeepingExperimentUpdate(update(base, current))).toBe(true);
  expect(current.dateUpdated).toBe("today");
});
test("suppresses internal bandit history but retains allocation and seed changes", () => {
  expect(
    isBookkeepingExperimentUpdate(
      update(base, {
        ...base,
        phases: [{ ...base.phases[0], banditEvents: ["refresh"] }],
      }),
    ),
  ).toBe(true);
  for (const fields of [{ seed: "b" }, { trafficSplit: [0.25, 0.75] }]) {
    expect(
      isBookkeepingExperimentUpdate(
        update(base, {
          ...base,
          phases: [{ ...base.phases[0], ...fields }],
        }),
      ),
    ).toBe(false);
  }
});
test.each([
  { name: "New name" },
  { status: "stopped" },
  { autoRefresh: false },
  { unknownNewField: true },
])("retains meaningful and unfamiliar changes %j", (change) => {
  expect(
    isBookkeepingExperimentUpdate(update(base, { ...base, ...change })),
  ).toBe(false);
});
test("retains meaningful field removal", () => {
  const { autoRefresh, ...current } = base;
  expect(autoRefresh).toBe(true);
  expect(isBookkeepingExperimentUpdate(update(base, current))).toBe(false);
});
test("retains changes excluded from the display diff", () => {
  expect(
    isBookkeepingExperimentUpdate(
      event({
        object: { ...base, name: "Changed" },
        previous_attributes: { name: base.name },
        changes: empty,
      }),
    ),
  ).toBe(false);
});
test("retains updates when the diff could not be built", () => {
  expect(
    isBookkeepingExperimentUpdate(
      event({
        object: { ...base, newField: true },
        previous_attributes: {},
      }),
    ),
  ).toBe(false);
});
test("suppresses a structurally empty diff when snapshots are unavailable", () => {
  expect(isBookkeepingExperimentUpdate(event({ changes: empty }))).toBe(true);
});
test.each([
  null,
  {},
  { changes: null },
  { changes: {} },
  { changes: { ...empty, modified: [{}] } },
  { changes: { ...empty, unfamiliar: true } },
])("retains missing or uncertain diffs %j", (data) => {
  expect(isBookkeepingExperimentUpdate(event(data))).toBe(false);
});
test("does not suppress other events", () => {
  expect(
    isBookkeepingExperimentUpdate({
      event: "experiment.started",
      data: { changes: empty },
    }),
  ).toBe(false);
});
