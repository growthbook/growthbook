import type { NotificationEvent } from "shared/types/events/notification-events";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { escapeInlineMarkdown } from "back-end/src/services/notificationCards/markdown";
import { buildAlertMessage } from "./alertMessage";
import type { SlackMessage } from "./slack-event-handler-utils";

type SdkConnectionAlert = Extract<
  NotificationEvent,
  { event: "sdkConnection.payloadSize.warning" }
>;

const LEVEL_LABELS = {
  warning: "Payload Size Warning",
  danger: "Payload Nearing Size Limit",
  "over-limit": "Payload Over Size Limit",
};

export function buildSdkConnectionAlertMessage(
  event: SdkConnectionAlert,
): SlackMessage {
  const object = event.data.object;
  return buildAlertMessage({
    name: object.connectionName,
    label: LEVEL_LABELS[object.level],
    fields: [
      { label: "Size", value: escapeInlineMarkdown(object.message) },
      ...(object.recommendations.length
        ? [
            {
              label: "Ways to shrink it",
              value: object.recommendations
                .map((r) => `- ${escapeInlineMarkdown(r.message)}`)
                .join("\n"),
            },
          ]
        : []),
    ],
    url: `${APP_ORIGIN}/sdks/${encodeURIComponent(object.connectionId)}`,
  });
}
