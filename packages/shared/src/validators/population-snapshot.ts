import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";
import { queryPointerValidator } from "./queries";
import { booleanQueryField } from "./shared";

export const populationSnapshotStatusValidator = z.enum([
  "running",
  "success",
  "error",
]);

export const populationSnapshotResultValidator = z.strictObject({
  membersNow: z.number(),
  membersPrior: z.number(),
  joined: z.number(),
  left: z.number(),
});

export const populationSnapshotValidator = baseSchema
  .extend({
    population: z.string(),
    userIdType: z.string(),
    asOf: z.date(),
    comparisonDays: z.number().int().positive(),
    status: populationSnapshotStatusValidator,
    error: z.string().optional(),
    runStarted: z.date().nullable(),
    queries: z.array(queryPointerValidator),
    result: populationSnapshotResultValidator.nullable(),
  })
  .strict();

export type PopulationSnapshotInterface = z.infer<
  typeof populationSnapshotValidator
>;
export type PopulationSnapshotResult = z.infer<
  typeof populationSnapshotResultValidator
>;

export const apiPopulationSnapshotValidator = namedSchema(
  "PopulationSnapshot",
  apiBaseSchema
    .extend({
      population: z.string(),
      userIdType: z.string(),
      asOf: z.iso.datetime(),
      comparisonDays: z.number(),
      status: populationSnapshotStatusValidator,
      error: z.string(),
      queries: z
        .array(queryPointerValidator)
        .describe("The warehouse queries this refresh ran"),
      result: populationSnapshotResultValidator
        .nullable()
        .describe(
          "Members as of `asOf`, members `comparisonDays` earlier, and the units that joined or left in between. Null until the refresh succeeds.",
        ),
    })
    .strict(),
);
export type ApiPopulationSnapshot = z.infer<
  typeof apiPopulationSnapshotValidator
>;

export const apiListPopulationSnapshotsValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({
    populationId: z.string().optional().describe("Only this population"),
    latest: booleanQueryField.describe(
      "Return only the most recent snapshot of each population, whatever its status",
    ),
    startDate: z.iso
      .datetime()
      .optional()
      .describe("Only successful snapshots as of this date or later"),
    endDate: z.iso
      .datetime()
      .optional()
      .describe("Only successful snapshots as of this date or earlier"),
  }),
  paramsSchema: z.never(),
};

const populationIdParam = z.strictObject({
  id: z.string().describe("The population id"),
});

export const refreshPopulationEndpoint = {
  pathFragment: "/:id/refresh",
  verb: "post" as const,
  operationId: "refreshPopulation",
  validator: {
    paramsSchema: populationIdParam,
    bodySchema: z.never(),
    querySchema: z.never(),
  },
  zodReturnObject: z.strictObject({
    populationSnapshot: apiPopulationSnapshotValidator,
  }),
  summary: "Refresh a population's size",
  description:
    "Starts a warehouse query that counts the population's members now and 30 days ago. Returns the running snapshot, or the one already running. Poll `GET /population-snapshots/{id}` until its status is `success` or `error`.",
};

export const cancelPopulationRefreshEndpoint = {
  pathFragment: "/:id/cancel",
  verb: "post" as const,
  operationId: "cancelPopulationRefresh",
  validator: {
    paramsSchema: populationIdParam,
    bodySchema: z.never(),
    querySchema: z.never(),
  },
  zodReturnObject: z.strictObject({
    canceled: z
      .boolean()
      .describe("False when the population had no running refresh"),
  }),
  summary: "Cancel a running population refresh",
};
