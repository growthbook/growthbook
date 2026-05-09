import { useMemo } from "react";
import { RampScheduleInterface } from "shared/validators";
import { SafeRolloutSnapshotInterface } from "shared/types/safe-rollout";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
} from "shared/constants";
import { getSRMHealthData, getMultipleExposureHealthData } from "shared/health";
import { getMetricResultStatus } from "shared/experiments";
import { getSafeRolloutSnapshotAnalysis } from "shared/util";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import { useUser } from "@/services/UserContext";

export type RampHealthSignal =
  | "guardrail-failing"
  | "signal-regression"
  | "srm"
  | "multiple-exposures"
  | "no-traffic"
  | "healthy"
  | "awaiting-data";

function computeSignals(
  rampSchedule: RampScheduleInterface,
  snapshot: SafeRolloutSnapshotInterface | undefined,
  srmThreshold: number,
  meMinPercent: number,
): RampHealthSignal[] {
  const signals: RampHealthSignal[] = [];

  const isMonitored = rampSchedule.steps.some((s) => s.monitored);
  if (!isMonitored || !["running", "paused"].includes(rampSchedule.status)) {
    return signals;
  }

  const analysis = snapshot ? getSafeRolloutSnapshotAnalysis(snapshot) : null;
  const results = analysis?.results?.[0];

  const traffic = snapshot?.health?.traffic;
  const units = traffic?.overall?.variationUnits;
  const totalUsers = units?.reduce((a, b) => a + b, 0) ?? 0;
  const srmPValue = traffic?.overall?.srm;

  if (snapshot && totalUsers === 0) {
    signals.push("no-traffic");
    return signals;
  }

  if (!snapshot || !results) {
    signals.push("awaiting-data");
    return signals;
  }

  // SRM
  if (srmPValue !== undefined && totalUsers > 0) {
    const srmHealth = getSRMHealthData({
      srm: srmPValue,
      srmThreshold,
      numOfVariations: 2,
      totalUsersCount: totalUsers,
      minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    });
    if (srmHealth === "unhealthy") {
      signals.push("srm");
    }
  }

  // Multiple exposures
  const meHealth = getMultipleExposureHealthData({
    multipleExposuresCount: snapshot.multipleExposures ?? 0,
    totalUsersCount: totalUsers,
    minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
    minPercentThreshold: meMinPercent,
  });
  if (meHealth.status === "unhealthy") {
    signals.push("multiple-exposures");
  }

  // Guardrail regression
  const guardrailIds = rampSchedule.monitoringConfig?.guardrailMetricIds ?? [];
  const variationResults = results.variations?.[1];

  if (variationResults?.metrics) {
    for (const metricId of guardrailIds) {
      const metric = variationResults.metrics[metricId];
      if (!metric) continue;
      const status = getMetricResultStatus({
        metric,
        ciLower: metric.ci?.[0] ?? 0,
        ciUpper: metric.ci?.[1] ?? 0,
        pValueThreshold: 0.05,
        statsEngine: "frequentist",
        isGuardrail: true,
      });
      if (status.status === "lost") {
        signals.push("guardrail-failing");
        break;
      }
    }
  }

  // Signal metric regression
  const signalIds = rampSchedule.monitoringConfig?.signalMetricIds ?? [];
  if (variationResults?.metrics) {
    for (const metricId of signalIds) {
      if (guardrailIds.includes(metricId)) continue;
      const metric = variationResults.metrics[metricId];
      if (!metric) continue;
      const status = getMetricResultStatus({
        metric,
        ciLower: metric.ci?.[0] ?? 0,
        ciUpper: metric.ci?.[1] ?? 0,
        pValueThreshold: 0.05,
        statsEngine: "frequentist",
        isGuardrail: true,
      });
      if (status.status === "lost") {
        signals.push("signal-regression");
        break;
      }
    }
  }

  if (signals.length === 0) {
    signals.push("healthy");
  }

  return signals;
}

function signalToBadge(signal: RampHealthSignal): React.ReactNode {
  switch (signal) {
    case "guardrail-failing":
      return (
        <Badge
          color="red"
          variant="soft"
          label="Guardrail Failing"
          radius="full"
        />
      );
    case "signal-regression":
      return (
        <Badge
          color="orange"
          variant="soft"
          label="Signal Regressing"
          radius="full"
        />
      );
    case "srm":
      return <Badge color="amber" variant="soft" label="SRM" radius="full" />;
    case "multiple-exposures":
      return (
        <Badge
          color="amber"
          variant="soft"
          label="Multi-exposure"
          radius="full"
        />
      );
    case "no-traffic":
      return (
        <Badge color="amber" variant="soft" label="No Traffic" radius="full" />
      );
    default:
      return null;
  }
}

export function RampMonitoringBadges({
  rampSchedule,
}: {
  rampSchedule: RampScheduleInterface;
}) {
  const { snapshot } = useSafeRolloutSnapshot();
  const { settings } = useUser();
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;
  const meMinPercent =
    settings.multipleExposureMinPercent ?? DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD;

  const signals = useMemo(
    () => computeSignals(rampSchedule, snapshot, srmThreshold, meMinPercent),
    [rampSchedule, snapshot, srmThreshold, meMinPercent],
  );

  return (
    <>
      {signals.map((s, i) => (
        <span key={`${s}-${i}`}>{signalToBadge(s)}</span>
      ))}
    </>
  );
}

export function RampMonitoringCTAs({
  rampSchedule,
  onRollback,
}: {
  rampSchedule: RampScheduleInterface;
  onRollback: () => void;
}) {
  const { snapshot } = useSafeRolloutSnapshot();
  const { settings } = useUser();
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;
  const meMinPercent =
    settings.multipleExposureMinPercent ?? DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD;

  const signals = useMemo(
    () => computeSignals(rampSchedule, snapshot, srmThreshold, meMinPercent),
    [rampSchedule, snapshot, srmThreshold, meMinPercent],
  );

  const hasUrgent =
    signals.includes("guardrail-failing") ||
    signals.includes("srm") ||
    signals.includes("multiple-exposures") ||
    signals.includes("no-traffic");

  if (!hasUrgent || rampSchedule.status !== "running") return null;

  if (signals.includes("guardrail-failing")) {
    return (
      <Button size="xs" variant="solid" color="red" onClick={onRollback}>
        Roll Back
      </Button>
    );
  }

  if (
    signals.includes("srm") ||
    signals.includes("multiple-exposures") ||
    signals.includes("no-traffic")
  ) {
    return (
      <Button size="xs" variant="soft" color="amber" onClick={onRollback}>
        Investigate
      </Button>
    );
  }

  return null;
}
