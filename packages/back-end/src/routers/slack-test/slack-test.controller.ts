import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  sendSlackBotMessage,
  buildHelloWorldBlocks,
  SlackBotSendResult,
} from "back-end/src/services/slackBot";

type PostHelloWorldRequest = AuthRequest<{ channel: string }>;

export const postHelloWorld = async (
  req: PostHelloWorldRequest,
  res: Response<SlackBotSendResult | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  const { channel } = req.body;
  const { blocks, text } = buildHelloWorldBlocks({
    orgName: context.org.name,
    userEmail: context.email || "unknown",
  });

  const result = await sendSlackBotMessage({ channel, blocks, text });
  res.json(result);
};
