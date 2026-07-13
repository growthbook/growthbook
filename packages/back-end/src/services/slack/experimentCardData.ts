import { getSnapshotAnalysis } from "shared/util";
import type { ExperimentMetricInterface } from "shared/experiments";
import type { ExperimentInterface } from "shared/types/experiment";
import type {
  SnapshotMetric,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import type { Context } from "back-end/src/models/BaseModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentMetricById } from "back-end/src/services/experiments";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { logger } from "back-end/src/util/logger";
import type {
  CardCiMetric,
  CardGoalRow,
  CardState,
  ExperimentCardData,
} from "back-end/src/services/slack/chartImage";

// Maps a GrowthBook experiment + its latest snapshot into the card model the
// Slack renderer consumes. Numbers come off the snapshot's default analysis;
// `expected`/`ci` are fractional relative uplift (matching the front-end graph),
// so we scale to % for the card.

const SRM_P_THRESHOLD = 0.001; // matches the default health-check threshold
const SIG_THRESHOLD = 0.05;
const MAX_SECONDARY = 3;
const MAX_GUARDRAIL = 3;

function pct(v: number): string {
  return (v > 0 ? "+" : "") + Math.round(v * 10) / 10 + "%";
}

function compact(n: number | undefined): string | undefined {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function fmtDate(d: Date | string | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

// Best-effort value formatting from the metric type. Less exhaustive than the
// front-end's getExperimentMetricFormatter, but covers the common
// proportion / currency / count cases.
function formatMetricValue(
  metric: ExperimentMetricInterface | null,
  m: SnapshotMetric | undefined,
): string {
  if (!m) return "—";
  const value = Number.isFinite(m.cr) ? m.cr : m.value / (m.users || 1);
  if (!Number.isFinite(value)) return "—";

  const legacyType = (metric as { type?: string } | null)?.type;
  const factType = (metric as { metricType?: string } | null)?.metricType;
  const isProportion =
    legacyType === "binomial" ||
    factType === "proportion" ||
    factType === "retention";
  const isRevenue = legacyType === "revenue";

  if (isProportion) {
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (isRevenue) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(
    value,
  );
}

function relCi(m: SnapshotMetric): [number, number] | undefined {
  const ci = m.ciAdjusted ?? m.ci;
  return ci ? [ci[0] * 100, ci[1] * 100] : undefined;
}

function isSignificant(m: SnapshotMetric): boolean {
  const p = m.pValueAdjusted ?? m.pValue;
  if (p !== undefined) return p < SIG_THRESHOLD;
  if (m.chanceToWin !== undefined) {
    return m.chanceToWin >= 0.95 || m.chanceToWin <= 0.05;
  }
  return false;
}

function deriveState(
  experiment: ExperimentInterface,
  srmPValue: number | undefined,
): CardState {
  if (experiment.status === "draft") return "started";
  if (
    experiment.status === "running" &&
    srmPValue !== undefined &&
    srmPValue < SRM_P_THRESHOLD
  ) {
    return "warning";
  }
  if (experiment.status === "running") return "running";
  if (experiment.results === "won") return "winner";
  if (experiment.results === "lost") return "loser";
  return "stopped";
}

/**
 * Build the Slack card model for an experiment. Returns null if the experiment
 * doesn't exist. Draft experiments render the "started" layout (hypothesis +
 * metric list); everything else pulls numbers from the latest snapshot.
 */
export async function buildExperimentCardData(
  context: Context,
  experimentId: string,
): Promise<ExperimentCardData | null> {
  const experiment = await getExperimentById(context, experimentId);
  if (!experiment) return null;

  const latestPhase = experiment.phases[experiment.phases.length - 1];
  const goalId = experiment.goalMetrics[0];
  const goalMetric = goalId
    ? await getExperimentMetricById(context, goalId)
    : null;

  const dsName = experiment.datasource
    ? (await getDataSourceById(context, experiment.datasource))?.name
    : undefined;

  const startDate = latestPhase?.dateStarted
    ? new Date(latestPhase.dateStarted)
    : undefined;
  const endDate = latestPhase?.dateEnded
    ? new Date(latestPhase.dateEnded)
    : undefined;

  const base = {
    name: experiment.name,
    key: experiment.trackingKey || experiment.id,
    goal: goalMetric?.name || "Goal metric",
    variants: experiment.variations.map((v) => v.name),
    tags: experiment.tags,
    ds: dsName,
  };

  // Draft → "started": no results yet.
  if (experiment.status === "draft") {
    const nameFor = async (ids: string[]) =>
      (
        await Promise.all(
          ids.map(
            async (id) => (await getExperimentMetricById(context, id))?.name,
          ),
        )
      ).filter((n): n is string => !!n);
    return {
      ...base,
      state: "started",
      hypothesis: experiment.hypothesis || "",
      metrics: {
        goal: goalMetric?.name || "Goal metric",
        secondary: await nameFor(experiment.secondaryMetrics || []),
        guardrail: await nameFor(experiment.guardrailMetrics || []),
      },
      dates: startDate ? `Created ${fmtDate(startDate)}` : undefined,
      rows: [],
    };
  }

  // Running / stopped → pull from the latest snapshot.
  let snapshot: ExperimentSnapshotInterface | null = null;
  try {
    snapshot = await getLatestSuccessfulSnapshot({
      context,
      experiment: experiment.id,
      phase: experiment.phases.length - 1,
    });
  } catch (e) {
    logger.warn(e, "Slack card: failed to load snapshot");
  }
  const analysis = snapshot ? getSnapshotAnalysis(snapshot) : null;
  const dim = analysis?.results?.[0];
  const srmPValue = dim?.srm;

  const state = deriveState(experiment, srmPValue);

  const goalRows: CardGoalRow[] = [];
  if (dim && goalId) {
    for (let i = 1; i < experiment.variations.length; i++) {
      const cm = dim.variations[0]?.metrics?.[goalId];
      const vm = dim.variations[i]?.metrics?.[goalId];
      if (!vm) continue;
      const upliftPct = (vm.expected ?? 0) * 100;
      const ci = relCi(vm);
      const ciLo = ci ? ci[0] : upliftPct;
      const ciHi = ci ? ci[1] : upliftPct;
      const spread =
        vm.uplift?.stddev !== undefined
          ? vm.uplift.stddev * 100
          : Math.max(0.5, (ciHi - ciLo) / 3.92);
      goalRows.push({
        v: experiment.variations[i]?.name || `Variation ${i}`,
        i,
        ctrl: formatMetricValue(goalMetric, cm),
        vr: formatMetricValue(goalMetric, vm),
        cn: compact(cm?.users),
        vn: compact(vm?.users),
        ctw:
          vm.chanceToWin !== undefined
            ? `${(vm.chanceToWin * 100).toFixed(1)}%`
            : undefined,
        chg: pct(upliftPct),
        dir: upliftPct >= 0 ? "up" : "down",
        vio: { c: upliftPct, s: Math.max(0.3, spread) },
        ...(ci ? { ci: { lo: ciLo, hi: ciHi, pt: upliftPct } } : {}),
        muted: state === "warning",
      });
    }
  }

  // Secondary / guardrail rows use the first treatment variation (index 1).
  const ciMetricRow = async (
    metricId: string,
  ): Promise<CardCiMetric | null> => {
    const vm = dim?.variations[1]?.metrics?.[metricId];
    const cm = dim?.variations[0]?.metrics?.[metricId];
    if (!vm) return null;
    const metric = await getExperimentMetricById(context, metricId);
    const upliftPct = (vm.expected ?? 0) * 100;
    const ci = relCi(vm);
    return {
      name: metric?.name || metricId,
      ctrl: formatMetricValue(metric, cm),
      vr: formatMetricValue(metric, vm),
      chg: pct(upliftPct),
      dir: upliftPct >= 0 ? "up" : "down",
      ci: {
        lo: ci ? ci[0] : upliftPct,
        hi: ci ? ci[1] : upliftPct,
        pt: upliftPct,
      },
      sig: isSignificant(vm),
    };
  };

  const secondary = (
    await Promise.all(
      (experiment.secondaryMetrics || [])
        .slice(0, MAX_SECONDARY)
        .map(ciMetricRow),
    )
  ).filter((m): m is CardCiMetric => !!m);
  const guardrail = (
    await Promise.all(
      (experiment.guardrailMetrics || [])
        .slice(0, MAX_GUARDRAIL)
        .map(ciMetricRow),
    )
  ).filter((m): m is CardCiMetric => !!m);

  const totalUsers = dim
    ? dim.variations.reduce((sum, v) => sum + (v.users || 0), 0)
    : undefined;

  const now = new Date();
  const days = startDate
    ? `Day ${daysBetween(startDate, endDate || now)}${
        experiment.status === "stopped" ? " · stopped" : ""
      }`
    : undefined;
  const dates = startDate
    ? experiment.status === "stopped" && endDate
      ? `${fmtDate(startDate)} – ${fmtDate(endDate)}`
      : `Started ${fmtDate(startDate)}`
    : undefined;

  const srm =
    state === "warning" && dim
      ? `Observed split deviates from configuration`
      : undefined;

  // Health is orthogonal to status. SRM is already surfaced by the "warning"
  // card, so only add it here when the card isn't already a warning (e.g. SRM on
  // a stopped experiment). Multiple exposures / unknown variations are always
  // health issues regardless of state.
  const healthIssues: [string, string][] = [];
  if (
    state !== "warning" &&
    srmPValue !== undefined &&
    srmPValue < SRM_P_THRESHOLD
  ) {
    healthIssues.push([
      "Sample Ratio Mismatch",
      "observed traffic split deviates from the configured split",
    ]);
  }
  if (snapshot && snapshot.multipleExposures > 0) {
    healthIssues.push([
      "Multiple exposures",
      `${compact(snapshot.multipleExposures)} users saw more than one variation`,
    ]);
  }
  if (snapshot && snapshot.unknownVariations.length > 0) {
    healthIssues.push([
      "Unknown variations",
      "traffic seen for variation ids not in the experiment config",
    ]);
  }

  // The written analysis is only meaningful for completed experiments — show it
  // for stopped experiments that have one.
  const conclusion =
    experiment.status === "stopped" && experiment.analysis?.trim()
      ? { text: experiment.analysis.trim() }
      : undefined;

  // The winning variation's 0-based index (control = 0), from the recorded
  // winner index, falling back to the released variation id. The compact card
  // matches the goal row by this index (names can collide) and names the winner.
  const winningVariationIndex =
    state === "winner"
      ? typeof experiment.winner === "number"
        ? experiment.winner
        : experiment.releasedVariationId
          ? experiment.variations.findIndex(
              (v) => v.id === experiment.releasedVariationId,
            )
          : -1
      : -1;
  const winningVariation =
    winningVariationIndex >= 0
      ? experiment.variations[winningVariationIndex]?.name
      : undefined;

  return {
    ...base,
    state,
    rows: goalRows,
    secondary,
    guardrail,
    users: compact(totalUsers),
    days,
    dates,
    ...(winningVariation ? { winningVariation } : {}),
    ...(winningVariationIndex >= 0 ? { winningVariationIndex } : {}),
    ...(experiment.hypothesis ? { hypothesis: experiment.hypothesis } : {}),
    ...(conclusion ? { conclusion } : {}),
    ...(healthIssues.length
      ? { health: { status: "unhealthy" as const, issues: healthIssues } }
      : {}),
    ...(srm ? { srm, p: `p < ${SRM_P_THRESHOLD}` } : {}),
    ...(state === "warning"
      ? {
          note: "Sample Ratio Mismatch — traffic is not splitting as configured. Results are unreliable until fixed.",
        }
      : {}),
  };
}
