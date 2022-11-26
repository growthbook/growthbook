import express from "express";
import z from "zod";
import * as rawEventWebHooksController from "./event-webhooks.controller";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";

const router = express.Router();

const eventWebHooksController = wrapController(rawEventWebHooksController);

router.get("/", eventWebHooksController.getEventWebHooks);

router.get(
  "/logs/:eventWebHookId",
  validateRequestMiddleware({
    params: z
      .object({
        eventWebHookId: z.string(),
      })
      .strict(),
  }),
  eventWebHooksController.getEventWebHookLogs
);

export { router as eventWebHooksRouter };
