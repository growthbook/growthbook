import { createHmac, timingSafeEqual } from "node:crypto";
import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { APP_ORIGIN, SLACK_SIGNING_SECRET } from "back-end/src/util/secrets";
import { EventWebHookModel } from "back-end/src/models/EventWebhookModel";
import { snoozeSlackExperimentNotifications } from "back-end/src/models/SlackNotificationSnoozeModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
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

router.post("/commands", slackBodyParser, async (req: SlackRequest, res) => {
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

    const context = await getContextForAgendaJobByOrgId(webhook.organizationId);
    const experiment = await getExperimentById(context, experimentId);
    if (!experiment) {
      return res.json({
        response_type: "ephemeral",
        text: `Could not find experiment ${experimentId}.`,
      });
    }

    return res.json({
      response_type: "ephemeral",
      text: `*${experiment.name}*\nStatus: ${experiment.status}\nResults: ${experiment.results || "not decided"}\n${APP_ORIGIN}/experiment/${experiment.id}#results`,
    });
  }

  return res.json({
    response_type: "ephemeral",
    text:
      "GrowthBook commands: `/growthbook list`, `/growthbook subscribe`, " +
      "`/growthbook status <experiment-id>`, `/growthbook results <experiment-id>`",
  });
});

router.post(
  "/interactions",
  slackBodyParser,
  async (req: SlackRequest, res: Response) => {
    if (!verifySlackSignature(req)) {
      return res.status(401).json({ text: "Invalid Slack signature." });
    }

    const payload = JSON.parse(req.body.payload || "{}") as {
      team?: { id?: string };
      channel?: { id?: string };
      user?: { id?: string };
      message?: { ts?: string };
      actions?: { action_id?: string; value?: string }[];
    };
    const action = payload.actions?.[0];

    // Assistant mutation confirm/cancel — replay the parked action async.
    if (
      action?.action_id === "gb_confirm_action" ||
      action?.action_id === "gb_cancel_action"
    ) {
      res.status(200).send(""); // ACK within 3s; the turn runs async.
      try {
        const parsed = JSON.parse(action.value || "{}") as {
          c?: string;
          a?: string;
          t?: string;
        };
        if (!parsed.c || !parsed.a) return;
        void queueSlackAssistantConfirmation({
          teamId: payload.team?.id || "",
          channelId: payload.channel?.id || "",
          slackUserId: payload.user?.id || "",
          conversationId: parsed.c,
          actionId: parsed.a,
          decision:
            action.action_id === "gb_confirm_action" ? "confirm" : "cancel",
          threadTs: parsed.t,
          buttonsMessageTs: payload.message?.ts,
        }).catch((e) =>
          logger.error(e, "Failed to enqueue Slack assistant confirmation"),
        );
      } catch (e) {
        logger.error(e, "Failed to parse Slack confirmation action");
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

    await snoozeSlackExperimentNotifications({
      organizationId: target.organizationId,
      eventWebHookId: target.eventWebHookId,
      experimentId,
      snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    return res.json({
      response_type: "ephemeral",
      text: "Snoozed GrowthBook notifications for this experiment for 24 hours.",
    });
  },
);

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
    ts?: string;
    thread_ts?: string;
    // link_shared
    message_ts?: string;
    links?: { url?: string; domain?: string }[];
  };
};

// In-memory guard making a Slack event re-delivery a no-op (retries are rare
// since we ACK in <3s).
const processedSlackEventIds = new Set<string>();
function isDuplicateSlackEvent(eventId?: string): boolean {
  if (!eventId) return false;
  if (processedSlackEventIds.has(eventId)) return true;
  processedSlackEventIds.add(eventId);
  // Bounded; worst case is re-answering an event from >2000 events ago.
  if (processedSlackEventIds.size > 2000) processedSlackEventIds.clear();
  return false;
}

router.post(
  "/events",
  slackJsonParser,
  (req: SlackRequest, res: Response): void => {
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

    // ACK immediately — Slack requires a 200 within 3s; the agent runs async.
    res.status(200).send("");

    if (payload.type !== "event_callback") return;
    const event = payload.event;
    if (!event) return;

    // Skip bot/system messages (incl. our own replies) and edits/joins to
    // avoid loops.
    if (event.bot_id || event.subtype) return;
    if (isDuplicateSlackEvent(payload.event_id)) return;

    const botUserId = payload.authorizations?.[0]?.user_id;

    // Direct @mention — always handled (starts or continues a thread).
    if (event.type === "app_mention") {
      if (!event.user || !event.channel || !event.ts || !event.text) return;
      void queueSlackAssistantMention(
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
      ).catch((e) =>
        logger.error(e, "Failed to enqueue Slack assistant mention"),
      );
      return;
    }

    // Thread-follow: a plain message inside a thread. The handler only replies
    // if this user already has an assistant conversation in the thread, so the
    // bot doesn't jump into arbitrary channel chatter.
    if (event.type === "message") {
      if (!event.thread_ts) return; // only follow within threads
      if (!event.user || !event.channel || !event.ts || !event.text) return;
      if (botUserId && event.user === botUserId) return; // our own message
      // An @mention is handled by the app_mention event; don't double-process.
      if (botUserId && event.text.includes(`<@${botUserId}>`)) return;
      void queueSlackAssistantMention(
        {
          teamId: payload.team_id || "",
          channelId: event.channel,
          slackUserId: event.user,
          text: event.text,
          messageTs: event.ts,
          threadTs: event.thread_ts,
          botUserId,
          requireActiveThread: true,
        },
        payload.event_id,
      ).catch((e) =>
        logger.error(e, "Failed to enqueue Slack assistant thread reply"),
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
      void queueSlackLinkUnfurl(
        {
          teamId: payload.team_id || "",
          channelId: event.channel,
          messageTs: event.message_ts,
          slackUserId: event.user,
          links: event.links || [],
        },
        payload.event_id,
      ).catch((e) => logger.error(e, "Failed to enqueue Slack link unfurl"));
    }
  },
);

export { router as slackActionsRouter };
