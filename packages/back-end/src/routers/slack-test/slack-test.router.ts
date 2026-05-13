import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawSlackTestController from "./slack-test.controller";

const router = express.Router();
const slackTestController = wrapController(rawSlackTestController);

router.post(
  "/hello-world",
  validateRequestMiddleware({
    body: z.object({ channel: z.string().min(1) }).strict(),
  }),
  slackTestController.postHelloWorld,
);

export { router as slackTestRouter };
