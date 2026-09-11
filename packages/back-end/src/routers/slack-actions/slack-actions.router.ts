import { createHmac, timingSafeEqual } from "node:crypto";
import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { toSlackMrkdwn } from "back-end/src/services/slack/slackMarkdown";
import { wrapController } from "back-end/src/routers/wrapController";
import { APP_ORIGIN, SLACK_SIGNING_SECRET } from "back-end/src/util/secrets";
import { EventWebHookModel } from "back-end/src/models/EventWebhookModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";
import { logger } from "back-end/src/util/logger";
import {
  queueSlackAssistantMention,
  queueSlackAssistantConfirmation,
  queueSlackLinkUnfurl,
} from "back-end/src/jobs/slackAssistantTasks";

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

// The Events API posts JSON (slash commands/interactions are urlencoded).
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

const findSlackWebhook = async ({
  teamId,
  channelId,
}: {
  teamId?: string;
  channelId?: string;
}) => {
  if (!teamId) return null;
  return EventWebHookModel.findOne({
    payloadType: "slack",
    "slack.teamId": teamId,
    ...(channelId ? { "slack.channelId": channelId } : {}),
  }).lean();
};

const commands = async (req: SlackRequest, res: Response) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).json({ text: "Invalid Slack signature." });
  }

  const webhook = await findSlackWebhook({
    teamId: req.body.team_id,
    channelId: req.body.channel_id,
  });
  if (!webhook) {
    return res.json({
      response_type: "ephemeral",
      text: "This Slack channel is not connected to GrowthBook yet.",
    });
  }

  const [subcommand = "help", experimentId = ""] = (req.body.text || "")
    .trim()
    .split(/\s+/);

  if (subcommand === "list") {
    return res.json({
      response_type: "ephemeral",
      text: `This channel is subscribed to: ${webhook.events.join(", ")}`,
    });
  }

  if (subcommand === "subscribe") {
    return res.json({
      response_type: "ephemeral",
      text: `Open GrowthBook to configure this channel: ${APP_ORIGIN}/settings/webhooks/event/${webhook.id}`,
    });
  }

  if (subcommand === "status" || subcommand === "results") {
    if (!experimentId) {
      return res.json({
        response_type: "ephemeral",
        text: `Usage: /growthbook ${subcommand} <experiment-id>`,
      });
    }

    // Resolve the Slack user to their linked GrowthBook account + permission-
    // scoped context, so experiment details go only to someone who can actually
    // read it — not any (even unlinked) member of the channel.
    const target = await resolveSlackAssistantTarget({
      teamId: req.body.team_id,
      channelId: req.body.channel_id,
      slackUserId: req.body.user_id,
    });
    if (!target.ok) {
      return res.json({ response_type: "ephemeral", text: target.message });
    }
    const experiment = await getExperimentById(target.context, experimentId);
    if (!experiment) {
      return res.json({
        response_type: "ephemeral",
        text: `Could not find experiment ${experimentId}.`,
      });
    }

    return res.json({
      response_type: "ephemeral",
      text: toSlackMrkdwn(
        `**${experiment.name}**\nStatus: ${experiment.status}\nResults: ${experiment.results || "not decided"}\n${APP_ORIGIN}/experiment/${experiment.id}#results`,
        { appOrigin: APP_ORIGIN },
      ),
    });
  }

  return res.json({
    response_type: "ephemeral",
    text:
      "GrowthBook commands: `/growthbook list`, `/growthbook subscribe`, " +
      "`/growthbook status <experiment-id>`, `/growthbook results <experiment-id>`",
  });
};

const interactions = async (req: SlackRequest, res: Response) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).json({ text: "Invalid Slack signature." });
  }

  let payload: {
    team?: { id?: string };
    channel?: { id?: string };
    user?: { id?: string };
    message?: { ts?: string };
    actions?: { action_id?: string; action_ts?: string; value?: string }[];
  };
  try {
    payload = JSON.parse(req.body.payload || "{}");
  } catch {
    return res.status(400).json({ text: "Invalid Slack interaction payload." });
  }
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

  if (action?.action_id !== "growthbook_snooze_experiment_24h") {
    return res.json({ text: "GrowthBook action received." });
  }

  const experimentId = action.value;
  if (!experimentId) {
    return res.json({ text: "Unable to snooze this notification." });
  }

  // Authorize like the confirm/cancel path: the clicking Slack user must be a
  // linked GrowthBook member of this channel's org AND able to read the
  // experiment. Otherwise any (even unlinked) channel member could suppress a
  // channel's notifications. resolveSlackAssistantTarget also gives us the
  // channel's webhook + org, scoped to that user.
  const target = await resolveSlackAssistantTarget({
    teamId: payload.team?.id,
    channelId: payload.channel?.id || "",
    slackUserId: payload.user?.id || "",
  });
  if (!target.ok) {
    return res.json({ response_type: "ephemeral", text: target.message });
  }
  if (!(await getExperimentById(target.context, experimentId))) {
    return res.json({
      response_type: "ephemeral",
      text: "You don't have access to snooze notifications for this experiment.",
    });
  }

  await target.context.models.slackNotificationSnoozes.snoozeExperiment({
    eventWebHookId: target.eventWebHookId,
    experimentId,
    snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return res.json({
    response_type: "ephemeral",
    text: "Snoozed GrowthBook notifications for this experiment for 24 hours.",
  });
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
    assistant_thread?: {
      user_id?: string;
      channel_id?: string;
      thread_ts?: string;
    };
    // link_shared
    message_ts?: string;
    links?: { url?: string; domain?: string }[];
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

      if (event.type === "assistant_thread_started") {
        const thread = event.assistant_thread;
        if (!thread?.user_id || !thread.channel_id || !thread.thread_ts) return;
        await queueSlackAssistantMention(
          {
            teamId: payload.team_id || "",
            channelId: thread.channel_id,
            slackUserId: thread.user_id,
            text: "",
            messageTs: thread.thread_ts,
            threadTs: thread.thread_ts,
            botUserId,
          },
          payload.event_id,
        );
        return;
      }

      // Unfurl a shared GrowthBook experiment link into a results card
      // (respecting the sharer's permissions).
      if (event.type === "link_shared") {
        logger.info(
          {
            channel: event.channel,
            user: event.user,
            links: event.links?.map((l) => l.url),
          },
          "Slack: link_shared event received",
        );
        if (!event.channel || !event.message_ts || !event.user) return;
        await queueSlackLinkUnfurl(
          {
            teamId: payload.team_id || "",
            channelId: event.channel,
            messageTs: event.message_ts,
            slackUserId: event.user,
            links: event.links || [],
          },
          payload.event_id,
        );
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

const controller = wrapController({ commands, interactions, events });
router.post("/commands", slackBodyParser, controller.commands);
router.post("/interactions", slackBodyParser, controller.interactions);
router.post("/events", slackJsonParser, controller.events);

export { router as slackActionsRouter };
