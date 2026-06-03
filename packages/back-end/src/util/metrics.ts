import { AsyncLocalStorage } from "async_hooks";
import { logger } from "./logger";
import { EXPERIMENT_UPDATE_TRACE_SAMPLE_RATE } from "./secrets";

export type MetricAttributes = Record<string, string | number>;
export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Record<string, SpanAttributeValue>;
export type TraceContext = unknown;
export type ExperimentUpdateTraceTrigger =
  | "manual"
  | "schedule"
  | "dashboard"
  | "demo";

export type Counter = {
  increment: (attributes?: MetricAttributes) => void;
  decrement: (attributes?: MetricAttributes) => void;
};

export type Histogram = {
  record: (value: number, attributes?: MetricAttributes) => void;
};

export type Gauge = {
  record: (value: number, attributes?: MetricAttributes) => void;
};

export type HistogramOptions = {
  unit?: string;
};

type Metrics = {
  getCounter: (_: string) => Counter;
  getHistogram: (_: string, opts?: HistogramOptions) => Histogram;
  getGauge: (_: string) => Gauge;
};

export type Span = {
  setAttribute: (key: string, value: SpanAttributeValue) => void;
  setAttributes: (attrs: SpanAttributes) => void;
  recordException: (err: unknown) => void;
  setStatus: (status: "ok" | "error", message?: string) => void;
  end: () => void;
  isEnded: () => boolean;
  claimAsyncCompletion: () => void;
  isAsyncCompletionClaimed: () => boolean;
};

export type StartSpanOptions = {
  // Start a brand-new trace root, ignoring any ambient parent span, and add a
  // link back to that ambient span (if any). Used for background work that
  // outlives the request which triggered it: modeling it as a child of the
  // short-lived request span produces a child that outlives its parent, which
  // breaks duration aggregation and caps flamegraphs at the request's duration.
  // A linked new root keeps the work's own span as the trace root while still
  // recording the causal hop from the triggering request.
  newRoot?: boolean;
};

export type Tracer = {
  startActiveSpan: <T>(
    name: string,
    attributes: SpanAttributes | undefined,
    fn: (span: Span) => T,
    options?: StartSpanOptions,
  ) => T;
  getActiveSpan: () => Span;
  captureContext: () => TraceContext;
  withContext: <T>(context: TraceContext, fn: () => T) => T;
};

export const metrics: Metrics = {
  getCounter: (_: string) => ({
    increment: () => undefined,
    decrement: () => undefined,
  }),
  getHistogram: (_: string) => ({
    record: () => undefined,
  }),
  getGauge: (_: string) => ({
    record: () => undefined,
  }),
};

export const setMetrics = (newMetrics: Metrics) => {
  (Object.keys(metrics) as (keyof Metrics)[]).forEach(
    <K extends keyof Metrics>(k: K) => (metrics[k] = newMetrics[k]),
  );
};

// A span that does nothing. Used as the fallback whenever no real span exists:
// outside a sampled trace, or when a tracing backend hands back no span.
export const noopSpan: Span = {
  setAttribute: () => undefined,
  setAttributes: () => undefined,
  recordException: () => undefined,
  setStatus: () => undefined,
  end: () => undefined,
  isEnded: () => true,
  claimAsyncCompletion: () => undefined,
  isAsyncCompletionClaimed: () => false,
};

const tracer: Tracer = {
  startActiveSpan: (_name, _attributes, fn) => fn(noopSpan),
  getActiveSpan: () => noopSpan,
  captureContext: () => null,
  withContext: (_context, fn) => fn(),
};

export const setTracer = (newTracer: Tracer) => {
  (Object.keys(tracer) as (keyof Tracer)[]).forEach(
    <K extends keyof Tracer>(k: K) => (tracer[k] = newTracer[k]),
  );
};

// Name of the root span wrapping a full experiment results refresh. Created by
// experiment-update entry points. Child phases read it from ambient trace
// context, so callers do not need to pass a span through the update pipeline.
const EXPERIMENT_UPDATE_SPAN_NAME = "experiment.update";

type ExperimentUpdateTraceState = {
  rootSpan: Span;
  rootContext: TraceContext;
};

const experimentUpdateTraceStorage =
  new AsyncLocalStorage<ExperimentUpdateTraceState>();

