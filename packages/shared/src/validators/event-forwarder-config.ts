import { z } from "zod";
import { baseSchema } from "./base-model";

const eventForwarderSinkTypeValidator = z.enum([
  "bigquery",
  "snowflake",
  "databricks",
]);
const eventForwarderStatusValidator = z.enum(["pending", "ready", "error"]);

export const eventForwarderConfigValidator = baseSchema
  .extend({
    projects: z.array(z.string()), // Initial values should be derived from the data source this was created from
    topic: z.string(), // The kafka topic to send events to
    schemaId: z.number(), // The confluent schema registry schema id
    sinkType: eventForwarderSinkTypeValidator,
    config: z.string(), // Encrypted sink-specific configuration
    status: eventForwarderStatusValidator,
    connectorName: z.string().optional(),
    connectorId: z.string().optional(),
    lastProvisioningError: z.string().optional(),
  })
  .strict();

export type EventForwarderConfigInterface = z.infer<
  typeof eventForwarderConfigValidator
>;
