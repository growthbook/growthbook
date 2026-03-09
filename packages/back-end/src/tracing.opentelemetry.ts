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
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import {
  diag,
  metrics as otlMetrics,
  DiagConsoleLogger,
} from "@opentelemetry/api";
import {
  getNodeAutoInstrumentations,
  getResourceDetectors,
} from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import {
  PeriodicExportingMetricReader,
  MetricReader,
  View,
  ExplicitBucketHistogramAggregation,
} from "@opentelemetry/sdk-metrics";
import { getBuild } from "./util/build";
import { setMetrics, Attributes } from "./util/metrics";

diag.setLogger(
  new DiagConsoleLogger(),
  opentelemetry.core.getEnv().OTEL_LOG_LEVEL,
);

// This file is preloaded before the rest of the app via `--require`, so we read
// process.env directly rather than importing from util/secrets to avoid
// initializing modules before auto-instrumentation is set up.
const prometheusExporterEnabled = !!process.env.PROMETHEUS_EXPORTER_ENABLED;
const prometheusExporterPort = parseInt(
  process.env.PROMETHEUS_EXPORTER_PORT || "9464",
  10,
);

const metricReader: MetricReader = prometheusExporterEnabled
  ? new PrometheusExporter({
      port: prometheusExporterPort,
    })
  : new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    });

// Align HTTP request-duration histogram buckets with SLO boundaries so
// Prometheus histogram_quantile queries give useful p95/p99 estimates.
const httpDurationBuckets = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

const sdk = new opentelemetry.NodeSDK({
  instrumentations: [
    ...getNodeAutoInstrumentations(),
    new RuntimeNodeInstrumentation(),
    ...(process.env.GROWTHBOOK_OTEL_ENABLE_LOGS_COLLECTION
      ? [new PinoInstrumentation()]
      : []),
  ],
  resourceDetectors: getResourceDetectors(),
  logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter()),
  metricReader,
  views: [
    new View({
      instrumentName: "http.server.request.duration",
      aggregation: new ExplicitBucketHistogramAggregation(httpDurationBuckets),
    }),
  ],
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
    increment: (attributes?: Attributes) => counter.add(1, attributes),
    decrement: (attributes?: Attributes) => counter.add(-1, attributes),
  };
};

const getGauge = (name: string) => {
  const gauge = otlMetrics.getMeter(name).createObservableGauge(name);

  return {
    record: (value: number, attributes?: Attributes) => {
      gauge.addCallback((observableResult) => {
        observableResult.observe(value, attributes);
      });
    },
  };
};

setMetrics({
  getCounter,
  getHistogram: (name: string) =>
    otlMetrics.getMeter(name).createHistogram(name),
  getGauge,
});
