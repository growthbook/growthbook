import {
  Context,
  context as otelContext,
  createContextKey,
  ROOT_CONTEXT,
  Span,
  SpanOptions,
  trace,
  Tracer,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type { TelemetrySettings } from "ai";
import { AIPromptType } from "shared/ai";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getBuild } from "back-end/src/util/build";
import {
  INGESTOR_TRACES_CLIENT_KEY,
  INGESTOR_TRACES_ENDPOINT,
} from "back-end/src/util/secrets";

// Separate from the app's Datadog or OpenTelemetry tracing: never registered
// globally, and only the AI SDK is handed its tracer.
let provider: TracerProvider | null | undefined;
let tracer: Tracer | null = null;

function hasGlobalContextManager() {
  const key = createContextKey("growthbook-ingestor-traces-probe");
  return otelContext.with(ROOT_CONTEXT.setValue(key, true), () =>
    Boolean(otelContext.active().getValue(key)),
  );
}

const OWN_SPAN_KEY = createContextKey("growthbook-ingestor-traces-span");

// Our spans run inside request spans from Sentry, Datadog or OpenTelemetry,
// which never reach this exporter. Our parent is kept under its own context key
// so each AI call is its own trace, and the app's other instrumentation
// keeps parenting off the request span.
export class OwnParentTracer implements Tracer {
  constructor(private inner: Tracer) {}

  startSpan(name: string, options?: SpanOptions, ctx?: Context): Span {
    const active = ctx ?? otelContext.active();
    const parent = active.getValue(OWN_SPAN_KEY) as Span | undefined;
    return this.inner.startSpan(
      name,
      options,
      parent ? trace.setSpan(active, parent) : trace.deleteSpan(active),
    );
  }

  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    ctx: Context,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    ...args: [F] | [SpanOptions, F] | [SpanOptions, Context, F]
  ): ReturnType<F> {
    const fn = args[args.length - 1] as F;
    const options = args.length > 1 ? (args[0] as SpanOptions) : undefined;
    const ctx = args.length > 2 ? (args[1] as Context) : otelContext.active();
    const span = this.startSpan(name, options, ctx);
    return otelContext.with(
      ctx.setValue(OWN_SPAN_KEY, span),
      () => fn(span) as ReturnType<F>,
    );
  }
}

function getTracer(): Tracer | null {
  if (provider !== undefined) return tracer;
  if (!INGESTOR_TRACES_ENDPOINT || !INGESTOR_TRACES_CLIENT_KEY) {
    provider = null;
    return tracer;
  }
  // The AI SDK nests its spans through the global context.
  if (!hasGlobalContextManager()) {
    otelContext.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
  }
  const { sha } = getBuild();
  provider = new TracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "growthbook",
      ...(sha ? { [ATTR_SERVICE_VERSION]: sha } : {}),
    }),
    // Not parent-based: a request's Sentry or Datadog sampling doesn't apply.
    sampler: new AlwaysOnSampler(),
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({
          url: INGESTOR_TRACES_ENDPOINT,
          headers: { Authorization: `Bearer ${INGESTOR_TRACES_CLIENT_KEY}` },
        }),
      }),
    ],
  });
  tracer = new OwnParentTracer(provider.getTracer("growthbook"));
  return tracer;
}

export function getAITelemetry(
  context: ReqContext | ApiReqContext,
  type: AIPromptType,
): { experimental_telemetry?: TelemetrySettings } {
  const tracer = getTracer();
  if (!tracer) return {};
  return {
    experimental_telemetry: {
      isEnabled: true,
      tracer,
      functionId: type,
      metadata: {
        organization: context.org.id,
        ...(context.userId ? { userId: context.userId } : {}),
      },
    },
  };
}

export async function shutdownIngestorTraces() {
  await provider?.shutdown();
}
