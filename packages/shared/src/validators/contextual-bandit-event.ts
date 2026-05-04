import { z } from "zod";

import { namedSchema } from "./openapi-helpers";
import {
  apiPaginationFieldsValidator,
  paginationQueryFields,
} from "./shared";

// ---------------------------------------------------------------------------
// Internal (Mongo) shape — matches walkthrough §4.2 db.contextualBanditEvents
// ---------------------------------------------------------------------------

/** A leaf in the regression tree at the time of this snapshot. */
export const treeLeafValidator = z
  .object({
    leafId: z.string(),
    rule: z
      .string()
      .describe("Human-readable description of the leaf condition"),
    condition: z
      .record(z.string(), z.unknown())
      .describe("SDK-condition for users falling into this leaf"),
    n: z.number().int().min(0).describe("Number of users in the leaf"),
    contextIds: z
      .array(z.string())
      .describe("Per-context ids that fall into this leaf"),
    weights: z
      .array(z.number())
      .describe("Per-variation weights chosen for this leaf"),
  })
  .strict();
export type TreeLeaf = z.infer<typeof treeLeafValidator>;

/** Per-context analysis result inside the CB event. */
export const contextResultValidator = z
  .object({
    contextId: z.string(),
    leafId: z.string().describe("Leaf this context belongs to"),
    n: z.number().int().min(0),
    weights: z.array(z.number()),
    variationStats: z
      .array(
        z.object({
          users: z.number().optional(),
          mean: z.number().optional(),
          stddev: z.number().optional(),
        }),
      )
      .optional(),
  })
  .strict();
export type ContextResult = z.infer<typeof contextResultValidator>;

export const treeSummaryValidator = z
  .object({
    leaves: z.array(treeLeafValidator),
    splitFeatures: z.array(z.string()).default([]),
    treeModel: z.enum(["regression_tree", "linear_thompson"]),
  })
  .strict();
export type TreeSummary = z.infer<typeof treeSummaryValidator>;

export const contextualBanditEventValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    experiment: z.string(),
    phase: z.number().int().min(0),
    snapshotId: z.string().optional(),
    date: z.date(),
    cbaqId: z.string(),
    contextResults: z.array(contextResultValidator),
    tree: treeSummaryValidator,
    updateMessage: z.string().optional(),
    error: z.string().optional(),
    weightsWereUpdated: z.boolean().default(false),
    reweight: z.boolean().default(false),
    bestArmProbabilitiesByLeaf: z
      .record(z.string(), z.array(z.number()))
      .optional(),
    seed: z.number().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();
export type ContextualBanditEventInterface = z.infer<
  typeof contextualBanditEventValidator
>;

// ---------------------------------------------------------------------------
// API (ISO date) named OpenAPI schema
// ---------------------------------------------------------------------------

const apiTreeLeaf = z
  .object({
    leafId: z.string(),
    rule: z.string(),
    condition: z.record(z.string(), z.unknown()),
    n: z.number().int(),
    contextIds: z.array(z.string()),
    weights: z.array(z.number()),
  })
  .strict();

const apiContextResult = z
  .object({
    contextId: z.string(),
    leafId: z.string(),
    n: z.number().int(),
    weights: z.array(z.number()),
    variationStats: z
      .array(
        z.object({
          users: z.number().optional(),
          mean: z.number().optional(),
          stddev: z.number().optional(),
        }),
      )
      .optional(),
  })
  .strict();

const apiTreeSummary = z
  .object({
    leaves: z.array(apiTreeLeaf),
    splitFeatures: z.array(z.string()),
    treeModel: z.enum(["regression_tree", "linear_thompson"]),
  })
  .strict();

