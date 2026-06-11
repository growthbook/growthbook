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

export { router as slackTestRouter };
