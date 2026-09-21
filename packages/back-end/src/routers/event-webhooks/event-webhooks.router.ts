import express from "express";
import { z } from "zod";
import {
  eventWebHookMethods,
  eventWebHookRequestBodySchema,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
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
    body: eventWebHookRequestBodySchema,
  }),
  eventWebHooksController.createEventWebHook,
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
  eventWebHooksController.getEventWebHookLogs,
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
  eventWebHooksController.getEventWebHook,
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
  eventWebHooksController.deleteEventWebHook,
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
    body: eventWebHookRequestBodySchema,
  }),
  eventWebHooksController.putEventWebHook,
);

router.post(
  "/event-webhooks/test-params",
  validateRequestMiddleware({
    body: z
      .object({
        name: z.string().trim().min(1),
        method: z.enum(eventWebHookMethods),
        url: z.string().url(),
      })
      .strict(),
  }),
  eventWebHooksController.testWebHookParams,
);

router.post(
  "/event-webhooks/test",
  validateRequestMiddleware({
    body: z
      .object({
        webhookId: z.string().trim().min(1),
      })
      .strict(),
  }),
  eventWebHooksController.createTestEventWebHook,
);

router.post(
  "/event-webhooks/toggle",
  validateRequestMiddleware({
    body: z
      .object({
        webhookId: z.string().trim().min(1),
      })
      .strict(),
  }),
  eventWebHooksController.toggleEventWebHook,
);

router.post(`/webhook-secrets`, eventWebHooksController.createWebhookSecret);
router.put(`/webhook-secrets/:id`, eventWebHooksController.updateWebhookSecret);
router.delete(
  `/webhook-secrets/:id`,
  eventWebHooksController.deleteWebhookSecret,
);

export { router as eventWebHooksRouter };
