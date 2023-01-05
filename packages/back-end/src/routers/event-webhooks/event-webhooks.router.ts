import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import { notificationEventNames } from "../../events/base-types";
import * as rawEventWebHooksController from "./event-webhooks.controller";

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
        name: z.string().trim().min(2),
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

/**
 * GET /event-webhooks/:eventWebHookId
 * Get one eventwebhook for an organization by ID
 */
router.get(
  "/event-webhooks/:eventWebHookId",
  validateRequestMiddleware({
    params: z
      .object({
        eventWebHookId: z.string(),
      })
      .strict(),
  }),
  eventWebHooksController.getEventWebHook
);

/**
 * DELETE /event-webhooks/:eventWebHookId
 * Delete an eventwebhook for an organization by ID
 */
router.delete(
  "/event-webhooks/:eventWebHookId",
  validateRequestMiddleware({
    params: z
      .object({
        eventWebHookId: z.string(),
      })
      .strict(),
  }),
  eventWebHooksController.deleteEventWebHook
);

/**
 * PUT /event-webhooks/:eventWebHookId
 * Update one eventwebhook for an organization by ID
 */
router.put(
  "/event-webhooks/:eventWebHookId",
  validateRequestMiddleware({
    params: z
      .object({
        eventWebHookId: z.string(),
      })
      .strict(),
    body: z
      .object({
        url: z.string().url(),
        name: z.string().trim().min(2),
        events: z.array(z.enum(notificationEventNames)).min(1),
      })
      .strict(),
  }),
  eventWebHooksController.putEventWebHook
);

export { router as eventWebHooksRouter };
