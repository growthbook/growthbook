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
  experiments: z.record(z.string(), z.string()),
  flags: z.record(z.string(), z.string()),
  userAgent: z.string(),
  state: z.enum(["recording", "finalized", "deleted"]),
});

export type SessionReplayInterface = z.infer<typeof sessionReplayValidator>;
