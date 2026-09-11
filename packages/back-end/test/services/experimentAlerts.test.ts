import type { NotificationEvent } from "shared/types/events/notification-events";
import { buildExperimentAlertMessage } from "back-end/src/events/handlers/slack/experimentAlerts";
import { getSlackMessageForNotificationEvent } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import { buildEventSnapshotCard } from "back-end/src/services/notificationCards/eventSnapshotCard";
import { eventSnapshotCardSamples } from "./eventSnapshotCard.fixtures";

describe("experiment alert messages", () => {
  it("preserves user text as plain text without enabling Slack mentions", () => {
    const event = {
      event: "experiment.status.started",
      data: {
        object: {
          type: "started",
          experimentId: "exp-1",
          experimentName: "<!channel>",
          variationCount: 3,
        },
      },
    } as Extract<NotificationEvent, { event: "experiment.status.started" }>;
    expect(buildExperimentAlertMessage(event).blocks[0]).toMatchObject({
      text: {
        type: "plain_text",
        text: "<!channel>: Started.",
      },
    });
  });
  it("uses the same immutable start details for Slack text and image cards", async () => {
    const event = eventSnapshotCardSamples[0].event;
    const message = await getSlackMessageForNotificationEvent(
      event,
      "event_test",
    );
    const summary = buildEventSnapshotCard(event)?.summary?.[0];
    expect(summary).toBe(
      "Started with 2 linked Feature Flags, 1 Visual Editor change, 1 URL redirect.",
    );
    expect(message?.text).toContain(summary);
  });
  it.each([
    [
      "experiment.status.endingSoon",
      { type: "ending-soon", endsAt: "2026-09-14T00:00:00Z", daysRemaining: 3 },
      "Scheduled to end soon at 2026-09-14T00:00:00Z.",
    ],
    [
      "experiment.health.updateFailure",
      { type: "update-failed", cause: "query", errorMessage: "secret SQL" },
      "Results failed to update because database queries failed.",
    ],
    [
      "experiment.health.updateFailure",
      { type: "update-failed", cause: "analysis" },
      "Results failed to update because analysis failed.",
    ],
    [
      "experiment.health.updateFailure",
      { type: "update-failed", cause: "no-queries" },
      "Results failed to update because no queries were generated.",
    ],
    [
      "experiment.health.srm",
      { type: "srm", threshold: 0.001 },
      "Sample ratio mismatch detected (threshold: 0.001).",
    ],
    [
      "experiment.health.multipleExposures",
      { type: "multiple-exposures", usersCount: 50, percent: 0.025 },
      "50 users (2.50%) were exposed to multiple variations.",
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
  it("does not send raw warehouse errors into Slack", () => {
    const event = {
      event: "experiment.health.updateFailure",
      data: {
        object: {
          type: "update-failed",
          cause: "query",
          experimentId: "exp-1",
          experimentName: "Checkout",
          errorMessage: "secret SQL",
        },
      },
    } as Extract<
      NotificationEvent,
      { event: "experiment.health.updateFailure" }
    >;
    expect(buildExperimentAlertMessage(event).text).not.toContain("secret SQL");
  });
});
