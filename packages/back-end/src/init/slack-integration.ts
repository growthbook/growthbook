import { SlackManager } from "../services/slack/SlackManager";
import { logger } from "../util/logger";

export const initSlackIntegration = async (): Promise<void> => {
  const port = process.env.SLACK_APP_PORT;
  if (!port) {
    throw new Error("ImplementationError: Missing SLACK_APP_PORT");
  }

  const botToken = process.env.SLACK_BOT_OAUTH_TOKEN;
  if (!botToken) {
    throw new Error("ImplementationError: Missing SLACK_BOT_OAUTH_TOKEN");
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error("ImplementationError: Missing SLACK_SIGNING_SECRET");
  }

  const clientId = process.env.SLACK_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error("ImplementationError: Missing SLACK_OAUTH_CLIENT_ID");
  }

  const clientSecret = process.env.SLACK_OAUTH_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error("ImplementationError: Missing SLACK_OAUTH_CLIENT_SECRET");
  }

  const stateSecret = process.env.SLACK_OAUTH_STATE_SECRET;
  if (!stateSecret) {
    throw new Error("ImplementationError: Missing SLACK_OAUTH_STATE_SECRET");
  }

  const slackManager = new SlackManager({
    botToken,
    signingSecret,
    port,
    oauth: {
      clientSecret,
      clientId,
      stateSecret,
    },
  });

  await slackManager.init();

  logger.info("⚡️ Slack Bolt app is running!");
};
