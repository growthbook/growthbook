import { z } from "zod";
import { baseSchema } from "./base-model";

export const eventForwarderConfigValidator = baseSchema
  .extend({
    projects: z.array(z.string()), // Initial values should be derived from the data source this was created from
    topic: z.string(), // The kafka topic to send events to
    schemaId: z.number(), // The confluent schema registry schema id
  })
  .strict();

export type EventForwarderConfigInterface = z.infer<
  typeof eventForwarderConfigValidator
>;
