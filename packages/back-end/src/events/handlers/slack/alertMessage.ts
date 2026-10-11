import type { KnownBlock } from "@slack/types";
import {
  markdownToPlainText,
  markdownToSlackMrkdwn,
} from "back-end/src/services/notificationCards/markdown";
import {
  escapeSlackMrkdwn,
  truncateSlackText,
} from "back-end/src/util/slack.util";
import type { SlackMessage } from "./slack-event-handler-utils";

// The footer under every alert: a link to the object, any facts the event
// recorded, then the owner. The link is the only way to the object from the
// message: there is no button.
export interface AlertFooter {
  name: string;
  url: string;
  ownerEmail?: string;
  // Already-formatted facts shown between the link and the owner, e.g.
  // "11 days". Resource-specific builders decide what goes here.
  details?: string[];
}

// A header over a value, the same label-over-value pairs the cards show.
// Values are card markdown; user text inside them is already escaped.
export interface AlertField {
  label: string;
  value: string;
}

// "<url|Checkout redesign> | 314 days | 67,970 users | Owner: a@b.com". The
// name and email are user-supplied, so they are escaped; the URL is ours.
export function alertFooterText({
  name,
  url,
  ownerEmail,
  details = [],
}: AlertFooter): string {
  return [
    `<${url}|${escapeSlackMrkdwn(name)}>`,
    ...details.map(escapeSlackMrkdwn),
    ownerEmail ? `Owner: ${escapeSlackMrkdwn(ownerEmail)}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
}

export function alertFooterBlock(footer: AlertFooter): KnownBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: alertFooterText(footer) }],
  };
}

const sentence = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);

// Every text notification follows the card layout:
//
//   *Name* - Label
//   *Header*
//   value
//   footer
//
// `blocks` slot in between the fields and the footer for messages with more
// to show (an update diff). The plain `text` is the notification preview.
export function buildAlertMessage({
  label,
  fields = [],
  blocks = [],
  ...footer
}: AlertFooter & {
  label: string;
  fields?: AlertField[];
  blocks?: KnownBlock[];
}): SlackMessage {
  const title = `*${escapeSlackMrkdwn(footer.name)}* - ${escapeSlackMrkdwn(label)}`;
  const body = fields
    .map(
      (f) =>
        `*${escapeSlackMrkdwn(f.label)}*\n${markdownToSlackMrkdwn(f.value)}`,
    )
    .join("\n\n");
  const text = [
    `${footer.name} - ${label}.`,
    ...fields.map(
      (f) => `${f.label}: ${sentence(markdownToPlainText(f.value))}`,
    ),
  ].join(" ");
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: title } },
      ...(body
        ? [
            {
              type: "section" as const,
              text: {
                type: "mrkdwn" as const,
                text: truncateSlackText(body, 3000),
              },
            },
          ]
        : []),
      ...blocks,
      alertFooterBlock(footer),
    ],
  };
}
