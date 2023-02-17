import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import { notificationEventNames } from "../../events/base-types";
import * as rawSlackIntegrationController from "./slack-integration.controller";

const router = express.Router();

const slackIntegrationController = wrapController(
  rawSlackIntegrationController
);

router.get("/", slackIntegrationController.getSlackIntegrations);

router.get(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  slackIntegrationController.getSlackIntegration
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
        events: z.array(z.enum(notificationEventNames)),
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
  slackIntegrationController.postSlackIntegration
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
        events: z.array(z.enum(notificationEventNames)),
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
  slackIntegrationController.putSlackIntegration
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
  slackIntegrationController.deleteSlackIntegration
);

export { router as slackIntegrationRouter };
