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
    body: z
      .object({
        eventWebHookId: z.string().min(1),
        eventName: z.enum(slackEventWebhookTestEventNames),
      })
      .strict(),
  }),
  slackTestController.postEventWebhook,
);

// Phase 2: render an experiment card as a PNG for eyeballing quality
// (?experimentId= for real data, else ?state= for a sample).
router.get("/chart-preview", slackTestController.getChartPreview);

// Render a real experiment card and post it to the org's connected Slack
// channel — end-to-end test of snapshot → card → upload → image block.
router.post(
  "/chart-post",
  validateRequestMiddleware({
    body: z.object({ experimentId: z.string().min(1) }).strict(),
  }),
  slackTestController.postChartToSlack,
);

export { router as slackTestRouter };
