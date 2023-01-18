import { KnownBlock } from "@slack/web-api";
import fetch from "node-fetch";
import { logger } from "../../../util/logger";

export type SlackMessage = {
  text: string;
  blocks: KnownBlock[];
};

/**
 * Sends a Slack message.
 * @param slackMessage
 * @param webHookEndpoint
 * @throws Error If the request fails
 */
export const sendSlackMessage = async (
  slackMessage: SlackMessage,
  webHookEndpoint: string
): Promise<boolean> => {
  try {
    const response = await fetch(webHookEndpoint, {
      method: "POST",
      body: JSON.stringify(slackMessage),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error("Failed to send Slack integration message", { text });
    }

    return response.ok;
  } catch (e) {
    logger.error(e);
    return false;
  }
};
