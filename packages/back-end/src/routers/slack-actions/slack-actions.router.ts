import { createHmac, timingSafeEqual } from "node:crypto";
import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { APP_ORIGIN, SLACK_SIGNING_SECRET } from "back-end/src/util/secrets";
import { EventWebHookModel } from "back-end/src/models/EventWebhookModel";
import { snoozeSlackExperimentNotifications } from "back-end/src/models/SlackNotificationSnoozeModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

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

export { router as slackActionsRouter };
