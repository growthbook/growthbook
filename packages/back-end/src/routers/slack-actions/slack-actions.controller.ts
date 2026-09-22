import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "back-end/src/util/logger";
import {
  queueSlackAssistantMention,
  queueSlackAssistantConfirmation,
  queueSlackAppHomeOpened,
} from "back-end/src/jobs/slackAssistantJobs";
import { slackAppHomeOpenedEventSchema } from "back-end/src/services/slack/slackAppHome";
import { getSlackAssistantEvent } from "back-end/src/services/slack/slackAssistantEvents";

// region POST /integrations/slack/interactions

// Slack posts the interaction as a form field holding a JSON document.
const interactionPayloadSchema = z.object({
  team: z.object({ id: z.string().min(1) }),
  channel: z.object({ id: z.string().min(1) }),
  user: z.object({ id: z.string().min(1) }),
  message: z.object({ ts: z.string().optional() }).optional(),
  actions: z
    .array(
      z.object({
        action_id: z.string(),
        action_ts: z.string().optional(),
        value: z.string().optional(),
      }),
    )
    .optional(),
});

// The value GrowthBook attached to its own Confirm/Cancel buttons.
const confirmButtonValueSchema = z.object({
  c: z.string().min(1),
  a: z.string().min(1),
  t: z.string().optional(),
});

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

type SlackInteractionsRequest = Request<
  Record<string, string>,
  unknown,
  { payload: string }
>;

export const postSlackInteractions = async (
  req: SlackInteractionsRequest,
  res: Response,
) => {
  const parsedPayload = interactionPayloadSchema.safeParse(
    parseJson(req.body.payload),
  );
  if (!parsedPayload.success) {
    return res.status(400).json({ text: "Invalid Slack interaction payload." });
  }
  const payload = parsedPayload.data;
  const action = payload.actions?.[0];

  if (
    action?.action_id !== "gb_confirm_action" &&
    action?.action_id !== "gb_cancel_action"
  ) {
    return res.status(200).send("");
  }

  // Confirm or cancel a parked assistant mutation. The job replays it after
  // Slack has been acknowledged.
  try {
    const value = confirmButtonValueSchema.safeParse(
      parseJson(action.value || "{}"),
    );
    if (!value.success || !action.action_ts) {
      return res.status(400).json({ text: "Missing Slack action identity." });
    }
    await queueSlackAssistantConfirmation({
      teamId: payload.team.id,
      channelId: payload.channel.id,
      slackUserId: payload.user.id,
      conversationId: value.data.c,
      actionId: value.data.a,
      interactionTs: action.action_ts,
      decision: action.action_id === "gb_confirm_action" ? "confirm" : "cancel",
      threadTs: value.data.t,
      buttonsMessageTs: payload.message?.ts,
    });
    return res.status(200).send("");
  } catch (e) {
    logger.error(e, "Failed to enqueue Slack confirmation action");
    return res
      .status(503)
      .json({ text: "Unable to accept this action. Please retry." });
  }
};

// endregion POST /integrations/slack/interactions

// region POST /integrations/slack/events

const urlVerificationSchema = z.object({
  type: z.literal("url_verification"),
  challenge: z.string().min(1),
});

type SlackEventsRequest = Request<Record<string, string>, unknown, unknown>;

export const postSlackEvents = async (
  req: SlackEventsRequest,
  res: Response,
) => {
  // URL verification handshake performed when the Request URL is saved.
  const verification = urlVerificationSchema.safeParse(req.body);
  if (verification.success) {
    return res.status(200).json({ challenge: verification.data.challenge });
  }

  try {
    const assistantEvent = getSlackAssistantEvent(req.body);
    if (assistantEvent) {
      await queueSlackAssistantMention(assistantEvent);
    } else {
      const appHome = slackAppHomeOpenedEventSchema.safeParse(req.body);
      if (appHome.success) await queueSlackAppHomeOpened(appHome.data);
    }
    return res.status(200).send("");
  } catch (error) {
    logger.error(error, "Failed to durably enqueue Slack event");
    return res
      .status(503)
      .json({ text: "Unable to accept Slack event. Please retry." });
  }
};

// endregion POST /integrations/slack/events
