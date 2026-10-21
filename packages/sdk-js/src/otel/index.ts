import { AsyncLocalStorage } from "async_hooks";

// Structural stand-ins for OpenTelemetry's Span and SpanProcessor, so this
// works with any @opentelemetry/sdk-trace version without depending on it.
export interface TracingSpan {
  setAttribute(key: string, value: string | string[]): unknown;
}

export interface TracingSpanProcessor {
  onStart(span: TracingSpan, parentContext?: unknown): void;
  onEnd(span: unknown): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export type TracingContextOptions = {
  // Must match the identifier your product events use, so GrowthBook can join
  // AI spans to the rest of a user's data.
  userId?: string;
  conversationId?: string;
};

export const TRACING_ATTRIBUTES = {
  userId: "user.id",
  // Not `gen_ai.conversation.id`: every span in the context gets it, including
  // HTTP and DB spans, and a `gen_ai.*` key makes those look like AI spans.
  // `session.id` is also what Phoenix and Langfuse read.
  conversationId: "session.id",
} as const;

const storage = new AsyncLocalStorage<TracingContextOptions>();

// Register once on your tracer provider. Spans started inside
// `withTracingContext` get the user id and conversation id, including spans
// created by AI frameworks you don't control.
export function tracingSpanProcessor(): TracingSpanProcessor {
  return {
    onStart(span) {
      const store = storage.getStore();
      if (!store) return;
      if (store.userId) {
        span.setAttribute(TRACING_ATTRIBUTES.userId, store.userId);
      }
      if (store.conversationId) {
        span.setAttribute(
          TRACING_ATTRIBUTES.conversationId,
          store.conversationId,
        );
      }
    },
    onEnd: () => {},
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

// Runs `fn` with tracing context. Nested calls inherit anything they don't set.
export function withTracingContext<T>(
  options: TracingContextOptions,
  fn: () => T,
): T {
  const parent = storage.getStore();
  return storage.run(
    {
      userId: options.userId ?? parent?.userId,
      conversationId: options.conversationId ?? parent?.conversationId,
    },
    fn,
  );
}

// Regions match the hosts `growthbookTrackingPlugin` sends events to.
export type GrowthBookIngestRegion = "us-east-1" | "eu-west-1";

const INGEST_HOSTS: Record<GrowthBookIngestRegion, string> = {
  "us-east-1": "https://us-east-1.gb-ingest.com",
  "eu-west-1": "https://eu-west-1.gb-ingest.com",
};

export type GrowthBookOtlpExporterOptions = {
  // A secret API key with the `traceIngest` role (`secret_traceIngest_...`).
  secretKey: string;
  // Your GrowthBook Cloud data region. Defaults to "us-east-1".
  region?: GrowthBookIngestRegion;
  // Overrides the region's host, e.g. for self-hosting or local development
  // ("http://localhost:3003"). `/v1/traces` is appended.
  ingestorHost?: string;
};

export type GrowthBookOtlpExporterConfig = {
  url: string;
  headers: Record<string, string>;
};

/**
 * Config for an OTLP/HTTP trace exporter that sends spans to GrowthBook.
 * Pass the result to `OTLPTraceExporter` from
 * `@opentelemetry/exporter-trace-otlp-http` or `-proto`.
 *
 * @example
 * ```ts
 * import { NodeSDK } from "@opentelemetry/sdk-node";
 * import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
 * import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
 * import { OpenAIInstrumentation } from "@opentelemetry/instrumentation-openai";
 * import {
 *   growthbookOtlpExporterConfig,
 *   tracingSpanProcessor,
 * } from "@growthbook/growthbook/otel";
 *
 * const exporter = new OTLPTraceExporter(
 *   growthbookOtlpExporterConfig({
 *     secretKey: process.env.GROWTHBOOK_TRACE_KEY!,
 *     region: "us-east-1",
 *   }),
 * );
 *
 * new NodeSDK({
 *   spanProcessors: [tracingSpanProcessor(), new BatchSpanProcessor(exporter)],
 *   // Most GenAI instrumentations record prompts and completions only when
 *   // you opt in, e.g. OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
 *   // or the instrumentation's own `captureMessageContent` / `traceContent`
 *   // option. Without it, spans carry usage and timing but no content.
 *   instrumentations: [new OpenAIInstrumentation()],
 * }).start();
 * ```
 */
export function growthbookOtlpExporterConfig({
  secretKey,
  region = "us-east-1",
  ingestorHost,
}: GrowthBookOtlpExporterOptions): GrowthBookOtlpExporterConfig {
  if (!secretKey) {
    throw new Error("growthbookOtlpExporterConfig: secretKey is required");
  }
  const host = ingestorHost || INGEST_HOSTS[region];
  if (!host) {
    throw new Error(
      `growthbookOtlpExporterConfig: unknown region "${region}". ` +
        `Use one of ${Object.keys(INGEST_HOSTS).join(", ")}, or pass ingestorHost.`,
    );
  }
  return {
    url: `${host.replace(/\/+$/, "")}/v1/traces`,
    headers: { Authorization: `Bearer ${secretKey}` },
  };
}
