import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import { SLACK_SIGNING_SECRET } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import {
  queueSlackAssistantMention,
  queueSlackAssistantConfirmation,
  queueSlackAppHomeOpened,
} from "back-end/src/jobs/slackAssistantJobs";
import { slackAppHomeOpenedEventSchema } from "back-end/src/services/slack/slackAppHome";
import { getSlackAssistantEvent } from "back-end/src/services/slack/slackAssistantEvents";

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

type SlackRequest = Request & {
  rawBody?: string;
  body: Record<string, string>;
};

const router = express.Router();

const slackBodyParser = bodyParser.urlencoded({
  extended: false,
  verify: (req: Request & { rawBody?: string }, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  },
});

// The Events API posts JSON; interactions are URL-encoded.
// Capture the raw body either way so the signature check works.
const slackJsonParser = bodyParser.json({
  verify: (req: Request & { rawBody?: string }, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  },
});

const verifySlackSignature = (req: SlackRequest) => {
  if (!SLACK_SIGNING_SECRET) return false;
  const timestamp = req.header("x-slack-request-timestamp");
  const signature = req.header("x-slack-signature");
  if (!timestamp || !signature || !req.rawBody) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 60 * 5) return false;

  const expected = `v0=${createHmac("sha256", SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${req.rawBody}`)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
};

const interactions = async (req: SlackRequest, res: Response) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).json({ text: "Invalid Slack signature." });
  }

  let input: unknown;
  try {
    input = JSON.parse(req.body.payload || "{}");
  } catch {
    return res.status(400).json({ text: "Invalid Slack interaction payload." });
  }
  const parsedPayload = interactionPayloadSchema.safeParse(input);
  if (!parsedPayload.success)
    return res.status(400).json({ text: "Invalid Slack interaction payload." });
  const payload = parsedPayload.data;
  const action = payload.actions?.[0];

  // Assistant mutation confirm/cancel — replay the parked action async.
  if (
    action?.action_id === "gb_confirm_action" ||
    action?.action_id === "gb_cancel_action"
  ) {
    try {
      const parsed = JSON.parse(action.value || "{}") as {
        c?: string;
        a?: string;
        t?: string;
      };
      if (!parsed.c || !parsed.a || !action.action_ts)
        return res.status(400).json({ text: "Missing Slack action identity." });
      await queueSlackAssistantConfirmation({
        teamId: payload.team?.id || "",
        channelId: payload.channel?.id || "",
        slackUserId: payload.user?.id || "",
        conversationId: parsed.c,
        actionId: parsed.a,
        interactionTs: action.action_ts,
        decision:
          action.action_id === "gb_confirm_action" ? "confirm" : "cancel",
        threadTs: parsed.t,
        buttonsMessageTs: payload.message?.ts,
      });
      res.status(200).send("");
    } catch (e) {
      logger.error(e, "Failed to enqueue Slack confirmation action");
      res
        .status(503)
        .json({ text: "Unable to accept this action. Please retry." });
    }
    return;
  }

  return res.status(200).send("");
};

const urlVerificationSchema = z.object({
  type: z.literal("url_verification"),
  challenge: z.string().min(1),
});

const events = async (req: SlackRequest, res: Response): Promise<void> => {
  if (!verifySlackSignature(req)) {
    res.status(401).json({ text: "Invalid Slack signature." });
    return;
  }

  // URL verification handshake performed when the Request URL is saved.
  const verification = urlVerificationSchema.safeParse(req.body);
  if (verification.success) {
    res.status(200).json({ challenge: verification.data.challenge });
    return;
  }

  try {
    const assistantEvent = getSlackAssistantEvent(req.body);
    if (assistantEvent) {
      await queueSlackAssistantMention(
        assistantEvent.mention,
        assistantEvent.eventId,
      );
    } else {
      const appHome = slackAppHomeOpenedEventSchema.safeParse(req.body);
      if (appHome.success) await queueSlackAppHomeOpened(appHome.data);
    }
    res.status(200).send("");
  } catch (error) {
    logger.error(error, "Failed to durably enqueue Slack event");
    res
      .status(503)
      .json({ text: "Unable to accept Slack event. Please retry." });
  }
};

const controller = wrapController({ interactions, events });
router.post("/interactions", slackBodyParser, controller.interactions);
router.post("/events", slackJsonParser, controller.events);

export { router as slackActionsRouter };
