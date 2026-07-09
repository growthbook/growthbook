import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getSlackEventWebhookTestPreviews,
  SlackEventWebhookPreviewsResult,
  sendSlackEventWebhookTestEvent,
  SlackEventWebhookTestResult,
} from "back-end/src/services/slackBot";
import {
  EventWebHookModel,
  getSlackBotAccessTokenForWebhook,
} from "back-end/src/models/EventWebhookModel";
import { sampleCard, CardState } from "back-end/src/services/slack/chartImage";
import { renderExperimentCard } from "back-end/src/services/slack/cards";
import { buildExperimentCardData } from "back-end/src/services/slack/experimentCardData";
import { postExperimentCardImage } from "back-end/src/services/slack/cardDelivery";

type PostEventWebhookRequest = AuthRequest<{
  eventWebHookId: string;
  eventName: string;
}>;

type GetEventWebhookPreviewsRequest = AuthRequest<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>;

export const getEventWebhookPreviews = async (
  req: GetEventWebhookPreviewsRequest,
  res: Response<SlackEventWebhookPreviewsResult | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const result = await getSlackEventWebhookTestPreviews({ context });

  res.json(result);
};

export const postEventWebhook = async (
  req: PostEventWebhookRequest,
  res: Response<SlackEventWebhookTestResult | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const result = await sendSlackEventWebhookTestEvent({
    context,
    eventWebHookId: req.body.eventWebHookId,
    eventName: req.body.eventName,
  });

  res.json(result);
};

type GetChartPreviewRequest = AuthRequest<
  Record<string, never>,
  Record<string, never>,
  { state?: string; experimentId?: string }
>;

const CARD_STATES: CardState[] = [
  "started",
  "running",
  "winner",
  "loser",
  "stopped",
  "warning",
];

// Render an experiment card to PNG for eyeballing in a browser. With
// `?experimentId=` it renders real snapshot data; otherwise `?state=` picks a
// sample card state (default "winner").
export const getChartPreview = async (
  req: GetChartPreviewRequest,
  res: Response<Buffer | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const experimentId = req.query.experimentId;
  const card = experimentId
    ? await buildExperimentCardData(context, experimentId)
    : sampleCard(
        CARD_STATES.includes(req.query.state as CardState)
          ? (req.query.state as CardState)
          : "winner",
      );

  if (!card) {
    return res
      .status(404)
      .json({ message: "Experiment not found or has no results yet" });
  }

  const png = await renderExperimentCard(card);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(png);
};

type PostChartToSlackRequest = AuthRequest<{ experimentId: string }>;

// Render a real experiment card and post it to the org's connected Slack
// channel — end-to-end test of the snapshot→card→upload→image-block path.
export const postChartToSlack = async (
  req: PostChartToSlackRequest,
  res: Response<{ posted: boolean } | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const card = await buildExperimentCardData(context, req.body.experimentId);
  if (!card) {
    return res
      .status(404)
      .json({ message: "Experiment not found or has no results yet" });
  }

  const webhook = await EventWebHookModel.findOne({
    organizationId: context.org.id,
    payloadType: "slack",
  }).lean();
  const channelId = (webhook?.slack as { channelId?: string } | undefined)
    ?.channelId;
  if (!webhook || !channelId) {
    return res
      .status(400)
      .json({ message: "No connected Slack channel for this organization" });
  }
  const token = await getSlackBotAccessTokenForWebhook({
    eventWebHookId: webhook.id,
    organizationId: context.org.id,
  });
  if (!token) {
    return res.status(400).json({ message: "Slack bot token unavailable" });
  }

  const png = await renderExperimentCard(card);
  const posted = await postExperimentCardImage({
    token,
    channel: channelId,
    organizationId: context.org.id,
    png,
    altText: `${card.name} — experiment results`,
    fallbackText: `${card.name}: results card couldn't be hosted (Slack needs a public image URL — configure S3/GCS uploads).`,
  });

  res.json({ posted });
};
