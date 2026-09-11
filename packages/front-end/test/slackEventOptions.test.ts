import { notificationEventNames } from "shared/validators";
import {
  slackEventOptions,
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
