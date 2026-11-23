import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as sessionReplayControllerRaw from "./session-replay.controller";

const router = express.Router();

const sessionReplayController = wrapController(sessionReplayControllerRaw);
const MAX_FILTER_STRING_LENGTH = 255;
const MAX_URL_FILTER_LENGTH = 2048;
const MAX_MULTI_FILTER_LENGTH = 2048;
const MAX_DURATION_SECS = 30 * 24 * 60 * 60;
const MAX_EVENT_COUNT = 1_000_000;

const filterString = z.string().max(MAX_FILTER_STRING_LENGTH);
const multiFilterString = z.string().max(MAX_MULTI_FILTER_LENGTH);
const nonNegativeNumberString = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((value) => Number(value) <= MAX_DURATION_SECS);
const nonNegativeIntegerString = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => Number(value) <= MAX_EVENT_COUNT);
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    );
  });

router.get(
  "/",
  validateRequestMiddleware({
    query: z
      .object({
        userId: filterString.optional(),
        clientKey: filterString.optional(),
        url: z.string().max(MAX_URL_FILTER_LENGTH).optional(),
        country: multiFilterString.optional(),
        device: multiFilterString.optional(),
        durationMinSecs: nonNegativeNumberString.optional(),
        durationMaxSecs: nonNegativeNumberString.optional(),
        eventCountMin: nonNegativeIntegerString.optional(),
        eventCountMax: nonNegativeIntegerString.optional(),
        featureKey: multiFilterString.optional(),
        experimentKey: multiFilterString.optional(),
        dateAfter: isoDateString.optional(),
        dateBefore: isoDateString.optional(),
        project: filterString.optional(),
        page: z.string().optional(),
      })
      .strict(),
  }),
  sessionReplayController.listSessions,
);
// Mirrors the ingestor's own `session_replay_id: z.guid()`, so every id that
// could have been stored still validates. Without this the id was silently
// stripped of non-alphanumerics downstream, turning a malformed id into a
// lookup for a different one rather than a 400.
router.get(
  "/:sessionId",
  validateRequestMiddleware({
    params: z.object({ sessionId: z.guid() }).strict(),
    query: z
      .object({
        fromChunk: nonNegativeIntegerString.optional(),
        maxChunks: nonNegativeIntegerString.optional(),
      })
      .strict(),
  }),
  sessionReplayController.getSession,
);

export { router as sessionReplayRouter };
