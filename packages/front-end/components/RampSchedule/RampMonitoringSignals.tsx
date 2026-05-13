import { useMemo } from "react";
import { RampScheduleInterface, SafeRolloutInterface } from "shared/validators";
import { SafeRolloutSnapshotInterface } from "shared/types/safe-rollout";
import { getValidDate } from "shared/dates";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
} from "shared/constants";
import { getSRMHealthData, getMultipleExposureHealthData } from "shared/health";
import { expandMetricGroups } from "shared/experiments";
import Badge from "@/ui/Badge";
import Button, { Size as ButtonSize } from "@/ui/Button";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formatRollbackReason } from "@/components/RampSchedule/rollbackReason";

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
type SignalDetails = Partial<Record<RampHealthSignal, string>>;

type SignalResult = {
  signals: RampHealthSignal[];
  actions: Partial<Record<RampHealthSignal, SignalAction>>;
  details: SignalDetails;
};

const NO_TRAFFIC_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

function formatPValue(value: number): string {
  return value < 0.001 ? "<0.001" : value.toFixed(3);
}

function getHoldStatusPrefix(rampSchedule: RampScheduleInterface): string {
  const activeHold = isHoldingNow(rampSchedule);
  return activeHold ? "Holding" : "Step may hold when complete";
}

function isHoldingNow(rampSchedule: RampScheduleInterface): boolean {
  const step =
    rampSchedule.currentStepIndex >= 0
      ? rampSchedule.steps[rampSchedule.currentStepIndex]
      : undefined;
  if (
    rampSchedule.status === "running" &&
    step?.monitored &&
    step.trigger.type === "interval" &&
    rampSchedule.currentStepEnteredAt
  ) {
    const stepEnteredAt = getValidDate(rampSchedule.currentStepEnteredAt);
    const stepDueAt = stepEnteredAt.getTime() + step.trigger.seconds * 1000;
    return Date.now() >= stepDueAt;
  }
  return true;
}

function conservativeActionForSignals(
  signals: RampHealthSignal[],
  actions: Partial<Record<RampHealthSignal, SignalAction>>,
): SignalAction | undefined {
  let hasWarn = false;
  let hasHold = false;
  let hasRollback = false;

  for (const signal of signals) {
    if (signal === "guardrail-failing") {
      hasRollback = true;
      continue;
    }
    if (signal === "signal-regression" || signal === "below-min-sample") {
      hasHold = true;
      continue;
    }
    if (
      signal === "srm" ||
      signal === "multiple-exposures" ||
      signal === "no-traffic"
    ) {
      const action = actions[signal];
      if (action === "rollback") hasRollback = true;
      else if (action === "hold") hasHold = true;
      else if (action === "warn") hasWarn = true;
    }
  }

  if (hasRollback) return "rollback";
  if (hasHold) return "hold";
  if (hasWarn) return "warn";
  return undefined;
}

