import { getSnapshotAnalysis } from "shared/util";
import cloneDeep from "lodash/cloneDeep";
import {
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
} from "shared/constants";
import { getHealthSettings } from "shared/enterprise";
import {
  getBanditSRMValue,
  getExperimentSRMValue,
  getMultipleExposureHealthData,
  getSRMHealthData,
} from "shared/health";
import {
  type ExperimentMetricInterface,
  parseFunnelStepMetricId,
  parseSliceMetricId,
  isFactFunnelMetric,
  getFunnelStepMetric,
  expandMetricGroups,
  isMetricGroupId,
  getLatestPhaseVariations,
  getMetricResultStatus,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
} from "shared/experiments";
import type { ExperimentInterface } from "shared/types/experiment";
import type {
  SnapshotMetric,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import type { Context } from "back-end/src/models/BaseModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentMetricsByIds } from "back-end/src/services/experiments";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { logger } from "back-end/src/util/logger";
import {
  getMetricDefaultsForOrg,
  getSignificanceSettingsForProject,
} from "back-end/src/services/organizations";
import type {
  CardCiMetric,
  CardGoalRow,
  CardState,
  ExperimentCardData,
} from "back-end/src/services/notificationCards/cardImages";

// Maps a GrowthBook experiment + its latest results snapshot into the compact
// card model consumed by notification renderers. Numbers come straight off the
// snapshot's default analysis; `expected`/`ci` are fractional relative
// uplift (matching the front-end results graph), so we scale to % for the card.

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

// Best-effort value formatting from the metric type. Not as exhaustive as the
// front-end's getExperimentMetricFormatter (which lives in the front-end), but
// covers the common proportion / currency / count cases.
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

function deriveState(
  experiment: ExperimentInterface,
  hasSrm: boolean,
): CardState {
  if (experiment.status === "draft") return "started";
  if (experiment.status === "running" && hasSrm) {
    return "warning";
  }
  if (experiment.status === "running") return "running";
  // stopped
  if (experiment.results === "won") return "winner";
  if (experiment.results === "lost") return "loser";
  return "stopped";
}

/**
 * Build the notification card model for an experiment. Returns null if the experiment
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
  const metricGroups = [
    ...experiment.goalMetrics,
    ...(experiment.secondaryMetrics ?? []),
    ...(experiment.guardrailMetrics ?? []),
  ].some(isMetricGroupId)
    ? await context.models.metricGroups.getAll()
    : [];
  const goalIds = expandMetricGroups(experiment.goalMetrics, metricGroups);
  const goalId = goalIds[0];
  const secondaryIds = expandMetricGroups(
    experiment.secondaryMetrics ?? [],
    metricGroups,
  ).slice(0, experiment.status === "draft" ? undefined : MAX_SECONDARY);
  const guardrailIds = expandMetricGroups(
    experiment.guardrailMetrics ?? [],
    metricGroups,
  ).slice(0, experiment.status === "draft" ? undefined : MAX_GUARDRAIL);
  const baseId = (id: string): string =>
    parseSliceMetricId(parseFunnelStepMetricId(id).baseMetricId).baseMetricId;
  const ids = [
    ...new Set(
      [...(goalId ? [goalId] : []), ...secondaryIds, ...guardrailIds].map(
        baseId,
      ),
    ),
  ];
  const metrics = ids.length
    ? await getExperimentMetricsByIds(context, ids)
    : [];
  const metricMap = new Map(metrics.map((metric) => [metric.id, metric]));
  const metricFor = (id: string): ExperimentMetricInterface | null => {
    const metric = metricMap.get(baseId(id)) ?? null;
    const step = parseFunnelStepMetricId(id);
    return step.isFunnelStepMetric && step.stepIndex !== null
      ? metric && isFactFunnelMetric(metric)
        ? getFunnelStepMetric(metric, step.stepIndex)
        : null
      : metric;
  };
  const goalMetric = goalId ? metricFor(goalId) : null;

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
    const nameFor = (ids: string[]) =>
      ids.map((id) => metricFor(id)?.name).filter((n): n is string => !!n);
    return {
      ...base,
      state: "started",
      hypothesis: experiment.hypothesis || "",
      metrics: {
        goal: goalMetric?.name || "Goal metric",
        secondary: nameFor(secondaryIds),
        guardrail: nameFor(guardrailIds),
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
      type: "standard",
    });
  } catch (e) {
    logger.warn(e, "Notification card: failed to load snapshot");
  }
  const analysis = snapshot ? getSnapshotAnalysis(snapshot) : null;
  const { ciUpper, ciLower, pValueThreshold, pValueCorrection } =
    await getSignificanceSettingsForProject(context, experiment.project);
  const metricDefaults = getMetricDefaultsForOrg(context);
  const healthSettings = getHealthSettings(context.org.settings);
  const results = cloneDeep(analysis?.results ?? []);
  setAdjustedPValuesOnResults(results, goalIds, pValueCorrection);
  setAdjustedCIs(results, pValueThreshold);
  const dim = results[0];
  const traffic = snapshot?.health?.traffic?.overall;
  const totalUsers = traffic?.variationUnits.length
    ? traffic.variationUnits.reduce((sum, users) => sum + users, 0)
    : dim && results.length === 1
      ? dim.variations.reduce(
          (sum, variation) => sum + (variation.users || 0),
          0,
        )
      : undefined;
  const srmPValue = snapshot
    ? experiment.type === "multi-armed-bandit"
      ? getBanditSRMValue(snapshot)
      : getExperimentSRMValue(snapshot)
    : undefined;
  const hasSrm =
    srmPValue !== undefined &&
    getSRMHealthData({
      srm: srmPValue,
      srmThreshold: healthSettings.srmThreshold,
      totalUsersCount: totalUsers ?? 0,
      numOfVariations: getLatestPhaseVariations(experiment).length,
      minUsersPerVariation:
        experiment.type === "multi-armed-bandit"
          ? DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION
          : DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    }) === "unhealthy";
  const state = deriveState(experiment, hasSrm);

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
        ...(vm.uplift?.stddev !== undefined
          ? { vio: { c: upliftPct, s: Math.max(0.3, vm.uplift.stddev * 100) } }
          : {}),
        ...(ci ? { ci: { lo: ciLo, hi: ciHi, pt: upliftPct } } : {}),
        muted: state === "warning",
      });
    }
  }

  // Secondary / guardrail rows use the first treatment variation (index 1).
  const ciMetricRow = (metricId: string): CardCiMetric | null => {
    const vm = dim?.variations[1]?.metrics?.[metricId];
    const cm = dim?.variations[0]?.metrics?.[metricId];
    if (!vm) return null;
    const metric = metricFor(metricId);
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
      sig:
        metric &&
        cm &&
        analysis &&
        (analysis.settings.statsEngine !== "bayesian" ||
          vm.chanceToWin !== undefined)
          ? getMetricResultStatus({
              metric,
              metricDefaults,
              baseline: cm,
              stats: vm,
              ciLower,
              ciUpper,
              pValueThreshold,
              statsEngine: analysis.settings.statsEngine,
              differenceType: analysis.settings.differenceType,
            }).significant
          : false,
    };
  };

  const secondary = secondaryIds
    .map(ciMetricRow)
    .filter((m): m is CardCiMetric => !!m);
  const guardrail = guardrailIds
    .map(ciMetricRow)
    .filter((m): m is CardCiMetric => !!m);

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

  // Health is orthogonal to status. SRM is already surfaced by the dedicated
  // "warning" card, so only add it here when the card isn't already a warning
  // (e.g. an SRM on a stopped experiment). Multiple exposures and unknown
  // variations are always health issues regardless of state.
  const healthIssues: [string, string][] = [];
  if (state !== "warning" && hasSrm) {
    healthIssues.push([
      "Sample Ratio Mismatch",
      "observed traffic split deviates from the configured split",
    ]);
  }
  if (
    snapshot &&
    getMultipleExposureHealthData({
      multipleExposuresCount: snapshot.multipleExposures,
      totalUsersCount: totalUsers ?? 0,
      minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
      minPercentThreshold: healthSettings.multipleExposureMinPercent,
    }).status === "unhealthy"
  ) {
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

  // Conclusion (the written analysis) is only meaningful for completed
  // experiments — show it for stopped experiments that have one.
  const conclusion =
    experiment.status === "stopped" && experiment.analysis?.trim()
      ? { text: experiment.analysis.trim() }
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
    ...(experiment.hypothesis ? { hypothesis: experiment.hypothesis } : {}),
    ...(conclusion ? { conclusion } : {}),
    ...(healthIssues.length
      ? { health: { status: "unhealthy" as const, issues: healthIssues } }
      : {}),
    ...(srm ? { srm, p: `p < ${healthSettings.srmThreshold}` } : {}),
    ...(state === "warning"
      ? {
          note: "Sample Ratio Mismatch — traffic is not splitting as configured. Results are unreliable until fixed.",
        }
      : {}),
  };
}
