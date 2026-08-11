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

const dimensionBreakdown = z.array(
  z.object({ name: z.string(), count: z.number().int() }).strict(),
);

const errorTrackingIssueDimensions = z
  .object({
    environments: dimensionBreakdown,
    releases: dimensionBreakdown,
    errorTypes: dimensionBreakdown.describe(
      "Distinct error_type values within this issue. More than one is a sign that events which should have grouped together didn't — the fingerprint hash includes errorType.",
    ),
    transactions: dimensionBreakdown,
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

const errorTrackingEventSummary = z
  .object({
    eventId: z.string(),
    timestamp: z.string().meta({ format: "date-time" }),
    title: z.string(),
    errorType: z.string(),
    transaction: z.string(),
    release: z.string(),
    environment: z.string(),
    user: z.string(),
    device: z.string(),
    os: z.string(),
    url: z.string(),
    runtime: z.string(),
  })
  .strict();

export const listErrorTrackingIssueEventsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      clientKey: z
        .string()
        .describe("SDK connection key for the app that emitted the error"),
      q: z
        .string()
        .describe("Optional search over event title/event id")
        .optional(),
      fromMs: z.coerce
        .number()
        .int()
        .describe("Only events at or after this unix ms timestamp")
        .optional(),
      toMs: z.coerce
        .number()
        .int()
        .describe("Only events before this unix ms timestamp")
        .optional(),
      order: z.enum(["asc", "desc"]).optional().meta({ default: "desc" }),
      ...paginationQueryFields,
    })
    .strict(),
  paramsSchema: z
    .object({
      fingerprint: z.string().describe("The issue's fingerprint"),
    })
    .strict(),
  responseSchema: z.intersection(
    z.object({ events: z.array(errorTrackingEventSummary) }),
    apiPaginationFieldsValidator,
  ),
  summary: "List an error tracking issue's individual events",
  description:
    "Lists the individual events within one issue, most recent first by default. Each event carries its own errorType/transaction/release — useful for spotting why events that look alike ended up as separate issues (the fingerprint hash includes errorType, so a mismatch there is a common cause).",
  operationId: "listErrorTrackingIssueEvents",
  tags: ["error-tracking"],
  method: "get" as const,
  path: "/error-tracking/issues/:fingerprint/events",
  exampleRequest: {
    params: { fingerprint: "a1b2c3d4" },
    query: { clientKey: "sdk-abc123", limit: 10 },
  },
};

const symbolicatedStackFrame = z
  .object({
    function: z.string().optional(),
    minified: z
      .object({
        filename: z.string().optional(),
        line: z.number().int().optional(),
        column: z.number().int().optional(),
      })
      .strict()
      .optional(),
    original: z
      .object({
        filename: z.string().optional(),
        line: z.number().int().optional(),
        column: z.number().int().optional(),
      })
      .strict()
      .optional(),
    resolved: z.boolean(),
    context: z
      .object({
        line: z.number().int(),
        content: z.string(),
        lines: z.array(
          z
            .object({
              number: z.number().int(),
              content: z.string(),
              highlight: z.boolean(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();

const errorTrackingEventDetail = z
  .object({
    event_uuid: z.string(),
    timestamp: z.string().meta({ format: "date-time" }),
    title: z.string(),
    issue_fingerprint: z.string(),
    properties: z
      .record(z.string(), z.unknown())
      .describe(
        "Raw event properties as sent by the SDK: message, stack, stackFrames, tags, contexts, breadcrumbs, etc.",
      ),
    attributes: z.record(z.string(), z.unknown()),
    environment: z.string(),
    release_version: z.string(),
    user_id: z.string(),
    device_id: z.string(),
    url: z.string(),
    transaction_name: z.string(),
    error_type: z.string(),
    runtime_name: z.string(),
    ua_device_type: z.string(),
    ua_os: z.string(),
    ua_browser: z.string(),
    sdk_version: z.string(),
    sdk_language: z.string(),
    relatedFeatureUsage: z.array(z.record(z.string(), z.unknown())),
    relatedExperimentViews: z.array(z.record(z.string(), z.unknown())),
    urlAtCapture: z.string(),
    symbolicatedStack: z
      .union([
        z
          .object({
            frames: z.array(symbolicatedStackFrame),
            text: z.string(),
            resolvedFrameCount: z.number().int(),
          })
          .strict(),
        z.null(),
      ])
      .describe(
        "Null when the event has no stack frames to symbolicate. resolvedFrameCount is 0 when frames exist but no matching source map was uploaded for the release.",
      ),
  })
  .strict();

export const getErrorTrackingEventValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      clientKey: z
        .string()
        .describe("SDK connection key for the app that emitted the error"),
      fingerprint: z
        .string()
        .describe("Restrict the lookup to this issue")
        .optional(),
      eventSearch: z
        .string()
        .describe("Look up by event id instead of the eventUuid path param")
        .optional(),
    })
    .strict(),
  paramsSchema: z
    .object({
      eventUuid: z.string().describe("The event's id"),
    })
    .strict(),
  responseSchema: z
    .object({
      event: errorTrackingEventDetail,
    })
    .strict(),
  summary: "Get one error tracking event's full details",
  description:
    "Returns the raw properties (message, stack, tags, contexts), attributes, related feature usage/experiment views, and symbolicated stack trace for a single event.",
  operationId: "getErrorTrackingEvent",
  tags: ["error-tracking"],
  method: "get" as const,
  path: "/error-tracking/events/:eventUuid",
  exampleRequest: {
    params: { eventUuid: "evt_abc123" },
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
