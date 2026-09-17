import type { NotificationEvent } from "shared/types/events/notification-events";
import { buildExperimentAlertMessage } from "back-end/src/events/handlers/slack/experimentAlerts";
import { getSlackMessageForNotificationEvent } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import { buildNotificationCard } from "back-end/src/services/notificationCards/renderNotificationCard";
import { notificationCardSamples } from "./notificationCard.fixtures";

describe("experiment alert messages", () => {
  it("preserves user text as plain text without enabling Slack mentions", () => {
    const event = {
      event: "experiment.status.started",
      data: {
        object: {
          type: "started",
          experimentId: "exp-1",
          experimentName: "<!channel>",
        },
      },
    } as Extract<NotificationEvent, { event: "experiment.status.started" }>;
    expect(buildExperimentAlertMessage(event).blocks[0]).toMatchObject({
      text: {
        type: "plain_text",
        text: "<!channel>: Experiment Started.",
      },
    });
  });
  it("uses the same immutable start details for Slack text and image cards", async () => {
    const sample = notificationCardSamples.find((s) => s.name === "started");
    if (!sample) throw new Error("Missing started sample");
    const event = sample.event;
    const message = await getSlackMessageForNotificationEvent(
      event,
      "event_test",
    );
    const card = buildNotificationCard(event)?.data;
    const linkedChanges =
      card && "fields" in card
        ? card.fields?.find((f) => f.label === "Linked changes")?.value
        : undefined;
    expect(linkedChanges).toBe(
      "2 Feature Flags, 1 Visual Editor change, 1 URL redirect",
    );
    expect(message?.text).toBe(
      "Checkout redesign: Experiment Started. Goal metrics: Checkout conversion, Revenue per visitor, Add to cart rate (+2 more). Linked changes: 2 Feature Flags, 1 Visual Editor change, 1 URL redirect.",
    );
    expect(message?.text).toContain(`Linked changes: ${linkedChanges}.`);
  });
  it.each([
    [
      "experiment.status.endingSoon",
      { type: "ending-soon", endsAt: "2026-09-14T00:00:00Z", daysRemaining: 3 },
      "Scheduled to end soon at 2026-09-14T00:00:00Z.",
    ],
    [
      "experiment.metric.guardrailFailure",
      {
        type: "guardrail-failed",
        failedMetrics: [
          { id: "g1", name: "Revenue", variationName: "Test A" },
          { id: "g2", name: "Errors", variationName: "Test B" },
        ],
      },
      "Failing guardrails: Revenue (Test A), Errors (Test B).",
    ],
  ])(
    "routes %s through Slack's shared message builder",
    async (name, object, detail) => {
      const event = {
        event: name,
        data: {
          object: {
            ...object,
            experimentId: "exp/1",
            experimentName: "Checkout",
          },
        },
      } as NotificationEvent;
      const message = await getSlackMessageForNotificationEvent(
        event,
        "event_test",
      );
      expect(message?.text).toBe(`Checkout: ${detail}`);
      expect(message?.blocks[0]).toMatchObject({
        text: { type: "plain_text", text: `Checkout: ${detail}` },
      });
      expect(message?.blocks[1]).toMatchObject({
        elements: [{ url: expect.stringContaining("/experiment/exp%2F1") }],
      });
    },
  );
  it.each([
    ["query", "database queries failed"],
    ["analysis", "analysis failed"],
    ["no-queries", "no queries were generated"],
    ["unknown", "an unexpected error occurred"],
  ])(
    "describes an update failure caused by %s without raw warehouse errors",
    async (cause, detail) => {
      const event = {
        event: "experiment.warning",
        data: {
          object: {
            type: "update-failed",
            cause,
            experimentId: "exp-1",
            experimentName: "Checkout",
            errorMessage: "secret SQL",
          },
        },
      } as NotificationEvent;
      const message = await getSlackMessageForNotificationEvent(
        event,
        "event_test",
      );
      expect(message?.text).toBe(
        `Checkout: Results failed to update because ${detail}.`,
      );
      expect(message?.text).not.toContain("secret SQL");
      expect(message?.blocks[0]).toMatchObject({
        text: { type: "plain_text" },
      });
    },
  );
  it.each([
    [true, "Automatic updates were turned off after a failed refresh."],
    [
      false,
      "Automatic updates could not be turned off after a failed refresh and remain on.",
    ],
  ])(
    "describes auto-updates being turned off (success: %s)",
    async (success, detail) => {
      const event = {
        event: "experiment.warning",
        data: {
          object: {
            type: "auto-update",
            success,
            experimentId: "exp-1",
            experimentName: "Checkout",
          },
        },
      } as NotificationEvent;
      const message = await getSlackMessageForNotificationEvent(
        event,
        "event_test",
      );
      expect(message?.text).toBe(`Checkout: ${detail}`);
    },
  );
  it("tells the same stop story as the card, in plain text", async () => {
    const sample = notificationCardSamples.find(
      (s) => s.name === "stopped-winner",
    );
    if (!sample) throw new Error("Missing stopped-winner sample");
    const message = await getSlackMessageForNotificationEvent(
      sample.event,
      "event_test",
    );
    expect(message?.text).toBe(
      "Checkout redesign: Experiment Stopped - Winner. Variation One-page checkout won. One-page checkout lifted conversion with no revenue regression. Shipping to 100%. Temporary rollout: Variation One-page checkout. Checkout conversion: +6.1% (Chance to win: 99.1%).",
    );
    expect(message?.blocks[0]).toMatchObject({ text: { type: "plain_text" } });
  });
  it("describes an SRM alert from its evidence with the shared shape", async () => {
    const sample = notificationCardSamples.find((s) => s.name === "srm");
    if (!sample) throw new Error("Missing srm sample");
    const message = await getSlackMessageForNotificationEvent(
      sample.event,
      "event_test",
    );
    expect(message?.text).toBe(
      "Checkout redesign: Health Alert - SRM Detected. Traffic isn't splitting as configured (p-value: <0.001, threshold 0.001). Control: 6,213 units (62.1%, expected 50%); One-page checkout: 3,787 units (37.9%, expected 50%).",
    );
    expect(message?.blocks[0]).toMatchObject({ text: { type: "plain_text" } });
    expect(message?.blocks[1]).toMatchObject({
      elements: [{ url: expect.stringContaining("/experiment/exp-checkout") }],
    });
  });
});
