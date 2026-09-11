import { isNoisyExperimentUpdate } from "back-end/src/services/slack/experimentUpdateNoise";

const base = {
  id: "exp_1",
  name: "Checkout",
  phases: [{ seed: "a", trafficSplit: [0.5, 0.5] }],
};
const event = (data: unknown) => ({ event: "experiment.updated", data });
const empty = { added: {}, removed: {}, modified: [] };

test("suppresses refresh bookkeeping without mutating snapshots", () => {
  const current = {
    ...base,
    dateUpdated: "today",
    lastSnapshotAttempt: "today",
    nextSnapshotAttempt: "tomorrow",
  };
  expect(
    isNoisyExperimentUpdate(event({ object: current, previous_object: base })),
  ).toBe(true);
  expect(current.dateUpdated).toBe("today");
});
test("suppresses internal bandit history but retains allocation and seed changes", () => {
  expect(
    isNoisyExperimentUpdate(
      event({
        object: {
          ...base,
          phases: [{ ...base.phases[0], banditEvents: ["refresh"] }],
        },
        previous_object: base,
      }),
    ),
  ).toBe(true);
  for (const fields of [{ seed: "b" }, { trafficSplit: [0.25, 0.75] }]) {
    expect(
      isNoisyExperimentUpdate(
        event({
          object: { ...base, phases: [{ ...base.phases[0], ...fields }] },
          previous_object: base,
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
    isNoisyExperimentUpdate(
      event({
        object: { ...base, ...change },
        previous_object: base,
        changes: empty,
      }),
    ),
  ).toBe(false);
});
test("suppresses a structurally empty diff when snapshots are unavailable", () => {
  expect(isNoisyExperimentUpdate(event({ changes: empty }))).toBe(true);
});
test.each([
  null,
  {},
  { changes: null },
  { changes: {} },
  { changes: { ...empty, modified: [{}] } },
  { changes: { ...empty, unfamiliar: true } },
])("retains missing or uncertain diffs %j", (data) => {
  expect(isNoisyExperimentUpdate(event(data))).toBe(false);
});
test("does not suppress other events", () => {
  expect(
    isNoisyExperimentUpdate({
      event: "experiment.started",
      data: { changes: empty },
    }),
  ).toBe(false);
});
