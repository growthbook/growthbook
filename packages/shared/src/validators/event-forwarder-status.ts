import { z } from "zod";

export const eventForwarderConnectorPhaseSchema = z.enum([
  "provisioning",
  "ready",
  "error",
  "paused",
]);

export type EventForwarderConnectorPhase = z.infer<
  typeof eventForwarderConnectorPhaseSchema
>;

export const eventForwarderConnectorTaskErrorSchema = z.object({
  id: z.number(),
  state: z.string(),
  trace: z.string().optional(),
});

// Events the consumer could not write, parked until the next restart.
export const eventForwarderBacklogSchema = z.object({
  count: z.number(),
  // True when counting stopped at its cap; the real count is higher.
  capped: z.boolean(),
  oldestAt: z.string().optional(),
});

export type EventForwarderBacklog = z.infer<typeof eventForwarderBacklogSchema>;

// What replays of parked events have written so far.
// - earliestEventAt: event time of the oldest replayed row.
// - lastWriteAt: when a replay last wrote a row.
export const eventForwarderReplaySchema = z.object({
  earliestEventAt: z.string().optional(),
  lastWriteAt: z.string(),
});

export type EventForwarderReplay = z.infer<typeof eventForwarderReplaySchema>;

export const eventForwarderStatusResponseSchema = z.object({
  status: z.enum([
    "pending",
    "ready",
    "paused",
    "error",
    "schema_update_error",
  ]),
  phase: eventForwarderConnectorPhaseSchema,
  message: z.string().optional(),
  confluentState: z.string().optional(),
  taskErrors: z.array(eventForwarderConnectorTaskErrorSchema).optional(),
  backlog: eventForwarderBacklogSchema.optional(),
});

export type EventForwarderStatusResponse = z.infer<
  typeof eventForwarderStatusResponseSchema
>;
