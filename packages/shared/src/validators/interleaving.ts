import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import {
  ownerEmailField,
  ownerField,
  ownerInputField,
  optionalOwnerInputField,
} from "./owner-field";
import { namedSchema } from "./openapi-helpers";

/**
 * An Interleaving experiment compares two rankers by weaving their ranked
 * lists into one blended list per impression (SDK `interleave()` plugin) and
 * crediting engagement to the drafting ranker. It is a separate feature from
 * experiments (contextual-bandit pattern): its own model, snapshot, and query
 * runner, reusing the results UI at the SnapshotMetric level.
 */

export const interleavingStatus = ["draft", "running", "stopped"] as const;
export type InterleavingStatus = (typeof interleavingStatus)[number];

// Which estimator analyzed a metric:
// - "paired": engagement joinable to impressions via interleave_id ->
//   DoorDash-style paired delta-method t-test
// - "ownership": no interleave_id -> Airbnb-style per-user item-ownership
//   attribution + sign test
export const interleavingEstimators = ["paired", "ownership"] as const;
export type InterleavingEstimator = (typeof interleavingEstimators)[number];

export const interleavingValidator = baseSchema
  .extend({
    name: z.string(),
    description: z.string().optional(),
    project: z.string().optional(),
    owner: ownerField,
    tags: z.array(z.string()),
    archived: z.boolean(),

    status: z.enum(interleavingStatus),
    dateStarted: z.date().optional(),
    dateStopped: z.date().optional(),

    // Matches the SDK InterleaveExperiment key (experiment_id in exposures)
    trackingKey: z.string(),

    datasource: z.string(),
    interleavingQueryId: z.string(),

    // SDK list names, control first; must match the exposure `variation` column
    variationNames: z.tuple([z.string(), z.string()]),

    // Fact metric ids (mean or proportion, fact table must have item_id)
    metricIds: z.array(z.string()),
  })
  .strict();

export type InterleavingInterface = z.infer<typeof interleavingValidator>;

export const apiInterleavingValidator = namedSchema(
  "Interleaving",
  apiBaseSchema.safeExtend({
    name: z.string(),
    description: z.string().optional(),
    project: z.string().optional(),
    owner: ownerField,
    ownerEmail: ownerEmailField,
    tags: z.array(z.string()),
    archived: z.boolean(),
    status: z.enum(interleavingStatus),
    dateStarted: z.iso.datetime().optional(),
    dateStopped: z.iso.datetime().optional(),
    trackingKey: z.string(),
    datasource: z.string(),
    interleavingQueryId: z.string(),
    variationNames: z.tuple([z.string(), z.string()]),
    metricIds: z.array(z.string()),
  }),
);

export type ApiInterleavingInterface = z.infer<typeof apiInterleavingValidator>;

export const apiListInterleavingsValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({
    projectId: z.string().optional(),
  }),
  paramsSchema: z.never(),
};

export const apiCreateInterleavingBody = z.strictObject({
  owner: optionalOwnerInputField,
  name: z.string(),
  description: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  trackingKey: z.string(),
  datasource: z.string(),
  interleavingQueryId: z.string(),
  variationNames: z.tuple([z.string(), z.string()]),
  metricIds: z.array(z.string()),
});

export type ApiCreateInterleavingBody = z.infer<
  typeof apiCreateInterleavingBody
>;

export const apiUpdateInterleavingBody = z.strictObject({
  owner: ownerInputField.optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
  status: z.enum(interleavingStatus).optional(),
  trackingKey: z.string().optional(),
  interleavingQueryId: z.string().optional(),
  variationNames: z.tuple([z.string(), z.string()]).optional(),
  metricIds: z.array(z.string()).optional(),
});

export type ApiUpdateInterleavingBody = z.infer<
  typeof apiUpdateInterleavingBody
>;
