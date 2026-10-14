import type { NotificationEvent } from "shared/types/events/notification-events";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { escapeInlineMarkdown } from "back-end/src/services/notificationCards/markdown";
import { type AlertField, buildAlertMessage } from "./alertMessage";
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

const stage = (s: string) => s.replace("analysis-period", "analysis period");

export function buildHoldoutAlertMessage(event: HoldoutAlert): SlackMessage {
  const object = event.data.object;
  let label: string;
  let fields: AlertField[];
  switch (event.event) {
    case "holdout.created":
      label = "Holdout Created";
      fields = [];
      break;
    case "holdout.status.changed":
      label = "Holdout Status Changed";
      fields = [
        {
          label: "Status",
          value: `${stage(event.data.object.previousStatus)} → ${stage(event.data.object.currentStatus)}`,
        },
      ];
      break;
    case "holdout.config.newLinkage": {
      const { featureIds, experimentIds } = event.data.object;
      label = "Holdout Linkage Added";
      fields = [
        ...(featureIds.length
          ? [
              {
                label: "Linked Feature Flags",
                value: featureIds.map(escapeInlineMarkdown).join(", "),
              },
            ]
          : []),
        ...(experimentIds.length
          ? [
              {
                label: "Linked experiments",
                value: experimentIds.map(escapeInlineMarkdown).join(", "),
              },
            ]
          : []),
      ];
      break;
    }
  }
  return buildAlertMessage({
    name: object.holdoutName,
    label,
    fields,
    url: `${APP_ORIGIN}/holdout/${encodeURIComponent(object.holdoutId)}`,
    ownerEmail: object.ownerEmail,
  });
}
