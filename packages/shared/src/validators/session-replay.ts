import { z } from "zod";
import { baseSchema } from "./base-model";

/**
 * Single rrweb event. We intentionally don't validate the inner shape — rrweb
 * has many event variants and they evolve with the library. We just gate on
 * the minimum we need to safely route + persist: a numeric type and a
 * timestamp. Everything else is opaque to the back-end.
 */
export const sessionReplayRrwebEventSchema = z
  .object({
    type: z.number().int(),
    timestamp: z.number(),
    data: z.unknown(),
  })
  .loose();

export type SessionReplayRrwebEvent = z.infer<
  typeof sessionReplayRrwebEventSchema
>;

// ---------------------------------------------------------------------------
// Structured evaluation / event item schemas (mirrored from the ingestor)
// ---------------------------------------------------------------------------

export const featureEvalItemSchema = z.object({
  featureKey: z.string(),
  timestamp: z.number(),
  result: z.object({
    value: z.unknown().nullable(),
    experimentKey: z.string().optional(),
  }),
});

export const experimentEvalItemSchema = z.object({
  key: z.string(),
  timestamp: z.number(),
  name: z.string().optional(),
  result: z.object({
    value: z.unknown(),
    variationId: z.number().int(),
    featureId: z.string().nullable(),
  }),
});

export const sessionEventItemSchema = z.object({
  eventName: z.string(),
  timestamp: z.number(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export type FeatureEvalItem = z.infer<typeof featureEvalItemSchema>;
export type ExperimentEvalItem = z.infer<typeof experimentEvalItemSchema>;
export type SessionEventItem = z.infer<typeof sessionEventItemSchema>;

const featureEvalsColumnSchema = z.object({
  items: z.array(featureEvalItemSchema),
});

const experimentEvalsColumnSchema = z.object({
  items: z.array(experimentEvalItemSchema),
});

const sessionEventsColumnSchema = z.object({
  items: z.array(sessionEventItemSchema),
});

export const sessionReplayValidator = baseSchema.safeExtend({
  sessionId: z.string(),
  clientKey: z.string(),
  userId: z.string(),
  deviceId: z.string(),
  storagePrefix: z.string(),
  startedAt: z.date(),
  endedAt: z.date(),
  lastEventAt: z.date(),
  durationMs: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  urlFirst: z.string(),
  urlsVisited: z.array(z.string()),
  pageTitle: z.string(),
  viewportWidth: z.number().int().nonnegative(),
  viewportHeight: z.number().int().nonnegative(),
  utmSource: z.string(),
  utmMedium: z.string(),
  utmCampaign: z.string(),
  utmTerm: z.string(),
  utmContent: z.string(),
  attributes: z.record(z.string(), z.string()),
  featureEvals: featureEvalsColumnSchema,
  experimentEvals: experimentEvalsColumnSchema,
  sessionEvents: sessionEventsColumnSchema,
  userAgent: z.string(),
  state: z.enum(["recording", "finalized", "deleted"]),
});

export type SessionReplayInterface = z.infer<typeof sessionReplayValidator>;
