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
});

export type EventForwarderStatusResponse = z.infer<
  typeof eventForwarderStatusResponseSchema
>;
