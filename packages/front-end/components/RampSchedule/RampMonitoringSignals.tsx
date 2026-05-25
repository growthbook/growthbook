import { useMemo } from "react";
import { useRouter } from "next/router";
import {
  isAwaitingApproval,
  RampScheduleInterface,
  SafeRolloutInterface,
} from "shared/validators";
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
import {
  buildDummyIssueProfile,
  buildDummyScenarios,
  getDummySeed,
  hashString,
  seededRandom,
} from "@/components/RampSchedule/dummyMonitoringData";

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

export type SignalResult = {
  signals: RampHealthSignal[];
  actions: Partial<Record<RampHealthSignal, SignalAction>>;
  details: SignalDetails;
};

const NO_TRAFFIC_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
const MULTIPLE_ISSUES_LABEL = "Multiple issues detected";

function buildDummySignalData({
  seed,
  guardrailMetricIds,
  signalMetricIds,
}: {
  seed: number;
  guardrailMetricIds: string[];
  signalMetricIds: string[];
}): {
  snapshot: SafeRolloutSnapshotInterface;
  safeRollout: SafeRolloutInterface;
} {
  const profile = buildDummyIssueProfile(seed);
  const allMetricIds = [...guardrailMetricIds, ...signalMetricIds];
  const scenarios = buildDummyScenarios(allMetricIds, seed, profile);
  const lowTrafficRand = seededRandom(seed ^ 0x3ad8025f);
  const firstMetricRand = seededRandom(hashString(allMetricIds[0] ?? "dummy"));
  const treatmentUsers = profile.forceNoTraffic
    ? 0
    : profile.forceLowTraffic
      ? 15 + Math.round(lowTrafficRand() * 40)
      : 800 + Math.round(firstMetricRand() * 4000);
  const controlUsers = profile.forceNoTraffic
    ? 0
    : profile.forceLowTraffic
      ? 15 + Math.round(lowTrafficRand() * 40)
      : 800 + Math.round(firstMetricRand() * 4000);
  const totalUsers = treatmentUsers + controlUsers;
  const guardrailMetrics: Record<string, { status: string }> = {};
  allMetricIds.forEach((metricId, idx) => {
    guardrailMetrics[metricId] = {
      status: scenarios[idx] === "failing" ? "lost" : "won",
    };
  });

  return {
    snapshot: {
      id: "srsnp_dummy",
      organization: "",
      safeRolloutId: "",
      dateCreated: new Date(),
      runStarted: new Date(),
      status: "success",
      queries: [],
      multipleExposures: Math.round(totalUsers * profile.multipleExposureRate),
      analyses: [],
      health: {
        traffic: {
          overall: {
            name: "All",
            srm: profile.srmPValue,
            variationUnits: [treatmentUsers, controlUsers],
          },
          dimension: {},
        },
      },
      settings: {
        datasourceId: "",
        exposureQueryId: "",
        startDate: new Date(),
        metricSettings: [],
      },
    } as unknown as SafeRolloutSnapshotInterface,
    safeRollout: {
      analysisSummary: {
        resultsStatus: {
          variations: [
            { variationId: "1", guardrailMetrics },
            { variationId: "0", guardrailMetrics: {} },
          ],
        },
      },
    } as unknown as SafeRolloutInterface,
  };
}

function formatPValue(value: number): string {
  return value < 0.001 ? "<0.001" : value.toFixed(3);
}

function getHoldStatusPrefix(rampSchedule: RampScheduleInterface): string {
  const activeHold = isHoldingNow(rampSchedule);
  return activeHold ? "Holding" : "Step may hold when complete";
}

export function isHoldingNow(rampSchedule: RampScheduleInterface): boolean {
  const step =
    rampSchedule.currentStepIndex >= 0
      ? rampSchedule.steps[rampSchedule.currentStepIndex]
      : undefined;
  if (
    rampSchedule.status === "running" &&
    step?.monitored &&
    step.interval != null &&
    rampSchedule.currentStepEnteredAt
  ) {
    const stepEnteredAt = getValidDate(rampSchedule.currentStepEnteredAt);
    const stepDueAt = stepEnteredAt.getTime() + step.interval * 1000;
    return Date.now() >= stepDueAt;
  }
  return false;
}

