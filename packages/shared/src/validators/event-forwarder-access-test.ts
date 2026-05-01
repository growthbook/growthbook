import { z } from "zod";

const datasourceParamsSchema = z.record(z.string(), z.unknown());

const bigQueryEventForwarderConfigSchema = z.object({
  sinkType: z.literal("bigquery"),
  config: z.object({
    tableName: z.string(),
    serviceAccountKey: z.string().optional(),
  }),
});

const snowflakeEventForwarderConfigSchema = z.object({
  sinkType: z.literal("snowflake"),
  config: z.object({
    tableName: z.string(),
    accessUrl: z.string().optional(),
  }),
});

const databricksEventForwarderConfigSchema = z.object({
  sinkType: z.literal("databricks"),
  config: z.record(z.string(), z.string()),
});

export const eventForwarderAccessTestConfigSchema = z.discriminatedUnion(
  "sinkType",
  [
    bigQueryEventForwarderConfigSchema,
    snowflakeEventForwarderConfigSchema,
    databricksEventForwarderConfigSchema,
  ],
);

export const eventForwarderAccessTestCreateBodySchema = z.object({
  type: z.enum(["bigquery", "snowflake", "databricks"]),
  params: datasourceParamsSchema,
  projects: z.array(z.string()).optional(),
  eventForwarderConfig: eventForwarderAccessTestConfigSchema,
});

export const eventForwarderAccessTestEditBodySchema = z.object({
  params: datasourceParamsSchema.optional(),
  eventForwarderConfig: eventForwarderAccessTestConfigSchema.optional(),
});

export const eventForwarderAccessTestResultSchema = z.object({
  result: z.enum(["success", "failed", "skipped"]),
  resultMessage: z.string().optional(),
});

export const eventForwarderAccessTestResponseSchema = z.object({
  status: z.literal(200),
  results: z.object({
    sinkWrite: eventForwarderAccessTestResultSchema,
  }),
});

export type EventForwarderAccessTestCreateBody = z.infer<
  typeof eventForwarderAccessTestCreateBodySchema
>;
export type EventForwarderAccessTestEditBody = z.infer<
  typeof eventForwarderAccessTestEditBodySchema
>;
export type EventForwarderAccessTestResponse = z.infer<
  typeof eventForwarderAccessTestResponseSchema
>;
export type EventForwarderAccessTestResult = z.infer<
  typeof eventForwarderAccessTestResultSchema
>;
