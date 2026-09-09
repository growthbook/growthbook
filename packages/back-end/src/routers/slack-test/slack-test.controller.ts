import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getSlackEventWebhookTestPreviews,
  SlackEventWebhookPreviewsResult,
  sendSlackEventWebhookTestEvent,
  SlackEventWebhookTestResult,
  sendSlackEventWebhookTestDigest,
  SlackTestDigestKind,
  SlackTestDigestResult,
} from "back-end/src/services/slackBot";
import {
  EventWebHookModel,
  getSlackBotAccessTokenForWebhook,
} from "back-end/src/models/EventWebhookModel";
import {
  sampleCard,
  CardState,
  CompactEvent,
  sampleScorecard,
  renderWeeklyScorecard,
  sampleFeatureDigest,
  renderFeatureDigest,
} from "back-end/src/services/slack/chartImage";
import { renderExperimentCard } from "back-end/src/services/slack/cards";
import { buildExperimentCardData } from "back-end/src/services/slack/experimentCardData";
import { postExperimentCardImage } from "back-end/src/services/slack/cardDelivery";

type PostEventWebhookRequest = AuthRequest<{
  eventWebHookId: string;
  eventName?: string;
  digest?: SlackTestDigestKind;
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

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  const result = await getSlackEventWebhookTestPreviews({ context });

  res.json(result);
};

export const postEventWebhook = async (
  req: PostEventWebhookRequest,
  res: Response<
    SlackEventWebhookTestResult | SlackTestDigestResult | ApiErrorResponse
  >,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  // A digest test renders + uploads a sample digest image; an event test posts
  // the sample notification. The router guarantees exactly one is provided.
  if (req.body.digest) {
    const result = await sendSlackEventWebhookTestDigest({
      context,
      eventWebHookId: req.body.eventWebHookId,
      digest: req.body.digest,
    });
    return res.json(result);
  }

  const result = await sendSlackEventWebhookTestEvent({
    context,
    eventWebHookId: req.body.eventWebHookId,
    eventName: req.body.eventName ?? "",
  });

  res.json(result);
};

type GetChartPreviewRequest = AuthRequest<
  Record<string, never>,
  Record<string, never>,
  {
    state?: string;
    experimentId?: string;
    style?: string;
    event?: string;
    digest?: string;
  }
>;

const CARD_STATES: CardState[] = [
  "started",
  "running",
  "winner",
  "loser",
  "stopped",
  "warning",
];

const COMPACT_EVENTS: CompactEvent[] = [
  "started",
  "significance",
  "won",
  "lost",
  "stopped",
  "warning",
  "decisionShip",
  "decisionRollback",
];

// Render an experiment card (or a digest) to PNG for eyeballing in a browser.
//   ?experimentId=exp_...  real snapshot data (else ?state= picks a sample state)
//   ?style=compact         the small notification card (default: detailed)
//   ?event=significance    compact-card event (default: derived from state)
//   ?digest=scorecard      a sample digest image (scorecard | feature)
export const getChartPreview = async (
  req: GetChartPreviewRequest,
  res: Response<Buffer | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  const digest = req.query.digest;
  if (digest === "scorecard" || digest === "feature") {
    const png =
      digest === "scorecard"
        ? await renderWeeklyScorecard(sampleScorecard())
        : await renderFeatureDigest(sampleFeatureDigest());
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    return res.send(png);
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

  const style = req.query.style === "compact" ? "compact" : "detailed";
  if (
    style === "compact" &&
    COMPACT_EVENTS.includes(req.query.event as CompactEvent)
  ) {
    card.event = req.query.event as CompactEvent;
  }

  const png = await renderExperimentCard(card, style);
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

  if (!context.permissions.canManageIntegrations()) {
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
    png,
    altText: `${card.name} — experiment results`,
    fallbackText: `${card.name}: couldn't upload the results card to Slack (is the files:write scope granted?).`,
  });

  res.json({ posted });
};
