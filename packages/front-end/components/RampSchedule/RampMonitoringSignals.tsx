import { useMemo } from "react";
import { RampScheduleInterface, SafeRolloutInterface } from "shared/validators";
import { SafeRolloutSnapshotInterface } from "shared/types/safe-rollout";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
} from "shared/constants";
import { getSRMHealthData, getMultipleExposureHealthData } from "shared/health";
import { expandMetricGroups } from "shared/experiments";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

export type RampHealthSignal =
  | "guardrail-failing"
  | "signal-regression"
  | "srm"
  | "multiple-exposures"
  | "no-traffic"
  | "below-min-sample"
  | "healthy"
  | "awaiting-data";

type SignalAction = "warn" | "hold" | "rollback";

type SignalResult = {
  signals: RampHealthSignal[];
  actions: Partial<Record<RampHealthSignal, SignalAction>>;
};

function computeSignals(
  rampSchedule: RampScheduleInterface,
  snapshot: SafeRolloutSnapshotInterface | undefined,
  safeRollout: SafeRolloutInterface | undefined,
  srmThreshold: number,
  meMinPercent: number,
  expandedGuardrailIds: string[],
  expandedSignalIds: string[],
): SignalResult {
  const signals: RampHealthSignal[] = [];
  const actions: Partial<Record<RampHealthSignal, SignalAction>> = {};
  const mc = rampSchedule.monitoringConfig;

  const isMonitored = rampSchedule.steps.some((s) => s.monitored);
  if (!isMonitored || !["running", "paused"].includes(rampSchedule.status)) {
    return { signals, actions };
  }

  const traffic = snapshot?.health?.traffic;
  const units = traffic?.overall?.variationUnits;
  const totalUsers = units?.reduce((a, b) => a + b, 0) ?? 0;
  const srmPValue = traffic?.overall?.srm;

  if (snapshot && totalUsers === 0) {
    signals.push("no-traffic");
    actions["no-traffic"] = (mc?.noTrafficAction as SignalAction) ?? "hold";
    return { signals, actions };
  }

  if (!snapshot || !safeRollout?.analysisSummary?.resultsStatus) {
    signals.push("awaiting-data");
    return { signals, actions };
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
      actions["srm"] = (mc?.srmAction as SignalAction) ?? "hold";
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
    actions["multiple-exposures"] = (mc?.multipleExposureAction as SignalAction) ?? "hold";
  }

  // Min sample size check — uses the current step's holdConditions
  const currentStep =
    rampSchedule.currentStepIndex >= 0
      ? rampSchedule.steps[rampSchedule.currentStepIndex]
      : undefined;
  const minSample = currentStep?.holdConditions?.minSampleSize;
  if (minSample && totalUsers < minSample) {
    signals.push("below-min-sample");
  }

  const resultsStatus = safeRollout.analysisSummary.resultsStatus;
  const guardrailSet = new Set(expandedGuardrailIds);
  const signalSet = new Set(
    expandedSignalIds.filter((id) => !guardrailSet.has(id)),
  );

  let hasGuardrailFailing = false;
  let hasSignalRegression = false;
  for (const variation of resultsStatus.variations) {
    if (!variation.guardrailMetrics) continue;
    for (const [metricId, gm] of Object.entries(variation.guardrailMetrics)) {
      if (gm.status !== "lost") continue;
      if (guardrailSet.has(metricId)) {
        hasGuardrailFailing = true;
      } else if (signalSet.has(metricId)) {
        hasSignalRegression = true;
      }
    }
  }
  if (hasGuardrailFailing) signals.push("guardrail-failing");
  if (hasSignalRegression) signals.push("signal-regression");

  if (signals.length === 0) {
    signals.push("healthy");
  }

  return { signals, actions };
}

function actionSuffix(action?: SignalAction): string {
  if (action === "hold") return " · Holding";
  if (action === "rollback") return " · Rolling back";
  if (action === "warn") return " · Warning";
  return "";
}

function actionColor(
  defaultColor: "red" | "orange" | "amber" | "blue",
  action?: SignalAction,
): "red" | "orange" | "amber" | "blue" {
  if (action === "hold") return "amber";
  if (action === "rollback") return "red";
  if (action === "warn") return "blue";
  return defaultColor;
}

