import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as sessionReplayControllerRaw from "./session-replay.controller";

const router = express.Router();

const sessionReplayController = wrapController(sessionReplayControllerRaw);
const MAX_FILTER_STRING_LENGTH = 255;
const MAX_SHORT_FILTER_STRING_LENGTH = 64;
const MAX_URL_FILTER_LENGTH = 2048;
const MAX_DURATION_SECS = 30 * 24 * 60 * 60;
const MAX_EVENT_COUNT = 1_000_000;

const filterString = z.string().max(MAX_FILTER_STRING_LENGTH);
const shortFilterString = z.string().max(MAX_SHORT_FILTER_STRING_LENGTH);
const nonNegativeNumberString = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((value) => Number(value) <= MAX_DURATION_SECS);
const nonNegativeIntegerString = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => Number(value) <= MAX_EVENT_COUNT);

router.get(
  "/",
  validateRequestMiddleware({
    query: z
      .object({
        userId: filterString.optional(),
        clientKey: filterString.optional(),
        url: z.string().max(MAX_URL_FILTER_LENGTH).optional(),
        country: shortFilterString.optional(),
        device: shortFilterString.optional(),
        durationMinSecs: nonNegativeNumberString.optional(),
        durationMaxSecs: nonNegativeNumberString.optional(),
        eventCountMin: nonNegativeIntegerString.optional(),
        eventCountMax: nonNegativeIntegerString.optional(),
        featureKey: filterString.optional(),
        experimentKey: filterString.optional(),
        project: filterString.optional(),
        page: z.string().optional(),
      })
      .strict(),
  }),
  sessionReplayController.listSessions,
);
router.get("/:sessionId", sessionReplayController.getSession);

export { router as sessionReplayRouter };
