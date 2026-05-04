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
  .passthrough();

export type SessionReplayRrwebEvent = z.infer<
  typeof sessionReplayRrwebEventSchema
>;

/**
 * Context the SDK ships alongside each chunk so we can index sessions by
 * the user attributes and experiment exposures that were active when the
 * events were captured.
 */
export const sessionReplayIngestContextSchema = z
  .object({
    attributes: z.record(z.string(), z.unknown()).optional(),
    experiments: z.record(z.string(), z.number()).optional(),
    flags: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type SessionReplayIngestContext = z.infer<
  typeof sessionReplayIngestContextSchema
>;

/**
 * Body of POST /api/v1/session-replay/ingest. One request = one chunk of
 * events from one browser session. Spec §5.4.
 *
 * NOTE: this matches the current SDK output (camelCase, chunkIndex). The
 * wire-format alignment to snake_case + `sequence` lives in task #33; this
 * validator will be updated as part of that task without breaking callers
 * because the type is inferred.
 */
export const sessionReplayIngestBodySchema = z
  .object({
    clientKey: z.string().min(1),
    sessionId: z.string().min(1),
    chunkIndex: z.number().int().nonnegative(),
    events: z.array(sessionReplayRrwebEventSchema).min(1),
    context: sessionReplayIngestContextSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    // The first chunk must contain a FullSnapshot (rrweb event type 2);
    // without it the player can't initialize. Reject early instead of
    // letting an unplayable session land in S3.
    if (body.chunkIndex === 0 && !body.events.some((e) => e.type === 2)) {
      ctx.addIssue({
        code: "custom",
        path: ["events"],
        message:
          "First chunk (chunkIndex=0) must include at least one full snapshot (type 2)",
      });
    }
  });

export type SessionReplayIngestBody = z.infer<
  typeof sessionReplayIngestBodySchema
>;

/**
 * Internal session metadata document — the source-of-truth shape consumed
 * by the front-end list/replay UI. Today this is backed by ClickHouse (not
 * Mongo); the BaseModel migration in task #11 will wrap ClickHouse access
 * behind this validator's shape. The ClickHouse table itself uses
 * snake_case column names (session_id, started_at, ...); the model is
 * responsible for translating between the two.
 */
export const sessionReplayValidator = baseSchema.safeExtend({
  // GrowthBook-side session id (UUIDv7 once #28 lands; UUIDv4 today)
  sessionId: z.string(),
  clientKey: z.string(),
  // Caller-supplied user identifier (from SDK hashAttribute), may be empty
  // for anonymous sessions
  userId: z.string(),
  // S3 prefix for this session's chunk objects
  storagePrefix: z.string(),
  startedAt: z.date(),
  endedAt: z.date(),
  // Drives the idle-timeout sweeper (#14). On chunks past the first, this
  // is bumped on every ingest (#15).
  lastEventAt: z.date(),
  durationMs: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  urlFirst: z.string(),
  urlsVisited: z.array(z.string()),
  attributes: z.record(z.string(), z.string()),
  experiments: z.array(z.tuple([z.string(), z.string()])),
  flags: z.record(z.string(), z.string()),
  userAgent: z.string(),
  // recording → finalized → deleted. Sweeper transitions
  // recording→finalized; bulk-delete + GDPR set deleted.
  state: z.enum(["recording", "finalized", "deleted"]),
});

export type SessionReplayInterface = z.infer<typeof sessionReplayValidator>;
