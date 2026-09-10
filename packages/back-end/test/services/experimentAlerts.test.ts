import type { NotificationEvent } from "shared/types/events/notification-events";
import { buildExperimentAlertMessage } from "back-end/src/events/handlers/slack/experimentAlerts";

describe("experiment alert messages", () => {
  it("preserves user text as plain text without enabling Slack mentions", () => {
    const event = {
      event: "experiment.started",
      data: {
        object: {
          type: "started",
          experimentId: "exp-1",
          experimentName: "<!channel>",
          variationCount: 3,
        },
      },
    } as Extract<NotificationEvent, { event: "experiment.started" }>;
    expect(buildExperimentAlertMessage(event).blocks[0]).toMatchObject({
      text: {
        type: "plain_text",
        text: "<!channel>: Started with 3 variations.",
      },
    });
  });
  it("does not send raw warehouse errors into Slack", () => {
    const event = {
      event: "experiment.health.queryFailed",
      data: {
        object: {
          type: "query-failed",
          experimentId: "exp-1",
          experimentName: "Checkout",
          errorMessage: "secret SQL",
        },
      },
    } as Extract<NotificationEvent, { event: "experiment.health.queryFailed" }>;
    expect(buildExperimentAlertMessage(event).text).not.toContain("secret SQL");
  });
});
