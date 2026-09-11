import { notificationEventNames } from "shared/validators";
import {
  slackEventOptions,
  slackNotificationLevel,
  slackEventsForLevel,
  applySlackNotificationLevel,
  slackEventSelection,
  toggleSlackEvents,
} from "@/components/SlackIntegrations/slackEventOptions";

describe("Slack event subscriptions", () => {
  it("only offers events supported by the cards PR", () => {
    const offered = slackEventOptions.flatMap((option) => option.events);
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
      slackEventSelection(events, [
        "experiment.decision.ship",
        "experiment.decision.rollback",
      ]),
    ).toBe("indeterminate");
    expect(events).toEqual(["experiment.decision.ship"]);
  });

  it("recognizes both resource and subgroup wildcards", () => {
    expect(slackEventSelection(["experiment.*"], ["experiment.warning"])).toBe(
      true,
    );
    expect(
      slackEventSelection(
        ["experiment.decision.*"],
        ["experiment.decision.ship", "experiment.decision.review"],
      ),
    ).toBe(true);
    expect(slackEventSelection(["feature.*"], ["experiment.warning"])).toBe(
      false,
    );
  });

  it("customizes one event without changing unrelated subscriptions", () => {
    const result = toggleSlackEvents(
      ["experiment.*", "feature.*", "custom.future"],
      ["experiment.warning"],
      false,
    );
    expect(result).not.toContain("experiment.*");
    expect(result).not.toContain("experiment.warning");
    expect(result).toContain("experiment.info.significance");
    expect(result).toContain("feature.*");
    expect(result).toContain("custom.future");
    expect(slackEventSelection(result, ["experiment.warning"])).toBe(false);
  });

  it("removes all overlapping wildcard and explicit selections", () => {
    const result = toggleSlackEvents(
      ["experiment.*", "experiment.decision.*", "experiment.decision.ship"],
      ["experiment.decision.ship"],
      false,
    );
    expect(slackEventSelection(result, ["experiment.decision.ship"])).toBe(
      false,
    );
    expect(slackEventSelection(result, ["experiment.decision.rollback"])).toBe(
      true,
    );
    expect(new Set(result).size).toBe(result.length);
  });

  it("does not expand or duplicate an existing wildcard when enabling a group", () => {
    expect(
      toggleSlackEvents(
        ["experiment.*", "feature.*"],
        ["experiment.warning"],
        true,
      ),
    ).toEqual(["experiment.*", "feature.*"]);
    expect(
      toggleSlackEvents(
        ["experiment.decision.ship"],
        ["experiment.decision.ship", "experiment.decision.review"],
        true,
      ),
    ).toEqual(["experiment.decision.ship", "experiment.decision.review"]);
  });
});

describe("Slack notification levels", () => {
  it("applies a preset only to its subject", () => {
    const original = ["experiment.*", "feature.*", "custom.future"];
    const next = applySlackNotificationLevel(
      original,
      "experiment",
      "important",
    );
    expect(next).toContain("feature.*");
    expect(next).toContain("custom.future");
    expect(next).not.toContain("experiment.*");
    expect(next).toContain("experiment.info.significance");
    expect(next).toContain("experiment.warning");
    expect(original).toEqual(["experiment.*", "feature.*", "custom.future"]);
  });
  it("classifies exact defaults and custom partial groups", () => {
    expect(
      slackNotificationLevel(
        slackEventsForLevel("feature", "default"),
        "feature",
      ),
    ).toBe("default");
    expect(
      slackNotificationLevel(["experiment.decision.ship"], "experiment"),
    ).toBe("custom");
    expect(slackNotificationLevel(["experiment.*"], "experiment")).toBe(
      "custom",
    );
  });
  it("full contains every visible event for that subject without enabling other subjects", () => {
    const full = slackEventsForLevel("experiment", "full");
    expect(new Set(full)).toEqual(
      new Set(
        slackEventOptions
          .filter((option) => option.category === "experiment")
          .flatMap((option) => option.events),
      ),
    );
    expect(full.every((event) => event.startsWith("experiment."))).toBe(true);
  });
  it("manual edits move a preset to custom and preserve the other subject", () => {
    const presets = applySlackNotificationLevel(
      ["feature.*"],
      "experiment",
      "full",
    );
    const edited = toggleSlackEvents(presets, ["experiment.warning"], false);
    expect(slackNotificationLevel(edited, "experiment")).toBe("custom");
    expect(edited).toContain("feature.*");
  });
});
