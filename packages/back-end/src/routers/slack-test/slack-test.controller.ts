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
  renderExperimentCard,
  sampleCard,
  CardState,
} from "back-end/src/services/slack/chartImage";

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
  { state?: string }
>;

const CARD_STATES: CardState[] = [
  "started",
  "running",
  "winner",
  "loser",
  "stopped",
  "warning",
];

// Phase 2 POC: render a sample experiment card to PNG so the output quality of
// the Satori + resvg pipeline can be eyeballed in a browser. `?state=` picks
// which card state to preview (default "winner").
export const getChartPreview = async (
  req: GetChartPreviewRequest,
  res: Response,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const requested = req.query.state;
  const state: CardState =
    requested && CARD_STATES.includes(requested as CardState)
      ? (requested as CardState)
      : "winner";

  const png = await renderExperimentCard(sampleCard(state));

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(png);
};