function signalSummaryPart(
  signal: RampHealthSignal,
  details: SignalDetails,
): string {
  switch (signal) {
    case "guardrail-failing":
      return "guardrail metric regressing";
    case "signal-regression":
      return "signal metric regressing";
    case "srm":
      return details["srm"] ?? "sample ratio mismatch detected";
    case "multiple-exposures":
      return details["multiple-exposures"] ?? "multiple exposures detected";
    case "no-traffic":
      return "no monitored traffic yet";
    case "below-min-sample":
      return details["below-min-sample"] ?? "building minimum sample size";
    case "awaiting-data":
      return "monitoring recently started";
    default:
      return signal;
  }
}

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
  const details: SignalDetails = {};
  const mc = rampSchedule.monitoringConfig;

  const isMonitored = rampSchedule.steps.some((s) => s.monitored);
  if (!isMonitored || !["running", "paused"].includes(rampSchedule.status)) {
    return { signals, actions, details };
  }

  const traffic = snapshot?.health?.traffic;
  const units = traffic?.overall?.variationUnits;
  const totalUsers = units?.reduce((a, b) => a + b, 0) ?? 0;
  const srmPValue = traffic?.overall?.srm;
  const monitoringStartRaw =
    rampSchedule.monitoringStartDate ??
    rampSchedule.currentStepEnteredAt ??
    rampSchedule.startedAt;
  const monitoringStartDate = monitoringStartRaw
    ? getValidDate(monitoringStartRaw)
    : null;
  const inNoTrafficGraceWindow =
    !!monitoringStartDate &&
    Date.now() - monitoringStartDate.getTime() < NO_TRAFFIC_GRACE_PERIOD_MS;

  if (snapshot && totalUsers === 0) {
    if (inNoTrafficGraceWindow) {
      signals.push("awaiting-data");
      return { signals, actions, details };
    }
    signals.push("no-traffic");
    actions["no-traffic"] = (mc?.noTrafficAction as SignalAction) ?? "hold";
    return { signals, actions, details };
  }

  if (!snapshot) {
    signals.push("awaiting-data");
    return { signals, actions, details };
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
      details["srm"] =
        `SRM p-value ${formatPValue(srmPValue)} is below threshold ${srmThreshold}`;
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
    actions["multiple-exposures"] =
      (mc?.multipleExposureAction as SignalAction) ?? "hold";
    details["multiple-exposures"] =
      `${(meHealth.rawDecimal * 100).toFixed(1)}% of users saw multiple variations`;
  }

  // Min sample size check — uses the current step's holdConditions
  const currentStep =
    rampSchedule.currentStepIndex >= 0
      ? rampSchedule.steps[rampSchedule.currentStepIndex]
      : undefined;
  const minSample = currentStep?.holdConditions?.minSampleSize;
  if (minSample && totalUsers < minSample) {
    signals.push("below-min-sample");
    details["below-min-sample"] =
      `${totalUsers.toLocaleString()} of ${minSample.toLocaleString()} required users collected`;
  }

  const resultsStatus = safeRollout?.analysisSummary?.resultsStatus;
  const guardrailSet = new Set(expandedGuardrailIds);
  const signalSet = new Set(
    expandedSignalIds.filter((id) => !guardrailSet.has(id)),
  );

  let hasGuardrailFailing = false;
  let hasSignalRegression = false;
  if (resultsStatus) {
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
  }
  if (hasGuardrailFailing) signals.push("guardrail-failing");
  if (hasSignalRegression) signals.push("signal-regression");

  if (signals.length === 0) {
    signals.push("healthy");
  }

  return { signals, actions, details };
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

/**
 * Hook that computes the current ramp monitoring signals + actions for a
 * schedule. Used by header/badge/CTA components so the signal logic stays in
 * one place.
 */
export function useRampMonitoringSignals(
  rampSchedule: RampScheduleInterface,
  overrides?: {
    snapshot?: SafeRolloutSnapshotInterface;
    safeRollout?: SafeRolloutInterface;
  },
): SignalResult {
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

  const snapshotData = overrides?.snapshot ?? snapshot;
  const safeRolloutData = overrides?.safeRollout ?? safeRollout;

  return useMemo(
    () =>
      computeSignals(
        rampSchedule,
        snapshotData,
        safeRolloutData,
        srmThreshold,
        meMinPercent,
        expandedGuardrailIds,
        expandedSignalIds,
      ),
    [
      rampSchedule,
      snapshotData,
      safeRolloutData,
      srmThreshold,
      meMinPercent,
      expandedGuardrailIds,
      expandedSignalIds,
    ],
  );
}

export type RampHealthSeverity =
  | "critical"
  | "warning"
  | "info"
  | "healthy"
  | "inactive";

export interface RampHealthOverview {
  severity: RampHealthSeverity;
  label: string;
  summary: string;
  /** True when the situation warrants drawing the user's attention. */
  autoExpand: boolean;
}

/**
 * True when the schedule is actively running and the user's current step has
 * `monitored: true`. Safe-rollout monitoring (snapshots, signals, guardrails,
 * health checks) is only meaningful in this window — outside of it the UI
 * should suppress monitoring-specific status, badges, and CTAs.
 */
export function isOnMonitoredStep(
  rampSchedule: RampScheduleInterface,
): boolean {
  if (rampSchedule.status !== "running") return false;
  const step = rampSchedule.steps[rampSchedule.currentStepIndex];
  return !!step?.monitored;
}