// A handle to an in-flight experiment-update trace whose work completes
// asynchronously, after the request that opened the trace has already returned.
// The component that owns that async work (a QueryRunner) claims the trace on
// construction and later calls finish(); in between it re-enters the trace
// context and opens child spans without ever touching Span/TraceContext itself.
// Outside a sampled trace this is a no-op handle, so callers never branch on
// whether tracing is active.
export type AsyncTraceHandle = {
  // Re-enter the captured trace context for an async continuation so spans
  // created inside it attach to the trace instead of starting a detached one.
  runInContext: <T>(fn: () => T) => T;
  // Open a child span around an async operation within the captured context.
  startSpan: <T>(
    name: string,
    attrs: SpanAttributes,
    fn: (span: Span) => Promise<T> | T,
  ) => Promise<T>;
  // Finalize the trace's root span with final attributes. Idempotent.
  finish: (
    status: "ok" | "error",
    attrs?: SpanAttributes,
    err?: unknown,
  ) => void;
};

const noopAsyncTraceHandle: AsyncTraceHandle = {
  runInContext: (fn) => fn(),
  startSpan: (_name, _attrs, fn) => Promise.resolve(fn(noopSpan)),
  finish: () => undefined,
};

// Claims the ambient experiment-update trace (if one is being sampled) so its
// root span stays open past the synchronous request that created it, and hands
// back a handle the async owner uses to attach child spans and eventually
// finish the trace. Returns a no-op handle when no trace is active.
export const claimExperimentUpdateTraceForAsyncCompletion =
  (): AsyncTraceHandle => {
    const state = experimentUpdateTraceStorage.getStore();
    if (!state) return noopAsyncTraceHandle;

    const { rootSpan, rootContext } = state;
    rootSpan.claimAsyncCompletion();

    return {
      runInContext: (fn) => withCapturedContext(rootContext, fn),
      startSpan: (name, attrs, fn) =>
        withCapturedSpan(rootContext, name, attrs, fn),
      finish: (status, attrs, err) => {
        if (rootSpan.isEnded()) return;
        if (attrs) rootSpan.setAttributes(attrs);
        endSpanWithStatus(rootSpan, status, err);
      },
    };
  };

// Head-sampling decision for a single experiment-update operation. We sample in
// application code rather than in the tracing backends so the same logic applies
// to both OTel and Datadog. When dropped, we never create the dedicated
// `experiment.update` root span, and all async query/continuation spans are
// suppressed too (the AsyncTraceHandle is a no-op without an active trace).
// Note: synchronous phases still attach child spans to whatever trace is already
// active — e.g. an auto-instrumented HTTP server span on a request-triggered
// refresh (see shouldCreateAmbientSpan). Sampled per refresh at
// EXPERIMENT_UPDATE_TRACE_SAMPLE_RATE (default 0 = no traces).
export const shouldSampleExperimentUpdateTrace = (): boolean =>
  EXPERIMENT_UPDATE_TRACE_SAMPLE_RATE > 0 &&
  Math.random() < EXPERIMENT_UPDATE_TRACE_SAMPLE_RATE;

export const withExperimentUpdateTrace = async <T>({
  trigger,
  experimentId,
  orgId,
  run,
}: {
  trigger: ExperimentUpdateTraceTrigger;
  experimentId: string;
  orgId: string;
  run: () => Promise<T>;
}): Promise<T> => {
  if (!shouldSampleExperimentUpdateTrace()) {
    return run();
  }

  return tracer.startActiveSpan(
    EXPERIMENT_UPDATE_SPAN_NAME,
    {
      trigger,
      "experiment.id": experimentId,
      "org.id": orgId,
    },
    // Most refreshes are triggered by a short-lived HTTP request whose
    // auto-instrumented server span ends as soon as the queries are kicked off
    // (~hundreds of ms), while the actual query work this span tracks completes
    // asynchronously much later. Rooting here (linked back to the request)
    // keeps experiment.update as the trace root so its full async duration is
    // represented instead of being clamped to the request span's lifetime.
    async (rootSpan) => {
      const rootContext = tracer.captureContext();

      return experimentUpdateTraceStorage.run(
        { rootSpan, rootContext },
        async () => {
          try {
            const result = await run();
            if (!rootSpan.isAsyncCompletionClaimed()) {
              rootSpan.setStatus("ok");
              rootSpan.end();
            }
            return result;
          } catch (err) {
            if (!rootSpan.isEnded()) {
              rootSpan.recordException(err);
              rootSpan.setStatus(
                "error",
                err instanceof Error ? err.message : String(err),
              );
              rootSpan.end();
            }
            throw err;
          }
        },
      );
    },
    { newRoot: true },
  );
};

