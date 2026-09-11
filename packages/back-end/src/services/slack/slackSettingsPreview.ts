import { notificationEventNames } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getSlackMessageForNotificationEvent } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import {
  sampleCard,
  sampleScorecard,
  sampleFeatureDigest,
  renderWeeklyScorecard,
  renderFeatureDigest,
} from "back-end/src/services/notificationCards/cardImages";
import { renderExperimentCard } from "back-end/src/services/notificationCards/experimentCards";
import { getSlackOAuthIntegrationById } from "back-end/src/services/slackIntegration";
import { decryptSlackBotToken } from "back-end/src/util/slackToken";
import { postSlackMessageResult, uploadSlackImageFile } from "./slackWebApi";
import {
  getSampleEventPayload,
  slackEventWebhookTestEventNames,
} from "./slackTestFixtures";

export const slackPreviewEventNames = [
  ...slackEventWebhookTestEventNames.filter((name) =>
    notificationEventNames.some((event) => event === name),
  ),
  "digest:scorecard",
  "digest:feature",
] as const;

export async function buildSlackSettingsPreview(
  context: ReqContext,
  eventName: string,
  format: "none" | "compact" | "detailed",
) {
  if (!context.permissions.canManageIntegrations())
    context.permissions.throwPermissionError();
  if (eventName === "digest:scorecard" || eventName === "digest:feature") {
    const text =
      eventName === "digest:scorecard"
        ? "Experiment activity scorecard — sample data"
        : "Feature flag activity digest — sample data";
    const png =
      eventName === "digest:scorecard"
        ? await renderWeeklyScorecard(sampleScorecard())
        : await renderFeatureDigest(sampleFeatureDigest());
    return {
      message: {
        text,
        blocks: [{ type: "section", text: { type: "plain_text", text } }],
      },
      png,
    };
  }
  const name = slackPreviewEventNames.find((name) => name === eventName);
  if (!name || name === "digest:scorecard" || name === "digest:feature")
    throw new Error("Unsupported test event");
  const event = getSampleEventPayload({ context, eventName: name });
  const message = await getSlackMessageForNotificationEvent(
    event,
    "slack-preview-sample",
  );
  if (!message) throw new Error("This event does not have a Slack preview");
  let png: Buffer | null = null;
  // #6870 only posts image cards for SRM warnings.
  if (eventName === "experiment.warning" && format !== "none") {
    const card = sampleCard("warning");
    card.name = "Checkout CTA";
    card.event = "warning";
    png = await renderExperimentCard(card, format);
  }
  return { message, png };
}

export async function sendSlackSettingsTest(
  context: ReqContext,
  id: string,
  eventName: string,
  format: "none" | "compact" | "detailed",
) {
  if (!context.permissions.canManageIntegrations())
    context.permissions.throwPermissionError();
  const integration = await getSlackOAuthIntegrationById({ context, id });
  if (!integration?.slack?.teamId || !integration.slack.channelId)
    throw new Error("Slack channel not found");
  const workspace = await context.models.slackWorkspaceConnections.getByTeamId(
    integration.slack.teamId,
  );
  if (!workspace)
    throw new Error("Reconnect this Slack workspace before sending a test");
  const token = decryptSlackBotToken(workspace.encryptedBotAccessToken);
  if (!token)
    throw new Error("Reconnect this Slack workspace before sending a test");
  const { message, png } = await buildSlackSettingsPreview(
    context,
    eventName,
    format,
  );
  const text = `Test notification — sample data\n${message.text}`;
  if (png) {
    const file = await uploadSlackImageFile({
      token,
      png,
      channelId: integration.slack.channelId,
      filename: "growthbook-test.png",
      title: "GrowthBook test notification",
      initialComment: text,
    });
    if (file) return { delivery: "card" as const };
  }
  const result = await postSlackMessageResult({
    token,
    channel: integration.slack.channelId,
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Test notification — sample data*" },
      },
      ...message.blocks,
    ],
  });
  if (!result.ok)
    throw new Error(
      "Slack could not deliver the test notification. Check the channel connection and retry.",
    );
  return { delivery: "text" as const };
}
