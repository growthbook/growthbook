import {
  normalizeLegacySlackEvent,
  getSlackEventSubscriptionNames,
} from "back-end/src/services/slack/legacyEventSubscriptions";

test.each(["experiment.stopped.shipped", "experiment.stopped.rolledback"])(
  "normalizes the prototype subscription %s",
  (event) => {
    expect(normalizeLegacySlackEvent(event)).toBe("experiment.status.stopped");
  },
);
test.each([
  "experiment.status.started",
  "experiment.status.stopped",
  "experiment.status.*",
  "experiment.*",
  "feature.rampSchedule.actions.*",
  "unknown.event",
])("leaves other subscriptions for normal validation: %s", (event) => {
  expect(normalizeLegacySlackEvent(event)).toBe(event);
});

test.each(["experiment.health.srm", "experiment.health.multipleExposures"])(
  "matches new and existing Slack subscriptions once for %s",
  (event) => {
    const names = getSlackEventSubscriptionNames(event);
    const subscriptions = [
      ["experiment.warning"],
      [event],
      ["experiment.*"],
      ["experiment.health.*"],
      [event, "experiment.warning", "experiment.*"],
      ["experiment.health.queryFailure"],
      ["feature.*"],
    ];
    expect(
      subscriptions.filter((events) =>
        events.some((name) => names.includes(name)),
      ),
    ).toHaveLength(5);
    expect(new Set(names).size).toBe(names.length);
  },
);

test.each([
  ["experiment.started", "experiment.status.started"],
  ["experiment.stopped", "experiment.status.stopped"],
  ["experiment.endingSoon", "experiment.status.endingSoon"],
  ["experiment.stale", "experiment.status.stale"],
  ["experiment.health.queryFailed", "experiment.health.updateFailure"],
  ["experiment.health.queryFailure", "experiment.health.updateFailure"],
  ["experiment.health.guardrailFailed", "experiment.metric.guardrailFailure"],
  ["experiment.holdout.updated", "holdout.config.newLinkage"],
])("keeps the renamed subscription %s working", (previous, current) => {
  expect(normalizeLegacySlackEvent(previous)).toBe(current);
  expect(getSlackEventSubscriptionNames(current)).toContain(previous);
  expect(getSlackEventSubscriptionNames(current)).not.toContain(
    "experiment.warning",
  );
});

test.each(["started", "stopped", "endingSoon", "stale"])(
  "matches the status wildcard for %s",
  (name) => {
    const subscriptions = getSlackEventSubscriptionNames(
      `experiment.status.${name}`,
    );
    expect(subscriptions).toContain("experiment.status.*");
    expect(subscriptions).toContain("experiment.*");
    expect(new Set(subscriptions).size).toBe(subscriptions.length);
    expect(subscriptions.includes("experiment.status.changed")).toBe(
      name === "started" || name === "stopped",
    );
  },
);
