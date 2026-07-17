import express from "express";
import { z } from "zod";
import { zodNotificationEventNamesEnum } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawSlackIntegrationController from "./slack-integration.controller";

const router = express.Router();

const slackIntegrationController = wrapController(
  rawSlackIntegrationController,
);

router.get("/", slackIntegrationController.getSlackIntegrations);

router.post(
  "/connect",
  validateRequestMiddleware({}),
  slackIntegrationController.postSlackOAuthConnect,
);

router.post(
  "/oauth-callback",
  validateRequestMiddleware({
    body: z
      .object({
        code: z.string().min(1),
        state: z.string().min(1),
      })
      .strict(),
  }),
  slackIntegrationController.postSlackOAuthCallback,
);

// Slack-initiated install (App Directory): code only, no signed state. The org
// is taken from the confirmed session (X-Organization header).
router.post(
  "/oauth-install",
  validateRequestMiddleware({
    body: z
      .object({
        code: z.string().min(1),
      })
      .strict(),
  }),
  slackIntegrationController.postSlackOAuthInstall,
);

// Complete the Slack account-link flow (maps a Slack user to this GrowthBook
// account). The signed `state` was minted by the bot for that Slack user.
router.post(
  "/link",
  validateRequestMiddleware({
    body: z.object({ state: z.string().min(1) }).strict(),
  }),
  slackIntegrationController.postSlackLink,
);

// Channel management for workspace-level installs. Registered before /:id so
// "channels" isn't captured as an id param.
router.get(
  "/channels",
  validateRequestMiddleware({
    query: z
      .object({
        teamId: z.string().optional(),
        cursor: z.string().optional(),
      })
      .strict(),
  }),
  slackIntegrationController.getSlackWorkspaceChannels,
);

router.post(
  "/channels",
  validateRequestMiddleware({
    body: z
      .object({
        teamId: z.string().optional(),
        channelId: z.string().min(1),
      })
      .strict(),
  }),
  slackIntegrationController.postSlackChannel,
);

// Disconnect an entire workspace (its connection doc + all channel docs).
router.post(
  "/disconnect",
  validateRequestMiddleware({
    body: z.object({ teamId: z.string().optional() }).strict(),
  }),
  slackIntegrationController.postSlackDisconnect,
);

// Toggle the workspace-wide conversational assistant (notifications-only off).
router.post(
  "/assistant",
  validateRequestMiddleware({
    body: z
      .object({ teamId: z.string().optional(), enabled: z.boolean() })
      .strict(),
  }),
  slackIntegrationController.postSlackAssistant,
);

// Toggle workspace-wide unfurling of shared experiment links.
router.post(
  "/unfurl",
  validateRequestMiddleware({
    body: z
      .object({ teamId: z.string().optional(), enabled: z.boolean() })
      .strict(),
  }),
  slackIntegrationController.postSlackUnfurl,
);

router.get(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  slackIntegrationController.getSlackIntegration,
);

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        name: z.string(),
        description: z.string(),
        projects: z.array(z.string()),
        environments: z.array(z.string()),
        events: z.array(z.enum(zodNotificationEventNamesEnum)),
        tags: z.array(z.string()),
        slackAppId: z.string(),
        slackSigningKey: z.string(),
        slackIncomingWebHook: z
          .string()
          .url()
          .startsWith("https://hooks.slack.com/services/"),
      })
      .strict(),
  }),
  slackIntegrationController.postSlackIntegration,
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z
      .object({
        name: z.string(),
        description: z.string(),
        projects: z.array(z.string()),
        environments: z.array(z.string()),
        events: z.array(z.enum(zodNotificationEventNamesEnum)),
        tags: z.array(z.string()),
        slackAppId: z.string(),
        slackSigningKey: z.string(),
        slackIncomingWebHook: z
          .string()
          .url()
          .startsWith("https://hooks.slack.com/services/"),
      })
      .strict(),
  }),
  slackIntegrationController.putSlackIntegration,
);

router.delete(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  slackIntegrationController.deleteSlackIntegration,
);

export { router as slackIntegrationRouter };
