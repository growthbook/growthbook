import { z } from "zod";
import { baseSchema } from "./base-model";

const eventForwarderSinkTypeValidator = z.enum(["bigquery", "snowflake"]);
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
    schemaId: z.number(), // The confluent schema registry schema id
    sinkType: eventForwarderSinkTypeValidator,
    config: z.string(), // Encrypted sink-specific configuration
    /**
     * Cloud + region of the destination warehouse, derived from the datasource
     * connection at provisioning time. Sent to the license server to route to a
     * co-located Confluent cluster. Optional/back-compat: absent configs fall
     * back to the license server's default cluster.
     */
    cloud: z.enum(["aws", "gcp", "azure"]).optional(),
    region: z.string().optional(),
    status: eventForwarderStatusValidator,
    /** Confluent connector name — set after successful provisioning; teardown uses this only (not env-derived). */
    connectorName: z.string().optional(),
    connectorId: z.string().optional(),
    lastProvisioningError: z.string().optional(),
    /** Set after the first delayed warehouse sync is queued on initial connector ready. */
    initialWarehouseSyncQueued: z.boolean().optional(),
  })
  .strict();

export type EventForwarderConfigInterface = z.infer<
  typeof eventForwarderConfigValidator
>;
