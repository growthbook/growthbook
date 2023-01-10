import { SlackManager } from "../services/slack/SlackManager";

export const initSlackIntegration = async (): Promise<void> => {
  const port = process.env.SLACK_APP_PORT;
  if (!port) {
    throw new Error("ImplementationError: Missing SLACK_APP_PORT");
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

  const slackManager = new SlackManager({
    signingSecret,
    port,
    oauth: {
      clientSecret,
      clientId,
    },
  });

  await slackManager.init();
};
