import type { SnapshotMetric } from "shared/types/experiment-snapshot";

type RelativeEffectTelemetry = {
  relativeEffect?: number;
  relativeEffectStandardError?: number;
};

export function getRelativeEffectTelemetry(
  metric?: Pick<SnapshotMetric, "expected" | "uplift">,
): RelativeEffectTelemetry {
  if (typeof metric?.expected !== "number") return {};

  const telemetry: RelativeEffectTelemetry = {
    relativeEffect: metric.expected,
  };

  // Legacy Bayesian lognormal stddev is on the log-ratio scale.
  if (
    metric.uplift?.dist === "normal" &&
    typeof metric.uplift.stddev === "number"
  ) {
    telemetry.relativeEffectStandardError = metric.uplift.stddev;
  }

  return telemetry;
}