/**
 * Reduce a signal set to a single high-level health overview suitable for a
 * one-line header. Picks the most-severe signal as the dominant status.
 */
export function getRampHealthOverview(
  rampSchedule: RampScheduleInterface,
  result: SignalResult,
): RampHealthOverview {
  const { signals, actions, details } = result;
  const holdingNow = isHoldingNow(rampSchedule);
  const holdPrefix = getHoldStatusPrefix(rampSchedule);
  const displaySignals = holdingNow
    ? signals
    : signals.filter((s) => s !== "below-min-sample");
  const firstMonitoredStepIndex = rampSchedule.steps.findIndex(
    (s) => !!s.monitored,
  );

  if (rampSchedule.status === "rolled-back") {
    const reason = formatRollbackReason(rampSchedule.lastRollbackReason);
    return {
      severity: "inactive",
      label: "Rolled back",
      summary: reason ?? "Ramp was rolled back",
      autoExpand: false,
    };
  }
  if (rampSchedule.status === "completed") {
    return {
      severity: "inactive",
      label: "Complete",
      summary: "Ramp completed. Monitoring has ended.",
      autoExpand: false,
    };
  }
  if (rampSchedule.status === "pending-approval") {
    const approvalNotes =
      rampSchedule.currentStepIndex >= 0
        ? rampSchedule.steps[
            rampSchedule.currentStepIndex
          ]?.approvalNotes?.trim()
        : "";
    return {
      severity: "inactive",
      label: "Approval required",
      summary:
        approvalNotes || "Approve this step to continue monitored ramp-up",
      autoExpand: false,
    };
  }
  if (rampSchedule.status === "pending" || rampSchedule.status === "ready") {
    return {
      severity: "inactive",
      label: "Not started",
      summary:
        firstMonitoredStepIndex >= 0
          ? `Monitoring begins on Step ${firstMonitoredStepIndex + 1}`
          : "No monitored steps configured",
      autoExpand: false,
    };
  }
  const currentStepMonitored =
    rampSchedule.currentStepIndex >= 0 &&
    !!rampSchedule.steps[rampSchedule.currentStepIndex]?.monitored;
  if (rampSchedule.status === "paused" && currentStepMonitored) {
    return {
      severity: "inactive",
      label: "Paused",
      summary: "Click Resume to continue monitored ramp-up",
      autoExpand: false,
    };
  }
  // Running, but the user's current step is not monitored — snapshots and
  // signals don't apply, so present the same inactive shell as the other
  // non-monitoring states rather than letting signal-derived overviews leak
  // through.
  if (!isOnMonitoredStep(rampSchedule)) {
    const nextMonitoredStepIndex = rampSchedule.steps.findIndex(
      (s, idx) => idx > rampSchedule.currentStepIndex && !!s.monitored,
    );
    const previousMonitoredStepIndex = (() => {
      for (let i = rampSchedule.currentStepIndex - 1; i >= 0; i--) {
        if (rampSchedule.steps[i]?.monitored) return i;
      }
      return -1;
    })();

    const summary =
      nextMonitoredStepIndex >= 0
        ? `Monitoring begins on Step ${nextMonitoredStepIndex + 1}`
        : previousMonitoredStepIndex >= 0
          ? "Monitoring was active on earlier steps"
          : "No monitored steps configured";

    return {
      severity: "inactive",
      label: "Unmonitored step",
      summary,
      autoExpand: false,
    };
  }

  const activeSignals = displaySignals.filter((s) => s !== "healthy");
  if (activeSignals.length > 1) {
    const conservativeAction = conservativeActionForSignals(
      activeSignals,
      actions,
    );
    const prefix =
      conservativeAction === "rollback"
        ? "Rolling back"
        : conservativeAction === "hold"
          ? holdPrefix
          : conservativeAction === "warn"
            ? "Warning"
            : "Multiple issues detected";
    const parts = activeSignals.map((s) => signalSummaryPart(s, details));
    return {
      severity:
        conservativeAction === "rollback"
          ? "critical"
          : conservativeAction === "hold" || conservativeAction === "warn"
            ? "warning"
            : "info",
      label: "Multiple issues",
      summary: `${prefix} — ${parts.join(" · ")}`,
      autoExpand: true,
    };
  }

  if (displaySignals.includes("guardrail-failing")) {
    return {
      severity: "critical",
      label: "Guardrail failing",
      summary:
        actions["guardrail-failing"] === "rollback"
          ? "A guardrail metric is regressing — rolling back"
          : "A guardrail metric is regressing",
      autoExpand: true,
    };
  }
  if (displaySignals.includes("signal-regression")) {
    return {
      severity: "warning",
      label: "Signal regressing",
      summary: `${holdPrefix} — a signal metric is regressing`,
      autoExpand: true,
    };
  }
  if (displaySignals.includes("srm")) {
    const action = actions["srm"];
    const detail = details["srm"];
    return {
      severity: action === "rollback" ? "critical" : "warning",
      label: "SRM detected",
      summary:
        action === "rollback"
          ? detail
            ? `Rolling back — ${detail}`
            : "Sample ratio mismatch — rolling back"
          : action === "warn"
            ? (detail ?? "Sample ratio mismatch detected")
            : detail
              ? `${holdPrefix} — ${detail}`
              : "Sample ratio mismatch — holding",
      autoExpand: true,
    };
  }
  if (displaySignals.includes("multiple-exposures")) {
    const action = actions["multiple-exposures"];
    const detail = details["multiple-exposures"];
    return {
      severity: action === "rollback" ? "critical" : "warning",
      label: "Multiple exposures",
      summary:
        action === "rollback"
          ? detail
            ? `Rolling back — ${detail}`
            : "Multiple-exposure issue — rolling back"
          : action === "warn"
            ? (detail ?? "Users exposed to multiple variations")
            : detail
              ? `${holdPrefix} — ${detail}`
              : "Multiple-exposure issue — holding",
      autoExpand: true,
    };
  }
  if (displaySignals.includes("no-traffic")) {
    const action = actions["no-traffic"];
    return {
      severity: action === "rollback" ? "critical" : "warning",
      label: "No traffic",
      summary:
        action === "rollback"
          ? "No monitored traffic — rolling back"
          : action === "warn"
            ? "No monitored traffic yet — warning only"
            : `${holdPrefix} — no monitored traffic yet`,
      autoExpand: true,
    };
  }
  if (displaySignals.includes("below-min-sample")) {
    const detail = details["below-min-sample"];
    return {
      severity: "info",
      label: "Awaiting sample",
      summary: detail ?? "Building up to the minimum sample size",
      autoExpand: false,
    };
  }
  if (displaySignals.includes("awaiting-data")) {
    return {
      severity: "info",
      label: "No data yet",
      summary:
        "Monitoring recently started. Check back soon for updated status.",
      autoExpand: false,
    };
  }
  return {
    severity: "healthy",
    label: "Healthy",
    summary: "All monitored metrics are within bounds",
    autoExpand: false,
  };
}

