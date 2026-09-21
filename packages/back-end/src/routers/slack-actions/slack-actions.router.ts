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
} from "back-end/src/jobs/slackAssistantTasks";
import { slackAppHomeOpenedEventSchema } from "back-end/src/services/slack/slackAppHome";

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

// Events API — app_mention drives the interactive assistant.
type SlackEventPayload = {
  type?: string;
  challenge?: string;
  team_id?: string;
  event_id?: string;
  authorizations?: { user_id?: string }[];
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    user?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    ts?: string;
    thread_ts?: string;
  };
};

const events = async (req: SlackRequest, res: Response): Promise<void> => {
  if (!verifySlackSignature(req)) {
    res.status(401).json({ text: "Invalid Slack signature." });
    return;
  }

  const payload = req.body as unknown as SlackEventPayload;

  // URL verification handshake performed when the Request URL is saved.
  if (payload.type === "url_verification") {
    res.status(200).json({ challenge: payload.challenge });
    return;
  }

  try {
    await (async () => {
      if (payload.type !== "event_callback") return;
      const event = payload.event;
      if (!event) return;

      // Skip bot/system messages (incl. our own replies) and edits/joins to
      // avoid loops.
      if (event.bot_id || event.subtype) return;

      const botUserId = payload.authorizations?.[0]?.user_id;

      // Direct @mention — always handled (starts or continues a thread).
      if (event.type === "app_mention") {
        if (!event.user || !event.channel || !event.ts || !event.text) return;
        await queueSlackAssistantMention(
          {
            teamId: payload.team_id || "",
            channelId: event.channel,
            slackUserId: event.user,
            text: event.text,
            messageTs: event.ts,
            threadTs: event.thread_ts,
            botUserId,
          },
          payload.event_id,
        );
        return;
      }

      // Thread-follow: a plain message inside a thread. The handler only replies
      // if this user already has an assistant conversation in the thread, so the
      // bot doesn't jump into arbitrary channel chatter.
      if (event.type === "message") {
        // In DMs Slack can deliver a top-level message without a thread. Treat
        // that as a direct assistant turn; public-channel chatter still needs an
        // existing assistant thread before we respond.
        const isDirectMessage = event.channel_type === "im";
        if (!event.thread_ts && !isDirectMessage) return;
        if (!event.user || !event.channel || !event.ts || !event.text) return;
        if (botUserId && event.user === botUserId) return; // our own message
        // An @mention is handled by the app_mention event; don't double-process.
        if (botUserId && event.text.includes(`<@${botUserId}>`)) return;
        await queueSlackAssistantMention(
          {
            teamId: payload.team_id || "",
            channelId: event.channel,
            slackUserId: event.user,
            text: event.text,
            messageTs: event.ts,
            threadTs: event.thread_ts,
            botUserId,
            requireActiveThread: !isDirectMessage,
          },
          payload.event_id,
        );
        return;
      }

      if (event.type === "app_home_opened") {
        const parsed = slackAppHomeOpenedEventSchema.safeParse(req.body);
        if (parsed.success) await queueSlackAppHomeOpened(parsed.data);
        return;
      }
    })();
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
