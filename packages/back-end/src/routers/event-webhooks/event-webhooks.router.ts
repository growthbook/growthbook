import express from "express";
import z from "zod";
import * as rawEventWebHooksController from "./event-webhooks.controller";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import { notificationEventNames } from "../../events/base-types";

const router = express.Router();

const eventWebHooksController = wrapController(rawEventWebHooksController);

/**
 * GET /event-webhooks
 * Get all documents in eventwebhooks for an organization
 */
router.get("/event-webhooks", eventWebHooksController.getEventWebHooks);

/**
 * POST /event-webhooks
 * Create a record in eventwebhooks
 */
router.post(
  "/event-webhooks",
  validateRequestMiddleware({
    body: z
      .object({
        url: z.string().url(),
        name: z.string().min(2),
        events: z.array(z.enum(notificationEventNames)).min(1),
      })
      .strict(),
  }),
  eventWebHooksController.createEventWebHook
);

/**
 * GET /event-webhooks/logs/:eventWebHookId
 * Get all documents in eventwebhooklogs for a given eventWebHookId for an organization
 */
router.get(
  "/event-webhooks/logs/:eventWebHookId",
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
