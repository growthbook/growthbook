import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import { slackEventWebhookTestEventNames } from "back-end/src/services/slackBot";
import * as rawSlackTestController from "./slack-test.controller";

const router = express.Router();
const slackTestController = wrapController(rawSlackTestController);

router.get(
  "/event-webhook/previews",
  slackTestController.getEventWebhookPreviews,
);

router.post(
  "/event-webhook",
  validateRequestMiddleware({
    // Exactly one of `eventName` (post a sample notification) or `digest`
    // (post a sample digest image).
    body: z
      .object({
        eventWebHookId: z.string().min(1),
        eventName: z.enum(slackEventWebhookTestEventNames).optional(),
        digest: z.enum(["scorecard", "feature"]).optional(),
      })
      .strict()
      .refine((b) => !!b.eventName !== !!b.digest, {
        message: "Provide exactly one of eventName or digest",
      }),
  }),
  slackTestController.postEventWebhook,
);

// Render an experiment card as a PNG for eyeballing (see controller for query params).
router.get("/chart-preview", slackTestController.getChartPreview);

// Post a real experiment card to the org's Slack channel (end-to-end path test).
router.post(
  "/chart-post",
  validateRequestMiddleware({
    body: z.object({ experimentId: z.string().min(1) }).strict(),
  }),
  slackTestController.postChartToSlack,
);

export { router as slackTestRouter };
