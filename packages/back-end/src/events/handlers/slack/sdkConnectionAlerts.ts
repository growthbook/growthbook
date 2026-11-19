import type { NotificationEvent } from "shared/types/events/notification-events";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { escapeInlineMarkdown } from "back-end/src/services/notificationCards/markdown";
import { buildAlertMessage } from "./alertMessage";
import type { SlackMessage } from "./slack-event-handler-utils";

type SdkConnectionAlert = Extract<
  NotificationEvent,
  { event: "sdkConnection.payloadSize.warning" }
>;

type SdkProxyAlert = Extract<
  NotificationEvent,
  {
    event:
      | "sdkConnection.proxy.failing"
      | "sdkConnection.proxy.disabled"
      | "sdkConnection.proxy.recovered";
  }
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

export function buildSdkProxyAlertMessage(event: SdkProxyAlert): SlackMessage {
  const object = event.data.object;
  const url = `${APP_ORIGIN}/sdks/${encodeURIComponent(object.connectionId)}`;
  switch (event.event) {
    case "sdkConnection.proxy.recovered":
      return buildAlertMessage({
        name: object.connectionName,
        label: "Proxy Recovered",
        fields: [],
        url,
      });
    case "sdkConnection.proxy.failing":
      return buildAlertMessage({
        name: object.connectionName,
        label: "Proxy Failing",
        fields: [
          {
            label: "Error",
            value: escapeInlineMarkdown(event.data.object.error),
          },
        ],
        url,
      });
    case "sdkConnection.proxy.disabled":
      return buildAlertMessage({
        name: object.connectionName,
        label: "Proxy Disabled",
        fields: [
          {
            label: "Error",
            value: escapeInlineMarkdown(event.data.object.error),
          },
          {
            label: "Next step",
            value:
              "Fix the cause, then use Recheck on the SDK Connection to turn the proxy back on. If changes to the connection need approval, publish an approved change that enables the proxy instead.",
          },
        ],
        url,
      });
  }
}
