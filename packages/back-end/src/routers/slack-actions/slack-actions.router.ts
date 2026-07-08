import { createHmac, timingSafeEqual } from "node:crypto";
import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { APP_ORIGIN, SLACK_SIGNING_SECRET } from "back-end/src/util/secrets";
import { EventWebHookModel } from "back-end/src/models/EventWebhookModel";
import { snoozeSlackExperimentNotifications } from "back-end/src/models/SlackNotificationSnoozeModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { handleSlackAssistantMention } from "back-end/src/services/slack/slackAssistant";
import { getDevCardImage } from "back-end/src/services/slack/cardDelivery";

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

// The Events API posts JSON (slash commands/interactions are urlencoded). We
// still capture the raw body so the signature check works.
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
      actions?: { action_id?: string; value?: string }[];
    };
    const action = payload.actions?.[0];
    if (action?.action_id !== "growthbook_snooze_experiment_24h") {
      return res.json({ text: "GrowthBook action received." });
    }

    const webhook = await findSlackWebhook({
      teamId: payload.team?.id,
      channelId: payload.channel?.id,
    });
    const experimentId = action.value;
    if (!webhook || !experimentId) {
      return res.json({ text: "Unable to snooze this notification." });
    }

    await snoozeSlackExperimentNotifications({
      organizationId: webhook.organizationId,
      eventWebHookId: webhook.id,
      experimentId,
      snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    return res.json({
      response_type: "ephemeral",
      text: "Snoozed GrowthBook notifications for this experiment for 24 hours.",
    });
  },
);

// ---------------------------------------------------------------------------
// Events API — app_mention drives the interactive assistant.
// ---------------------------------------------------------------------------

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
  };
};

// In-memory guard against double-processing if Slack ever re-delivers an event.
// We ACK in <3s so retries are rare; this just makes a duplicate a no-op.
const processedSlackEventIds = new Set<string>();
function isDuplicateSlackEvent(eventId?: string): boolean {
  if (!eventId) return false;
  if (processedSlackEventIds.has(eventId)) return true;
  processedSlackEventIds.add(eventId);
  // Bounded — clearing wholesale is fine; the worst case is re-answering an
  // event that was delivered more than ~2000 events ago.
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

    // Skip bot/system messages (incl. our own replies) to avoid loops.
    if (event.bot_id || event.subtype) return;
    if (isDuplicateSlackEvent(payload.event_id)) return;

    if (event.type === "app_mention") {
      if (!event.user || !event.channel || !event.ts || !event.text) return;
      void handleSlackAssistantMention({
        teamId: payload.team_id || "",
        channelId: event.channel,
        slackUserId: event.user,
        text: event.text,
        messageTs: event.ts,
        threadTs: event.thread_ts,
        botUserId: payload.authorizations?.[0]?.user_id,
      }).catch((e) =>
        logger.error(e, "Slack assistant mention handler failed"),
      );
    }
  },
);

// Dev-only public image host for experiment cards (see cardDelivery.ts). Only
// returns anything when SLACK_CARD_PUBLIC_BASE_URL is set and populated the
// cache; unguessable id + short TTL. In production the cache is always empty
// (cards go to object storage), so this 404s.
router.get("/card-image/:id", (req: Request, res: Response) => {
  const id = (req.params.id || "").replace(/\.png$/, "");
  const png = getDevCardImage(id);
  if (!png) {
    res.status(404).send("Not found");
    return;
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(png);
});

export { router as slackActionsRouter };