function signalToBadge(
  signal: RampHealthSignal,
  action?: SignalAction,
): React.ReactNode {
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
      return (
        <Badge
          color={actionColor("amber", action)}
          variant="soft"
          label={`SRM${actionSuffix(action)}`}
          radius="full"
        />
      );
    case "multiple-exposures":
      return (
        <Badge
          color={actionColor("amber", action)}
          variant="soft"
          label={`Multi-exposure${actionSuffix(action)}`}
          radius="full"
        />
      );
    case "no-traffic":
      return (
        <Badge
          color={actionColor("amber", action)}
          variant="soft"
          label={`No Traffic${actionSuffix(action)}`}
          radius="full"
        />
      );
    case "below-min-sample":
      return (
        <Badge
          color="blue"
          variant="soft"
          label="Awaiting Sample"
          radius="full"
        />
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
  const { snapshot, safeRollout } = useSafeRolloutSnapshot();
  const { settings } = useUser();
  const { metricGroups } = useDefinitions();
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;
  const meMinPercent =
    settings.multipleExposureMinPercent ?? DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD;

  const expandedGuardrailIds = useMemo(
    () =>
      expandMetricGroups(
        rampSchedule.monitoringConfig?.guardrailMetricIds ?? [],
        metricGroups,
      ),
    [rampSchedule.monitoringConfig?.guardrailMetricIds, metricGroups],
  );
  const expandedSignalIds = useMemo(
    () =>
      expandMetricGroups(
        rampSchedule.monitoringConfig?.signalMetricIds ?? [],
        metricGroups,
      ),
    [rampSchedule.monitoringConfig?.signalMetricIds, metricGroups],
  );

  const result = useMemo(
    () =>
      computeSignals(
        rampSchedule,
        snapshot,
        safeRollout,
        srmThreshold,
        meMinPercent,
        expandedGuardrailIds,
        expandedSignalIds,
      ),
    [
      rampSchedule,
      snapshot,
      safeRollout,
      srmThreshold,
      meMinPercent,
      expandedGuardrailIds,
      expandedSignalIds,
    ],
  );

  console.log("[RampMonitoringBadges]", {
    scheduleId: rampSchedule.id,
    status: rampSchedule.status,
    signals: result.signals,
    actions: result.actions,
  });

  return (
    <>
      {result.signals.map((s, i) => (
        <span key={`${s}-${i}`}>
          {signalToBadge(s, result.actions[s])}
        </span>
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
  const { snapshot, safeRollout } = useSafeRolloutSnapshot();
  const { settings } = useUser();
  const { metricGroups } = useDefinitions();
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;
  const meMinPercent =
    settings.multipleExposureMinPercent ?? DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD;

  const expandedGuardrailIds = useMemo(
    () =>
      expandMetricGroups(
        rampSchedule.monitoringConfig?.guardrailMetricIds ?? [],
        metricGroups,
      ),
    [rampSchedule.monitoringConfig?.guardrailMetricIds, metricGroups],
  );
  const expandedSignalIds = useMemo(
    () =>
      expandMetricGroups(
        rampSchedule.monitoringConfig?.signalMetricIds ?? [],
        metricGroups,
      ),
    [rampSchedule.monitoringConfig?.signalMetricIds, metricGroups],
  );

  const result = useMemo(
    () =>
      computeSignals(
        rampSchedule,
        snapshot,
        safeRollout,
        srmThreshold,
        meMinPercent,
        expandedGuardrailIds,
        expandedSignalIds,
      ),
    [
      rampSchedule,
      snapshot,
      safeRollout,
      srmThreshold,
      meMinPercent,
      expandedGuardrailIds,
      expandedSignalIds,
    ],
  );

  if (rampSchedule.status !== "running") return null;

  const { signals, actions } = result;

  // Only show "Roll Back" CTA for guardrail failures (always auto-rollback).
  if (signals.includes("guardrail-failing")) {
    return (
      <Button size="xs" variant="solid" color="red" onClick={onRollback}>
        Roll Back
      </Button>
    );
  }

  // For other signals, only show a CTA if the configured action is "rollback".
  // "hold" signals are already being held by the evaluator — no user action needed.
  // "warn" signals are informational only.
  const hasRollbackSignal = (
    ["srm", "multiple-exposures", "no-traffic"] as RampHealthSignal[]
  ).some((s) => signals.includes(s) && actions[s] === "rollback");

  if (hasRollbackSignal) {
    return (
      <Button size="xs" variant="solid" color="red" onClick={onRollback}>
        Roll Back
      </Button>
    );
  }

  return null;
}