export const apiContextualBanditEventValidator = namedSchema(
  "ContextualBanditEvent",
  z
    .object({
      id: z.string(),
      experimentId: z.string(),
      phase: z.number().int(),
      snapshotId: z.string().optional(),
      cbaqId: z.string(),
      date: z.string().meta({ format: "date-time" }),
      contextResults: z.array(apiContextResult),
      tree: apiTreeSummary,
      updateMessage: z.string().optional(),
      error: z.string().optional(),
      weightsWereUpdated: z.boolean(),
      reweight: z.boolean(),
      seed: z.number().optional(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);
export type ApiContextualBanditEvent = z.infer<
  typeof apiContextualBanditEventValidator
>;

// ---------------------------------------------------------------------------
// Route validators (read-only)
// ---------------------------------------------------------------------------

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listContextualBanditEventsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      experimentId: z.string().describe("Filter by experiment id").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      contextualBanditEvents: z.array(apiContextualBanditEventValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all contextual bandit events",
  operationId: "listContextualBanditEvents",
  tags: ["contextual-bandit-events"],
  method: "get" as const,
  path: "/contextual-bandit-events",
};

export const getContextualBanditEventValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({ contextualBanditEvent: apiContextualBanditEventValidator })
    .strict(),
  summary: "Get a single contextual bandit event",
  operationId: "getContextualBanditEvent",
  tags: ["contextual-bandit-events"],
  method: "get" as const,
  path: "/contextual-bandit-events/:id",
};

// ---------------------------------------------------------------------------
// Experiment-scoped routes
// (mounted under /experiments/:id/contextual-bandit/*; see P6.4)
// ---------------------------------------------------------------------------

const experimentIdParams = z
  .object({
    id: z.string().describe("Experiment id"),
  })
  .strict();

const experimentEventParams = z
  .object({
    id: z.string().describe("Experiment id"),
    eventId: z.string().describe("Contextual bandit event id"),
  })
  .strict();

export const getExperimentContextualBanditCurrentValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      phase: z
        .coerce
        .number()
        .int()
        .min(0)
        .describe("Phase index (defaults to last phase)")
        .optional(),
    })
    .strict(),
  paramsSchema: experimentIdParams,
  responseSchema: z
    .object({
      contextualBanditEvent: apiContextualBanditEventValidator.optional(),
    })
    .strict(),
  summary: "Get the current (latest) contextual bandit event",
  operationId: "getExperimentContextualBanditCurrent",
  tags: ["experiments", "contextual-bandit-events"],
  method: "get" as const,
  path: "/experiments/:id/contextual-bandit/current",
};

export const listExperimentContextualBanditEventsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      cursor: z
        .string()
        .describe("ISO date cursor returned by the previous page")
        .optional(),
      limit: z
        .coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .describe("Maximum number of events to return (default 25, max 100)")
        .optional(),
    })
    .strict(),
  paramsSchema: experimentIdParams,
  responseSchema: z
    .object({
      contextualBanditEvents: z.array(apiContextualBanditEventValidator),
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    })
    .strict(),
  summary: "List contextual bandit events for an experiment",
  operationId: "listExperimentContextualBanditEvents",
  tags: ["experiments", "contextual-bandit-events"],
  method: "get" as const,
  path: "/experiments/:id/contextual-bandit/events",
};

export const getExperimentContextualBanditEventValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: experimentEventParams,
  responseSchema: z
    .object({ contextualBanditEvent: apiContextualBanditEventValidator })
    .strict(),
  summary: "Get a single contextual bandit event for an experiment",
  operationId: "getExperimentContextualBanditEvent",
  tags: ["experiments", "contextual-bandit-events"],
  method: "get" as const,
  path: "/experiments/:id/contextual-bandit/events/:eventId",
};

const apiContextHistoryEntry = z
  .object({
    eventId: z.string(),
    date: z.string().meta({ format: "date-time" }),
    weights: z.array(z.number()),
    leafId: z.string(),
  })
  .strict();

export const getExperimentContextualBanditContextsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      contextId: z
        .string()
        .describe("Filter to one specific context id")
        .optional(),
    })
    .strict(),
  paramsSchema: experimentIdParams,
  responseSchema: z
    .object({
      /** When `contextId` is omitted, returns latest weights per context. */
      contexts: z
        .array(
          z.object({
            contextId: z.string(),
            leafId: z.string(),
            n: z.number().int(),
            weights: z.array(z.number()),
          }),
        )
        .optional(),
      /** When `contextId` is supplied, returns historical weights newest-first. */
      history: z.array(apiContextHistoryEntry).optional(),
    })
    .strict(),
  summary: "List context-level results for a contextual bandit experiment",
  operationId: "getExperimentContextualBanditContexts",
  tags: ["experiments", "contextual-bandit-events"],
  method: "get" as const,
  path: "/experiments/:id/contextual-bandit/contexts",
};

export const postExperimentContextualBanditRefreshValidator = {
  bodySchema: z
    .object({
      reweight: z
        .boolean()
        .describe(
          "Force the orchestrator into the reweight (exploit) path on this snapshot.",
        )
        .optional(),
    })
    .strict()
    .optional(),
  querySchema: z.never(),
  paramsSchema: experimentIdParams,
  responseSchema: z
    .object({
      contextualBanditEvent: apiContextualBanditEventValidator,
      weightsWereUpdated: z.boolean(),
      trimmedContexts: z.array(z.string()).optional(),
      warnings: z.array(z.string()).optional(),
    })
    .strict(),
  summary: "Trigger a contextual bandit snapshot refresh",
  operationId: "postExperimentContextualBanditRefresh",
  tags: ["experiments", "contextual-bandit-events"],
  method: "post" as const,
  path: "/experiments/:id/contextual-bandit/refresh",
};

/** Maximum total cells (contexts × variations) allowed in a single CBE doc. */
export const CONTEXTUAL_BANDIT_EVENT_CELL_CAP = 3000;