const endSpanWithStatus = (
  span: Span,
  status: "ok" | "error",
  err?: unknown,
): void => {
  if (span.isEnded()) return;

  if (status === "error" && err) {
    span.recordException(err);
    span.setStatus("error", err instanceof Error ? err.message : String(err));
  } else {
    span.setStatus(status);
  }
  span.end();
};

// A phase gets a real span when either a sampled experiment-update trace is in
// scope (its root is in ALS) or some other span is already active — most
// commonly the auto-instrumented HTTP server span on a request-triggered
// refresh. The latter means an unsampled, request-triggered refresh still emits
// child spans on the request's own trace; it just doesn't get the dedicated
// `experiment.update` root or any of the async query spans. Phase-duration
// metrics are emitted unconditionally regardless of this decision.
const shouldCreateAmbientSpan = (): boolean =>
  experimentUpdateTraceStorage.getStore() !== undefined ||
  tracer.getActiveSpan() !== noopSpan;

const withSpan = async <T>(
  phase: string,
  attrs: SpanAttributes,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> => {
  const start = Date.now();
  const logAttrs = toLogAttrs(attrs);
  logger.debug({ phase, ...logAttrs }, `phase.start ${phase}`);

  // Generic query-runner phases (run for every runner) report under the neutral
  // `query_runner.*` namespace; experiment-update pipeline phases report under
  // `experiment.update.*`. The specific phase is always on the `phase` tag.
  const phaseDurationMetric = phase.startsWith("query_runner.")
    ? "query_runner.phase.duration"
    : "experiment.update.phase.duration";

  const recordDuration = (status: "ok" | "error", duration_ms: number) =>
    metrics
      .getHistogram(phaseDurationMetric, { unit: "ms" })
      .record(duration_ms, { phase, status, ...toMetricAttrs(attrs) });

  const run = async (span: Span) => {
    try {
      const result = await fn(span);
      const duration_ms = Date.now() - start;
      span.setStatus("ok");
      recordDuration("ok", duration_ms);
      logger.debug({ phase, duration_ms, ...logAttrs }, `phase.end ${phase}`);
      return result;
    } catch (err) {
      const duration_ms = Date.now() - start;
      span.recordException(err);
      span.setStatus("error", err instanceof Error ? err.message : String(err));
      recordDuration("error", duration_ms);
      logger.error(
        { phase, duration_ms, err, ...logAttrs },
        `phase.error ${phase}`,
      );
      throw err;
    } finally {
      span.end();
    }
  };

  if (!shouldCreateAmbientSpan()) {
    return run(noopSpan);
  }

  return tracer.startActiveSpan(phase, attrs, run);
};

const withCapturedContext = <T>(
  context: TraceContext | null,
  fn: () => T,
): T => {
  if (!context) {
    return fn();
  }

  return tracer.withContext(context, fn);
};

const withCapturedSpan = async <T>(
  context: TraceContext | null,
  phase: string,
  attrs: SpanAttributes,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> => {
  if (!context) {
    return fn(noopSpan);
  }

  return withCapturedContext(context, () =>
    tracer.startActiveSpan(phase, attrs, async (span) => {
      try {
        const result = await fn(span);
        span.setStatus("ok");
        return result;
      } catch (err) {
        span.recordException(err);
        span.setStatus(
          "error",
          err instanceof Error ? err.message : String(err),
        );
        throw err;
      } finally {
        span.end();
      }
    }),
  );
};

export const instrumentPhase = withSpan;

const HIGH_CARDINALITY_KEYS = new Set(["query.name", "query_runner.error"]);

// Metric tags must stay low-cardinality. We drop entity ids (`*.id`), explicitly
// named high-cardinality keys, and count-style keys (`*.count` / `*_count`)
// whose numeric values are effectively unbounded as a tag dimension and would
// explode custom-metric cardinality. These attributes still live on the span
// (which tolerates high cardinality); they just never become metric tags.
const isHighCardinalityMetricKey = (key: string): boolean =>
  key.endsWith(".id") ||
  key.endsWith(".count") ||
  key.endsWith("_count") ||
  HIGH_CARDINALITY_KEYS.has(key);

export const toMetricAttrs = (attrs: SpanAttributes = {}): MetricAttributes => {
  return Object.fromEntries(
    Object.entries(attrs)
      .filter(([key]) => !isHighCardinalityMetricKey(key))
      .map(([key, value]) => [
        key,
        typeof value === "boolean" ? String(value) : value,
      ]),
  );
};

export const toLogAttrs = (attrs: SpanAttributes = {}): SpanAttributes => {
  return Object.fromEntries(
    Object.entries(attrs).map(([key, value]) => [
      key.replace(/\./g, "_"),
      value,
    ]),
  );
};
