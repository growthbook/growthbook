import { KnownBlock } from "@slack/types";
import { cancellableFetch } from "back-end/src/util/http.util";
import { SLACK_BOT_TOKEN } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

export type SlackBotSendResult =
  | { ok: true; ts: string; channel: string }
  | { ok: false; error: string };

export const sendSlackBotMessage = async ({
  channel,
  blocks,
  text,
}: {
  channel: string;
  blocks: KnownBlock[];
  text: string;
}): Promise<SlackBotSendResult> => {
  if (!SLACK_BOT_TOKEN) {
    return { ok: false, error: "SLACK_BOT_TOKEN is not configured" };
  }

  try {
    const { stringBody, responseWithoutBody } = await cancellableFetch(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        },
        body: JSON.stringify({ channel, blocks, text }),
      },
      { maxTimeMs: 15000, maxContentSize: 10000 },
    );

    const parsed = JSON.parse(stringBody) as {
      ok: boolean;
      ts?: string;
      channel?: string;
      error?: string;
    };

    if (!responseWithoutBody.ok || !parsed.ok) {
      logger.error(
        { httpStatus: responseWithoutBody.status, slackError: parsed.error },
        "sendSlackBotMessage failed",
      );
      return { ok: false, error: parsed.error || "Slack returned non-OK" };
    }

    if (!parsed.ts || !parsed.channel) {
      return { ok: false, error: "Slack response missing ts or channel" };
    }

    return { ok: true, ts: parsed.ts, channel: parsed.channel };
  } catch (e) {
    logger.error(e, "sendSlackBotMessage threw");
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export const buildHelloWorldBlocks = ({
  orgName,
  userEmail,
}: {
  orgName: string;
  userEmail: string;
}): { blocks: KnownBlock[]; text: string } => {
  const text = `Hello from GrowthBook (${orgName})`;
  return {
    text,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "👋 Hello from GrowthBook" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "This is a test message from the new Slack bot integration. " +
            "If you see this, the bot token + Block Kit envelope are wired correctly.",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Org: \`${orgName}\` · Triggered by: ${userEmail} · ${new Date().toISOString()}`,
          },
        ],
      },
    ],
  };
};
