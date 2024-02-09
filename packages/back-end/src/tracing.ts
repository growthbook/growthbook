import process from "process";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import * as opentelemetry from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: "adnans-growthbook",
});

const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter(),
  exportIntervalMillis: 1000,
});

const sdk = new opentelemetry.NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  metricReader,
  resource,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// gracefully shut down the SDK on process exit
process.on("SIGTERM", () => {
  sdk
    .shutdown()
    // eslint-disable-next-line no-console
    .then(() => console.log("Tracing terminated"))
    // eslint-disable-next-line no-console
    .catch((error) => console.log("Error terminating tracing", error))
    .finally(() => process.exit(0));
});
