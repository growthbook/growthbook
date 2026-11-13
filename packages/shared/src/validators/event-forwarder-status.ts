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

// Oldest event time replays of parked events have written, and their last write.
export const eventForwarderReplaySchema = z.object({
  earliestEventAt: z.string(),
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
  // Events the consumer could not write, parked until the next restart.
  backlogCount: z.number().optional(),
});

export type EventForwarderStatusResponse = z.infer<
  typeof eventForwarderStatusResponseSchema
>;
