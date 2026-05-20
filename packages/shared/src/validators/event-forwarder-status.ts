import { z } from "zod";

export const eventForwarderConnectorPhaseSchema = z.enum([
  "provisioning",
  "ready",
  "error",
  "paused",
]);

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
});

export type EventForwarderStatusResponse = z.infer<
  typeof eventForwarderStatusResponseSchema
>;
