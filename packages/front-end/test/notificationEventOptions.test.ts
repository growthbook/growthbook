import {
  defaultSlackNotificationEvents,
  notificationEventNames,
} from "shared/validators";
import {
  notificationEventOptions,
  getNotificationLevel,
  notificationEventsForLevel,
  applyNotificationLevel,
  notificationEventSelection,
  toggleNotificationEvents,
} from "@/components/Notifications/notificationEventOptions";

describe("Notification event subscriptions", () => {
  it("only offers events supported by the notification registry", () => {
    const offered = notificationEventOptions.flatMap((option) => option.events);
    expect(
      offered.every((event) =>
        notificationEventNames.some((name) => name === event),
      ),
    ).toBe(true);
    expect(offered).not.toContain("experiment.health.noData");
    expect(offered).not.toContain("experiment.started");
    expect(offered).not.toContain("experiment.stopped");
    expect(offered).toContain("feature.revision.publishFailed");
  });

  it("shows partial selections without silently adding the remaining events", () => {
    const events = ["experiment.decision.ship"];
    expect(
      notificationEventSelection(events, [
        "experiment.decision.ship",
        "experiment.decision.rollback",
      ]),
    ).toBe("indeterminate");
    expect(events).toEqual(["experiment.decision.ship"]);
  });

  it("recognizes both resource and subgroup wildcards", () => {
    expect(
      notificationEventSelection(["experiment.*"], ["experiment.warning"]),
    ).toBe(true);
    expect(
      notificationEventSelection(
        ["experiment.decision.*"],
        ["experiment.decision.ship", "experiment.decision.review"],
      ),
    ).toBe(true);
    expect(
      notificationEventSelection(["feature.*"], ["experiment.warning"]),
    ).toBe(false);
  });

  it("customizes one event without changing unrelated subscriptions", () => {
    const result = toggleNotificationEvents(
      ["experiment.*", "feature.*", "custom.future"],
      ["experiment.warning"],
      false,
    );
    expect(result).not.toContain("experiment.*");
    expect(result).not.toContain("experiment.warning");
    expect(result).toContain("experiment.info.significance");
    expect(result).toContain("feature.*");
    expect(result).toContain("custom.future");
    expect(notificationEventSelection(result, ["experiment.warning"])).toBe(
      false,
    );
  });

  it("removes all overlapping wildcard and explicit selections", () => {
    const result = toggleNotificationEvents(
      ["experiment.*", "experiment.decision.*", "experiment.decision.ship"],
      ["experiment.decision.ship"],
      false,
    );
    expect(
      notificationEventSelection(result, ["experiment.decision.ship"]),
    ).toBe(false);
    expect(
      notificationEventSelection(result, ["experiment.decision.rollback"]),
    ).toBe(true);
    expect(new Set(result).size).toBe(result.length);
  });

  it("does not expand or duplicate an existing wildcard when enabling a group", () => {
    expect(
      toggleNotificationEvents(
        ["experiment.*", "feature.*"],
        ["experiment.warning"],
        true,
      ),
    ).toEqual(["experiment.*", "feature.*"]);
    expect(
      toggleNotificationEvents(
        ["experiment.decision.ship"],
        ["experiment.decision.ship", "experiment.decision.review"],
        true,
      ),
    ).toEqual(["experiment.decision.ship", "experiment.decision.review"]);
  });
});

describe("Notification levels", () => {
  it("applies a preset only to its subject", () => {
    const original = ["experiment.*", "feature.*", "custom.future"];
    const next = applyNotificationLevel(original, "experiment", "important");
    expect(next).toContain("feature.*");
    expect(next).toContain("custom.future");
    expect(next).not.toContain("experiment.*");
    expect(next).toContain("experiment.info.significance");
    expect(next).toContain("experiment.warning");
    expect(original).toEqual(["experiment.*", "feature.*", "custom.future"]);
  });
  it("classifies exact defaults and custom partial groups", () => {
    expect(
      getNotificationLevel(
        notificationEventsForLevel("feature", "default"),
        "feature",
      ),
    ).toBe("default");
    expect(
      getNotificationLevel(["experiment.decision.ship"], "experiment"),
    ).toBe("custom");
    expect(getNotificationLevel(["experiment.*"], "experiment")).toBe("full");
  });
  it("full contains every visible event for that subject without enabling other subjects", () => {
    const full = notificationEventsForLevel("experiment", "full");
    expect(new Set(full)).toEqual(
      new Set(
        notificationEventOptions
          .filter((option) => option.category === "experiment")
          .flatMap((option) => option.events),
      ),
    );
    expect(full.every((event) => event.startsWith("experiment."))).toBe(true);
  });
  it("manual edits move a preset to custom and preserve the other subject", () => {
    const presets = applyNotificationLevel(["feature.*"], "experiment", "full");
    const edited = toggleNotificationEvents(
      presets,
      ["experiment.warning"],
      false,
    );
    expect(getNotificationLevel(edited, "experiment")).toBe("custom");
    expect(edited).toContain("feature.*");
  });
});

describe("Wildcard subscriptions and levels", () => {
  it("reads the resource wildcard as full and narrower wildcards as custom", () => {
    expect(getNotificationLevel(["experiment.*"], "experiment")).toBe("full");
    expect(getNotificationLevel(["experiment.decision.*"], "experiment")).toBe(
      "custom",
    );
    expect(
      getNotificationLevel(["feature.*", "experiment.warning"], "experiment"),
    ).toBe("custom");
  });
  it("keeps the resource wildcard when full is chosen", () => {
    const events = ["experiment.*", "feature.*"];
    expect(applyNotificationLevel(events, "experiment", "full")).toEqual(
      events,
    );
  });
  it("replaces the resource wildcard with the fixed list for narrower levels", () => {
    const next = applyNotificationLevel(
      ["experiment.*", "feature.*"],
      "experiment",
      "default",
    );
    expect(next).not.toContain("experiment.*");
    expect(next).toContain("feature.*");
    expect(next.filter((event) => event.startsWith("experiment."))).toEqual(
      notificationEventsForLevel("experiment", "default"),
    );
  });
});

it("keeps new channel defaults aligned with the Default presets without significance", () => {
  const defaults = [
    ...notificationEventsForLevel("experiment", "default"),
    ...notificationEventsForLevel("feature", "default"),
  ];
  expect([...defaults].sort()).toEqual(
    [...defaultSlackNotificationEvents].sort(),
  );
  expect(defaults).not.toContain("experiment.info.significance");
  expect(notificationEventsForLevel("experiment", "full")).toContain(
    "experiment.info.significance",
  );
});

it.each(["config", "constant", "savedGroup"] as const)(
  "exposes %s events and preserves other categories when editing them",
  (category) => {
    const event = `${category}.revision.published`;
    const full = notificationEventsForLevel(category, "full");
    expect(full).toContain(event);
    const edited = toggleNotificationEvents(
      [`${category}.*`, "feature.*", "experiment.*"],
      [event],
      false,
    );
    expect(notificationEventSelection(edited, [event])).toBe(false);
    expect(edited).toContain("feature.*");
    expect(edited).toContain("experiment.*");
    expect(edited).toContain(`${category}.revision.created`);
  },
);
