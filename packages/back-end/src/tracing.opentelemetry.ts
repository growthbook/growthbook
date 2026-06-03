/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import "./init/aliases";
import * as opentelemetry from "@opentelemetry/sdk-node";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import {
  diag,
  metrics as otlMetrics,
  DiagConsoleLogger,
  context as otelContext,
  trace,
  SpanStatusCode,
} from "@opentelemetry/api";
import type { Context, Span as OtelSpan } from "@opentelemetry/api";
import {
  getNodeAutoInstrumentations,
  getResourceDetectors,
} from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { getBuild } from "./util/build";
import {
  setMetrics,
  MetricAttributes,
  HistogramOptions,
  noopSpan,
  setTracer,
  Span,
  SpanAttributes,
  SpanAttributeValue,
} from "./util/metrics";

diag.setLogger(
  new DiagConsoleLogger(),
  opentelemetry.core.getEnv().OTEL_LOG_LEVEL,
);

const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter(),
});

// Experiment-update traces are head-sampled in application code: the dedicated
// `experiment.update` root span (and its async query spans) is only created for
// a sampled refresh. So no backend sampler is installed here — the SDK default
// (and any OTEL_TRACES_SAMPLER configuration) governs everything else as before,
// including the auto-instrumented request spans that unsampled refreshes may
// still attach synchronous phase spans to.
const sdk = new opentelemetry.NodeSDK({
  instrumentations: [
    ...getNodeAutoInstrumentations(),
    ...(process.env.GROWTHBOOK_OTEL_ENABLE_LOGS_COLLECTION
      ? [new PinoInstrumentation()]
      : []),
  ],
  resourceDetectors: getResourceDetectors(),
  logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter()),
  metricReader,
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "growthbook",
    [SemanticResourceAttributes.SERVICE_NAMESPACE]: "backend",
    [SemanticResourceAttributes.SERVICE_VERSION]: getBuild().sha,
  }),
});

try {
  sdk.start();
  diag.info("OpenTelemetry automatic instrumentation started successfully");
} catch (error) {
  diag.error(
    "Error initializing OpenTelemetry SDK. Your application is not instrumented and will not produce telemetry",
    error,
  );
}

process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => diag.debug("OpenTelemetry SDK terminated"))
    .catch((error) => diag.error("Error terminating OpenTelemetry SDK", error));
});

const getCounter = (name: string) => {
  const counter = otlMetrics.getMeter(name).createUpDownCounter(name);

  return {
    increment: (attributes?: MetricAttributes) => counter.add(1, attributes),
    decrement: (attributes?: MetricAttributes) => counter.add(-1, attributes),
  };
};

const getGauge = (name: string) => {
  const gauge = otlMetrics.getMeter(name).createObservableGauge(name);
  let latest: { value: number; attributes?: MetricAttributes } | null = null;

  gauge.addCallback((observableResult) => {
    if (latest) {
      observableResult.observe(latest.value, latest.attributes);
    }
  });

  return {
    record: (value: number, attributes?: MetricAttributes) => {
      latest = { value, attributes };
    },
  };
};

setMetrics({
  getCounter,
  getHistogram: (name: string, opts?: HistogramOptions) =>
    otlMetrics.getMeter(name).createHistogram(name, opts),
  getGauge,
});

const otelTracer = trace.getTracer("growthbook-backend");

const wrapSpan = (span: OtelSpan): Span => {
  // Once a span has ended, ownership is final: ignore any further mutation so
  // an abandoned runner racing with the caller's error handling cannot re-tag,
  // re-status, or double-end the span.
  let ended = false;
  let asyncCompletionClaimed = false;

  return {
    setAttribute: (key: string, value: SpanAttributeValue) => {
      if (ended) return;
      span.setAttribute(key, value);
    },
    setAttributes: (attrs: SpanAttributes) => {
      if (ended) return;
      span.setAttributes(attrs);
    },
    recordException: (err: unknown) => {
      if (ended) return;
      span.recordException(err instanceof Error ? err : String(err));
    },
    setStatus: (status: "ok" | "error", message?: string) => {
      if (ended) return;
      span.setStatus({
        code: status === "ok" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        message,
      });
    },
    end: () => {
      if (ended) return;
      ended = true;
      span.end();
    },
    isEnded: () => ended,
    claimAsyncCompletion: () => {
      asyncCompletionClaimed = true;
    },
    isAsyncCompletionClaimed: () => asyncCompletionClaimed,
  };
};

setTracer({
  startActiveSpan: (name, attributes, fn, options) => {
    // For a new root, detach from the ambient parent (so this opens its own
    // trace) but link back to it to preserve the causal hop from the trigger.
    const parentSpanContext = options?.newRoot
      ? trace.getSpanContext(otelContext.active())
      : undefined;

    return otelTracer.startActiveSpan(
      name,
      {
        attributes,
        ...(options?.newRoot
          ? {
              root: true,
              ...(parentSpanContext
                ? { links: [{ context: parentSpanContext }] }
                : {}),
            }
          : {}),
      },
      (span) => fn(wrapSpan(span)),
    );
  },
  getActiveSpan: () => {
    const span = trace.getSpan(otelContext.active());
    return span ? wrapSpan(span) : noopSpan;
  },
  captureContext: () => otelContext.active(),
  withContext: (context, fn) => otelContext.with(context as Context, fn),
});