export function RampMonitoringBadges({
  rampSchedule,
}: {
  rampSchedule: RampScheduleInterface;
}) {
  const result = useRampMonitoringSignals(rampSchedule);

  // Signal badges describe the live monitoring state of the current step;
  // outside of a monitored running step they're meaningless and would
  // misrepresent stale or non-applicable data.
  if (!isOnMonitoredStep(rampSchedule)) return null;

  return (
    <>
      {result.signals.map((s, i) => (
        <span key={`${s}-${i}`}>{signalToBadge(s, result.actions[s])}</span>
      ))}
    </>
  );
}

/** Human-readable cause string captured at click time and persisted as the
 * rollback reason. Lower-case so it reads naturally after "Manual: ". */
const SIGNAL_REASON: Partial<Record<RampHealthSignal, string>> = {
  "guardrail-failing": "guardrail failing",
  "signal-regression": "signal regressing",
  srm: "SRM detected",
  "multiple-exposures": "multiple exposures",
  "no-traffic": "no traffic",
};

export function RampMonitoringCTAs({
  rampSchedule,
  onRollback,
  onRestart,
  onResume,
  onApproveStep,
  onAdvance,
  size = "xs",
}: {
  rampSchedule: RampScheduleInterface;
  /** Receives the dominant signal at click time so the caller can persist it. */
  onRollback: (reason?: string) => void;
  /** Brings a terminal "rolled-back" schedule back to startable "ready". */
  onRestart?: () => void;
  /** Resumes a paused schedule. */
  onResume?: () => void;
  /** Approves a pending-approval monitored step. */
  onApproveStep?: () => void;
  /** Forces advancement from an active hold state. */
  onAdvance?: () => void;
  /** Button size for the rendered CTAs. Defaults to xs to fit row layouts. */
  size?: ButtonSize;
}) {
  const result = useRampMonitoringSignals(rampSchedule);

  // Terminal "rolled-back" surfaces a Restart CTA. Server-side this clears
  // any prior start-on-date delays and runs the same logic as `start`, so
  // one click takes the schedule from rolled-back → running.
  if (rampSchedule.status === "rolled-back" && onRestart) {
    return (
      <Button size={size} variant="solid" onClick={onRestart}>
        Restart
      </Button>
    );
  }
  if (
    rampSchedule.status === "paused" &&
    onResume &&
    rampSchedule.currentStepIndex >= 0 &&
    !!rampSchedule.steps[rampSchedule.currentStepIndex]?.monitored
  ) {
    return (
      <Button size={size} variant="solid" onClick={onResume}>
        Resume
      </Button>
    );
  }
  if (
    rampSchedule.status === "pending-approval" &&
    onApproveStep &&
    rampSchedule.currentStepIndex >= 0 &&
    !!rampSchedule.steps[rampSchedule.currentStepIndex]?.monitored
  ) {
    return (
      <Button size={size} variant="solid" onClick={onApproveStep}>
        Approve Step
      </Button>
    );
  }

  // Outside of a monitored running step, suppress all monitoring CTAs (no
  // rollback prompts on non-monitored phases — the ramp evaluator isn't
  // looking at signals there).
  if (!isOnMonitoredStep(rampSchedule)) return null;

  const { signals, actions } = result;
  const conservativeAction = conservativeActionForSignals(signals, actions);
  const hasHoldSignal =
    signals.includes("signal-regression") ||
    signals.includes("below-min-sample") ||
    (signals.includes("srm") && actions["srm"] === "hold") ||
    (signals.includes("multiple-exposures") &&
      actions["multiple-exposures"] === "hold") ||
    (signals.includes("no-traffic") && actions["no-traffic"] === "hold");
  const activelyHolding = hasHoldSignal && isHoldingNow(rampSchedule);

  if (activelyHolding && onAdvance && conservativeAction === "hold") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button size={size} variant="solid" onClick={onAdvance}>
          Continue
        </Button>
        <Button
          size={size}
          variant="outline"
          color="red"
          onClick={() => onRollback("rolled back while holding")}
        >
          Roll Back
        </Button>
      </div>
    );
  }

  // Only show "Roll Back" CTA for guardrail failures (always auto-rollback).
  if (signals.includes("guardrail-failing")) {
    return (
      <Button
        size={size}
        variant="solid"
        color="red"
        onClick={() => onRollback(SIGNAL_REASON["guardrail-failing"])}
      >
        Roll Back
      </Button>
    );
  }

  // For other signals, only show a CTA if the configured action is "rollback".
  // "hold" signals are already being held by the evaluator — no user action needed.
  // "warn" signals are informational only.
  if (conservativeAction === "rollback") {
    const rollbackPriority: RampHealthSignal[] = [
      "guardrail-failing",
      "srm",
      "multiple-exposures",
      "no-traffic",
    ];
    const dominantRollbackSignal = rollbackPriority.find((s) =>
      signals.includes(s),
    );
    return (
      <Button
        size={size}
        variant="solid"
        color="red"
        onClick={() =>
          onRollback(
            dominantRollbackSignal
              ? SIGNAL_REASON[dominantRollbackSignal]
              : undefined,
          )
        }
      >
        Roll Back
      </Button>
    );
  }

  // Warn-only mixed statuses intentionally show no hard CTA.

  return null;
}
