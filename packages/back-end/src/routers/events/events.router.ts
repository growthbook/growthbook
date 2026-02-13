import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawEventsController from "./events.controller.js";

const router = express.Router();

const eventsController = wrapController(rawEventsController);

router.get(
  "/",
  validateRequestMiddleware({
    query: z
      .object({
        page: z.string().default("1"),
        perPage: z.string().default("50"),
        type: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        sortOrder: z.string().optional(),
      })
      .strict(),
  }),
  eventsController.getEvents,
);

// get the total count of events
router.get(
  "/count",
  validateRequestMiddleware({
    query: z
      .object({
        type: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .strict(),
  }),
  eventsController.getEventsCount,
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
  eventsController.getEventById,
);

export { router as eventsRouter };
