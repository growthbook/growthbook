import type { NotificationEvent } from "shared/types/events/notification-events";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import type { SlackMessage } from "./slack-event-handler-utils";

type HoldoutAlert = Extract<
  NotificationEvent,
  {
    event:
      | "holdout.created"
      | "holdout.status.changed"
      | "holdout.config.newLinkage";
  }
>;

export function buildHoldoutAlertMessage(event: HoldoutAlert): SlackMessage {
  const object = event.data.object;
  let detail: string;
  switch (event.event) {
    case "holdout.created":
      detail = "Holdout created.";
      break;
    case "holdout.status.changed":
      detail = `Status changed from ${event.data.object.previousStatus.replace("analysis-period", "analysis period")} to ${event.data.object.currentStatus.replace("analysis-period", "analysis period")}.`;
      break;
    case "holdout.config.newLinkage": {
      const { featureIds, experimentIds } = event.data.object;
      detail = [
        ...(featureIds.length
          ? [`Linked Feature Flags: ${featureIds.join(", ")}.`]
          : []),
        ...(experimentIds.length
          ? [`Linked experiments: ${experimentIds.join(", ")}.`]
          : []),
      ].join(" ");
      break;
    }
  }
  const text = `${object.holdoutName}: ${detail}`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: { type: "plain_text", text: text.slice(0, 3000), emoji: false },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View in GrowthBook" },
            url: `${APP_ORIGIN}/holdout/${encodeURIComponent(object.holdoutId)}`,
          },
        ],
      },
    ],
  };
}
