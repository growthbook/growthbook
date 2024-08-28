import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawTrackController from "./track.controller";

const router = express.Router();

const trackController = wrapController(rawTrackController);

router.post(
  "/event/:clientKey",
  validateRequestMiddleware({
    query: z
      .object({
        event_name: z.string(),
        value: z.string().optional(),
        properties: z.string().optional(),
        attributes: z.string().optional(),
      })
      .strict(),
  }),
  trackController.postEvent
);

router.post(
  "/ff-usage/:clientKey",
  validateRequestMiddleware({
    query: z
      .object({
        feature: z.string(),
        revision: z.string(),
        ruleId: z.string().optional(),
        variationId: z.string().optional(),
      })
      .strict(),
  }),
  trackController.postFeatureUsage
);

export { router as trackRouter };
