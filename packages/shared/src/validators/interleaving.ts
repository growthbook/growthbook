import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import {
  ownerEmailField,
  ownerField,
  ownerInputField,
  optionalOwnerInputField,
} from "./owner-field";
import { namedSchema } from "./openapi-helpers";
import { queryPointerValidator } from "./queries";

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

// Per-metric analysis config. "paired" is only allowed when the metric's
// fact table has both item_id and interleave_id columns; "ownership" only
// requires item_id.
export const interleavingMetricConfigValidator = z
  .object({
    id: z.string(),
    estimator: z.enum(interleavingEstimators),
  })
  .strict();
export type InterleavingMetricConfig = z.infer<
  typeof interleavingMetricConfigValidator
>;

// Share of enrolled users (0 <= p < 100) held out of interleaving and served
// the control ranker unchanged. The SDK tracks the holdout as a standard
// user-level experiment under `<trackingKey>__measurement` (variations
// "status-quo" and "interleaved"), so interleaving itself can be compared
// against the status quo. 0 disables the measurement arm.
export const measurementArmPercentValidator = z
  .number()
  .min(0, "Measurement arm percentage must be at least 0")
  .lt(100, "Measurement arm percentage must be less than 100");

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

    // Mean or proportion Fact Metrics with per-metric estimator choice
    metrics: z.array(interleavingMetricConfigValidator),

    measurementArmPercent: measurementArmPercentValidator.optional(),
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
    metrics: z.array(interleavingMetricConfigValidator),
    measurementArmPercent: measurementArmPercentValidator.optional(),
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
  metrics: z.array(interleavingMetricConfigValidator),
  measurementArmPercent: measurementArmPercentValidator.optional(),
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
  metrics: z.array(interleavingMetricConfigValidator).optional(),
  measurementArmPercent: measurementArmPercentValidator.optional(),
});

export type ApiUpdateInterleavingBody = z.infer<
  typeof apiUpdateInterleavingBody
>;

const interleavingIdOnlyParam = z.object({ id: z.string() }).strict();

const interleavingLifecycleResponse = z
  .object({ interleaving: apiInterleavingValidator })
  .strict();

// Lifecycle: draft -> running -> stopped. Only running interleaving
// experiments are included in the SDK payload.
export const startInterleavingValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: interleavingIdOnlyParam,
  responseSchema: interleavingLifecycleResponse,
  summary: "Start a draft interleaving experiment",
  operationId: "startInterleaving",
  tags: ["Interleavings"],
  method: "post" as const,
  path: "/interleavings/:id/start",
};

export const stopInterleavingValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: interleavingIdOnlyParam,
  responseSchema: interleavingLifecycleResponse,
  summary: "Stop a running interleaving experiment",
  operationId: "stopInterleaving",
  tags: ["Interleavings"],
  method: "post" as const,
  path: "/interleavings/:id/stop",
};

export const refreshInterleavingValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: interleavingIdOnlyParam,
  responseSchema: z.object({ snapshotId: z.string() }).strict(),
  summary: "Trigger an interleaving results refresh",
  operationId: "refreshInterleaving",
  tags: ["Interleavings"],
  method: "post" as const,
  path: "/interleavings/:id/refresh",
};

export const interleavingSnapshotResponseShape = z
  .object({
    id: z.string(),
    status: z.enum(["pending", "running", "success", "error"]),
    error: z.string().optional(),
    runStarted: z.string().nullable(),
    queries: z.array(queryPointerValidator),
    metricEstimators: z
      .record(z.string(), z.enum(interleavingEstimators))
      .optional(),
    results: z.array(z.unknown()).optional(),
    dateCreated: z.string(),
  })
  .strict();

export const getInterleavingResultsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: interleavingIdOnlyParam,
  responseSchema: z
    .object({ snapshot: interleavingSnapshotResponseShape.nullable() })
    .strict(),
  summary: "Get the latest interleaving results snapshot",
  operationId: "getInterleavingResults",
  tags: ["Interleavings"],
  method: "get" as const,
  path: "/interleavings/:id/results",
};

export const cancelInterleavingRefreshValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: interleavingIdOnlyParam,
  responseSchema: z.object({ cancelled: z.boolean() }).strict(),
  summary: "Cancel a running interleaving results refresh",
  operationId: "cancelInterleavingRefresh",
  tags: ["Interleavings"],
  method: "post" as const,
  path: "/interleavings/:id/cancel-refresh",
};