// Returns true when we're past `threshold` (0–1) of the current step's
// interval. Used to suppress "Awaiting Sample" noise early in a long step —
// only surface it once there's reason to be concerned about pace.
export function isNearingStepEnd(
  rampSchedule: RampScheduleInterface,
  threshold = 0.75,
): boolean {
  const step =
    rampSchedule.currentStepIndex >= 0
      ? rampSchedule.steps[rampSchedule.currentStepIndex]
      : undefined;
  if (
    rampSchedule.status === "running" &&
    step?.monitored &&
    step.interval != null &&
    rampSchedule.currentStepEnteredAt
  ) {
    const stepEnteredAt = getValidDate(rampSchedule.currentStepEnteredAt);
    const elapsed = Date.now() - stepEnteredAt.getTime();
    return elapsed >= step.interval * 1000 * threshold;
  }
  return false;
}

export function conservativeActionForSignals(
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

  const currentStep =
    rampSchedule.currentStepIndex >= 0
      ? rampSchedule.steps[rampSchedule.currentStepIndex]
      : undefined;
  const minSample = currentStep?.holdConditions?.minSampleSize;
  // Only surface the below-min-sample signal once we're ≥75% through the
  // step's interval — before that, being below the threshold is expected and
  // showing it would create false alarm noise.
  if (minSample && totalUsers < minSample && isNearingStepEnd(rampSchedule)) {
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
  if (hasGuardrailFailing) {
    signals.push("guardrail-failing");
    actions["guardrail-failing"] = "rollback";
  }
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

function signalSeverity(
  signal: RampHealthSignal,
  action?: SignalAction,
): RampHealthSeverity {
  if (signal === "guardrail-failing" || action === "rollback") {
    return "critical";
  }
  if (
    signal === "signal-regression" ||
    signal === "srm" ||
    signal === "multiple-exposures" ||
    signal === "no-traffic" ||
    action === "hold" ||
    action === "warn"
  ) {
    return "warning";
  }
  if (signal === "below-min-sample") return "info";
  return "healthy";
}

function maxSignalSeverity(
  signals: RampHealthSignal[],
  actions: Partial<Record<RampHealthSignal, SignalAction>>,
): RampHealthSeverity {
  const severityRank: Record<RampHealthSeverity, number> = {
    critical: 4,
    warning: 3,
    info: 2,
    healthy: 1,
    inactive: 0,
  };
  return signals.reduce<RampHealthSeverity>((max, signal) => {
    const severity = signalSeverity(signal, actions[signal]);
    return severityRank[severity] > severityRank[max] ? severity : max;
  }, "healthy");
}

function severityBadgeColor(
  severity: RampHealthSeverity,
): "red" | "amber" | "blue" {
  if (severity === "critical") return "red";
  if (severity === "warning") return "amber";
  return "blue";
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
          label="Guardrail failing"
          radius="full"
        />
      );
    case "signal-regression":
      return (
        <Badge
          color="orange"
          variant="soft"
          label="Signal regressing"
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
          label={`Multiple exposures${actionSuffix(action)}`}
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

export function useRampMonitoringSignals(
  rampSchedule: RampScheduleInterface,
  overrides?: {
    snapshot?: SafeRolloutSnapshotInterface;
    safeRollout?: SafeRolloutInterface;
  },
): SignalResult {
  const { snapshot, safeRollout } = useSafeRolloutSnapshot();
  const router = useRouter();
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

  const dummySignalData = useMemo(() => {
    if (overrides?.snapshot || router.query["dummy"] !== "true") return null;
    return buildDummySignalData({
      seed: getDummySeed(router.query["dummySeed"], rampSchedule.id),
      guardrailMetricIds: expandedGuardrailIds,
      signalMetricIds: expandedSignalIds,
    });
  }, [
    overrides?.snapshot,
    router.query,
    rampSchedule.id,
    expandedGuardrailIds,
    expandedSignalIds,
  ]);

  const snapshotData =
    overrides?.snapshot ?? dummySignalData?.snapshot ?? snapshot;
  const safeRolloutData =
    overrides?.safeRollout ?? dummySignalData?.safeRollout ?? safeRollout;

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
  autoExpand: boolean;
}

export function isOnMonitoredStep(
  rampSchedule: RampScheduleInterface,
): boolean {
  if (rampSchedule.status !== "running") return false;
  const step = rampSchedule.steps[rampSchedule.currentStepIndex];
  return !!step?.monitored;
}

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
      severity: "critical",
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
  if (isAwaitingApproval(rampSchedule)) {
    const currentStep = rampSchedule.steps[rampSchedule.currentStepIndex];
    const approvalNotes = currentStep?.approvalNotes?.trim();
    return {
      severity: "inactive" as const,
      label: "Awaiting approval",
      summary:
        approvalNotes ||
        "This step requires approval before the ramp can advance",
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
            : MULTIPLE_ISSUES_LABEL;
    const parts = activeSignals.map((s) => signalSummaryPart(s, details));
    return {
      severity:
        conservativeAction === "rollback"
          ? "critical"
          : conservativeAction === "hold" || conservativeAction === "warn"
            ? "warning"
            : "info",
      label: MULTIPLE_ISSUES_LABEL,
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

  if (!isOnMonitoredStep(rampSchedule)) return null;

  const badgeSignals = result.signals.filter((s) =>
    signalToBadge(s, result.actions[s]),
  );

  if (badgeSignals.length > 1) {
    return (
      <Badge
        color={severityBadgeColor(
          maxSignalSeverity(badgeSignals, result.actions),
        )}
        variant="soft"
        label={MULTIPLE_ISSUES_LABEL}
        radius="full"
      />
    );
  }

  return (
    <>
      {badgeSignals.map((s, i) => {
        const badge = signalToBadge(s, result.actions[s]);
        return badge ? <span key={`${s}-${i}`}>{badge}</span> : null;
      })}
    </>
  );
}

// Lower-case strings read naturally after "Manual: ".
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
  signalResult,
}: {
  rampSchedule: RampScheduleInterface;
  onRollback: (reason?: string) => void;
  onRestart?: () => void;
  onResume?: () => void;
  onApproveStep?: () => void;
  onAdvance?: () => void;
  size?: ButtonSize;
  signalResult?: SignalResult;
}) {
  const computedResult = useRampMonitoringSignals(rampSchedule);
  const result = signalResult ?? computedResult;

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
  if (onApproveStep && isAwaitingApproval(rampSchedule)) {
    return (
      <Button size={size} variant="solid" onClick={onApproveStep}>
        Approve Step
      </Button>
    );
  }

  if (!isOnMonitoredStep(rampSchedule)) return null;

  const { signals, actions } = result;
  const conservativeAction = conservativeActionForSignals(signals, actions);
  const rollbackPriority: RampHealthSignal[] = [
    "guardrail-failing",
    "signal-regression",
    "multiple-exposures",
    "srm",
    "no-traffic",
  ];
  const dominantRollbackSignal = rollbackPriority.find((s) =>
    signals.includes(s),
  );
  const rollbackReason = dominantRollbackSignal
    ? SIGNAL_REASON[dominantRollbackSignal]
    : undefined;
  const rollbackButton = (variant: "solid" | "outline") => (
    <Button
      size={size}
      variant={variant}
      color="red"
      onClick={() => onRollback(rollbackReason)}
    >
      Rollback
    </Button>
  );
  const hasHoldSignal =
    signals.includes("signal-regression") ||
    signals.includes("below-min-sample") ||
    (signals.includes("srm") && actions["srm"] === "hold") ||
    (signals.includes("multiple-exposures") &&
      actions["multiple-exposures"] === "hold") ||
    (signals.includes("no-traffic") && actions["no-traffic"] === "hold");
  const activelyHolding = hasHoldSignal && isHoldingNow(rampSchedule);

  // If the step is both awaiting approval AND actively held by a monitoring
  // signal, show a single "Approve & Continue" that fires both actions —
  // calling approve-step first then advance. Showing two separate buttons
  // would be confusing, and "Approve Step" alone would leave the user still
  // held after approving.
  if (
    activelyHolding &&
    onApproveStep &&
    onAdvance &&
    isAwaitingApproval(rampSchedule) &&
    conservativeAction === "hold"
  ) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size={size}
          variant="solid"
          onClick={async () => {
            await onApproveStep();
            await onAdvance();
          }}
        >
          Approve & Continue
        </Button>
        {rollbackButton("outline")}
      </div>
    );
  }

  if (activelyHolding && onAdvance && conservativeAction === "hold") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button size={size} variant="solid" onClick={onAdvance}>
          Continue
        </Button>
        {rollbackButton("outline")}
      </div>
    );
  }

  if (signals.includes("guardrail-failing")) {
    return rollbackButton("solid");
  }

  if (
    signals.includes("signal-regression") ||
    signals.includes("multiple-exposures")
  ) {
    return rollbackButton("outline");
  }

  if (conservativeAction === "rollback") {
    return rollbackButton("outline");
  }

  return null;
}
