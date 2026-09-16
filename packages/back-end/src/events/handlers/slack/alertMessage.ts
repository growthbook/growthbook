import type { SlackMessage } from "./slack-event-handler-utils";

// Every experiment and holdout notification shares one Slack shape: a plain
// text sentence ("<name>: <detail>") and a "View in GrowthBook" button.
// Plain text (not mrkdwn) so user-authored names and reasons cannot inject
// formatting or mentions.
export function buildAlertMessage({
  name,
  detail,
  url,
}: {
  name: string;
  detail: string;
  url: string;
}): SlackMessage {
  const text = `${name}: ${detail}`;
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
            url,
          },
        ],
      },
    ],
  };
}
