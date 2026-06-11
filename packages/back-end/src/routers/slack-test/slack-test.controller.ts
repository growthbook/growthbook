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
