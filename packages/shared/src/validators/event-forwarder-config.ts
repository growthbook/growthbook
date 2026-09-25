import { z } from "zod";
import { baseSchema } from "./base-model";

const eventForwarderSinkTypeValidator = z.enum([
  "bigquery",
  "snowflake",
  "databricks",
]);
const eventForwarderStatusValidator = z.enum([
  "pending",
  "ready",
  "paused",
  "error",
  "schema_update_error",
]);

export const eventForwarderConfigValidator = baseSchema
  .extend({
    /** Owning datasource (`ds_*`); unique per org with `organization`. */
    datasourceId: z.string(),
    projects: z.array(z.string()), // Initial values should be derived from the data source this was created from
    /** Kafka topic name — pinned at creation; teardown must use this value (not derived from env). */
    topic: z.string(),
    /** Confluent schema registry schema id; absent for JSON (databricks) sinks. */
    schemaId: z.number().optional(),
    sinkType: eventForwarderSinkTypeValidator,
    /** AWS region hosting this forwarder's Kafka/Confluent resources. Set once at creation; absent means `us-east-1`. */
    region: z.enum(["us-east-1", "eu-west-1"]).optional(),
    config: z.string(), // Encrypted sink-specific configuration
    status: eventForwarderStatusValidator,
    /** Confluent connector name — set after successful provisioning; teardown uses this only (not env-derived). */
    connectorName: z.string().optional(),
    connectorId: z.string().optional(),
    lastProvisioningError: z.string().optional(),
    /** Set after the first delayed warehouse sync is queued on initial connector ready. */
    initialWarehouseSyncQueued: z.boolean().optional(),
    /** Written by the license server on behalf of the event-forwarder consumer (databricks). */
    consumerStatus: z
      .object({
        phase: z.enum(["ready", "error"]),
        message: z.string().optional(),
        lastWriteAt: z.date().optional(),
      })
      .optional(),
  })
  .strict();

export type EventForwarderConfigInterface = z.infer<
  typeof eventForwarderConfigValidator
>;
