import { z } from "zod";

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
