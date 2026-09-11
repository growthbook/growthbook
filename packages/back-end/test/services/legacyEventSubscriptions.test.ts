import { normalizeLegacySlackEvent } from "back-end/src/services/slack/legacyEventSubscriptions";

test.each(["experiment.stopped.shipped", "experiment.stopped.rolledback"])(
  "normalizes the prototype subscription %s",
  (event) => {
    expect(normalizeLegacySlackEvent(event)).toBe("experiment.stopped");
  },
);
test.each([
  "experiment.stopped",
  "experiment.started",
  "experiment.*",
  "feature.rampSchedule.actions.*",
  "unknown.event",
])("leaves other subscriptions for normal validation: %s", (event) => {
  expect(normalizeLegacySlackEvent(event)).toBe(event);
});
