import { z } from "zod";
import { paginationQueryFields, apiPaginationFieldsValidator } from "./shared";

const errorTrackingIssueSummary = z
  .object({
    fingerprint: z.string(),
    title: z.string(),
    firstSeen: z.string().meta({ format: "date-time" }),
    lastSeen: z.string().meta({ format: "date-time" }),
    events: z.number().int(),
    users: z.number().int(),
    priority: z.enum(["low", "medium", "high", "critical"]),
    status: z.enum(["open", "resolved", "muted"]),
    assigneeUserId: z.union([z.string(), z.null()]),
    resolvedAt: z.union([z.string(), z.null()]).meta({ format: "date-time" }),
    resolvedInRelease: z.union([z.string(), z.null()]),
  })
  .strict();

const errorTrackingIssueDetail = errorTrackingIssueSummary
  .omit({ firstSeen: true })
  .safeExtend({
    firstSeen: z.string().meta({ format: "date-time" }),
    lastRelease: z.string(),
    firstRelease: z.string(),
    comments: z.array(
      z
        .object({
          userId: z.string(),
          userName: z.string(),
          body: z.string(),
          date: z.string().meta({ format: "date-time" }),
        })
        .strict(),
    ),
  });

const errorTrackingIssueDimensions = z
  .object({
    environments: z.array(
      z.object({ name: z.string(), count: z.number().int() }).strict(),
    ),
    releases: z.array(
      z.object({ name: z.string(), count: z.number().int() }).strict(),
    ),
  })
  .strict();

export const listErrorTrackingIssuesValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      clientKey: z
        .string()
        .describe("SDK connection key for the app that emitted the errors"),
      q: z
        .string()
        .describe("Optional search over issue title/fingerprint")
        .optional(),
      ...paginationQueryFields,
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({ issues: z.array(errorTrackingIssueSummary) }),
    apiPaginationFieldsValidator,
  ),
  summary: "List error tracking issues",
  description:
    "Lists issues (grouped by fingerprint) for an SDK connection, most recently seen first.",
  operationId: "listErrorTrackingIssues",
  tags: ["error-tracking"],
  method: "get" as const,
  path: "/error-tracking/issues",
  exampleRequest: {
    query: {
      clientKey: "sdk-abc123",
      limit: 10,
    },
  },
};

export const getErrorTrackingIssueValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      clientKey: z
        .string()
        .describe("SDK connection key for the app that emitted the error"),
    })
    .strict(),
  paramsSchema: z
    .object({
      fingerprint: z.string().describe("The issue's fingerprint"),
    })
    .strict(),
  responseSchema: z
    .object({
      issue: errorTrackingIssueDetail,
      dimensions: errorTrackingIssueDimensions,
    })
    .strict(),
  summary: "Get an error tracking issue's details",
  operationId: "getErrorTrackingIssue",
  tags: ["error-tracking"],
  method: "get" as const,
  path: "/error-tracking/issues/:fingerprint",
  exampleRequest: {
    params: { fingerprint: "a1b2c3d4" },
    query: { clientKey: "sdk-abc123" },
  },
};

const sourceMapSummary = z
  .object({
    minifiedUrl: z.string(),
    release: z.string(),
    dateUpdated: z.string().meta({ format: "date-time" }).optional(),
  })
  .strict();

export const postErrorTrackingSourceMapValidator = {
  bodySchema: z
    .object({
      clientKey: z
        .string()
        .describe("SDK connection key for the app that emitted the error"),
      release: z
        .string()
        .describe(
          "Release identifier that matches error events (for example a git SHA)",
        ),
      minifiedUrl: z
        .string()
        .describe("URL of the minified bundle that produced the stack frame"),
      sourceMapJson: z
        .string()
        .max(15_000_000)
        .describe("Source map JSON contents as a string"),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      uploaded: z.literal(true),
    })
    .strict(),
  summary: "Upload an error tracking source map",
  description:
    "Stores a source map for a minified bundle so GrowthBook can symbolicate error stack traces for a release.",
  operationId: "postErrorTrackingSourceMap",
  tags: ["error-tracking"],
  method: "post" as const,
  path: "/error-tracking/source-maps",
  exampleRequest: {
    body: {
      clientKey: "sdk-abc123",
      release: "a1b2c3d4",
      minifiedUrl: "https://app.example.com/_next/static/chunks/main-abc123.js",
      sourceMapJson: '{"version":3,"sources":["app.tsx"],"mappings":"AAAA"}',
    },
  },
};

export const listErrorTrackingSourceMapsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      clientKey: z
        .string()
        .describe("SDK connection key for the app that emitted the error"),
      release: z.string().describe("Optional release filter").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      maps: z.array(sourceMapSummary),
    })
    .strict(),
  summary: "List uploaded error tracking source maps",
  operationId: "listErrorTrackingSourceMaps",
  tags: ["error-tracking"],
  method: "get" as const,
  path: "/error-tracking/source-maps",
  exampleRequest: {
    query: {
      clientKey: "sdk-abc123",
      release: "a1b2c3d4",
    },
  },
};
