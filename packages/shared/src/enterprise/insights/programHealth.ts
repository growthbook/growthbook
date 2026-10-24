import { getLatestPhaseVariations } from "shared/experiments";
import { DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION } from "shared/constants";
import { ExperimentHealthSettings } from "shared/types/experiment";
import { computeSrmAndMultipleExposuresUnhealthyData } from "../decision-criteria/decisionCriteria";
import {
  ExperimentQualityScoreResult,
  QUALITY_CHECK_PASS_THRESHOLD,
} from "../experimentQualityScore";
import {
  InsightsExperiment,
  InsightsWindow,
  filterCompletedExperiments,
  getExperimentResultDate,
} from "./completedExperiments";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44;
const STALE_DAYS = 14;
const STUCK_DRAFT_DAYS = 30;
const DURATION_BIN_DAYS = 7;
const DURATION_BINS = 12;
const MAX_ATTENTION_ITEMS = 20;

// Below this many completed experiments a score is too noisy to show
export const HEALTH_MIN_COMPLETED = 5;
export const WIN_RATE_HEALTHY_RANGE: [number, number] = [0.2, 0.3];
// A program that started nothing in the period can't score above "At risk"
export const NO_STARTS_SCORE_CAP = 59;

export type GetQuality = (
  experiment: InsightsExperiment,
) => ExperimentQualityScoreResult | null;

export type HealthBand = "strong" | "healthy" | "needs-attention" | "at-risk";
export const HEALTH_BAND_LABELS: Record<HealthBand, string> = {
  strong: "Strong",
  healthy: "Healthy",
  "needs-attention": "Needs attention",
  "at-risk": "At risk",
};

export function getHealthBand(score: number): HealthBand {
  if (score >= 90) return "strong";
  if (score >= 75) return "healthy";
  if (score >= 60) return "needs-attention";
  return "at-risk";
}

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const date = new Date(d);
  return isNaN(date.getTime()) ? null : date;
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Velocity counts the first start only; restarts are tracked separately
export function getFirstStartDate(e: InsightsExperiment): Date | null {
  const starts = e.phases
    .map((p) => toDate(p.dateStarted))
    .filter((d): d is Date => d !== null);
  return starts.length
    ? new Date(Math.min(...starts.map((d) => d.getTime())))
    : null;
}

export function countRestarts(e: InsightsExperiment): number {
  return Math.max(e.phases.length - 1, 0);
}

function inWindow(d: Date | null, { startDate, endDate }: InsightsWindow) {
  return !!d && d >= startDate && d <= endDate;
}

function getHealthFlags(
  e: InsightsExperiment,
  healthSettings: ExperimentHealthSettings,
) {
  const health = e.analysisSummary?.health;
  const lowPowered =
    health?.power?.type === "success" ? health.power.isLowPowered : null;
  if (!health?.totalUsers) {
    return {
      hasTraffic: false,
      srm: false,
      multipleExposures: false,
      lowPowered,
    };
  }
  const unhealthy = computeSrmAndMultipleExposuresUnhealthyData({
    srm: health.srm,
    multipleExposures: health.multipleExposures,
    totalUsers: health.totalUsers,
    numOfVariations: getLatestPhaseVariations(e).length,
    minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    healthSettings,
  });
  return {
    hasTraffic: true,
    srm: !!unhealthy.srm,
    multipleExposures: !!unhealthy.multipleExposures,
    lowPowered,
  };
}

export type QualityIssue = { key: string; label: string; count: number };

// The quality checks completed experiments fail most often
export function getQualityIssues(
  experiments: InsightsExperiment[],
  getQuality: GetQuality,
): QualityIssue[] {
  const issues = new Map<string, QualityIssue>();
  experiments.forEach((e) => {
    getQuality(e)?.sections.forEach((section) =>
      section.checks.forEach((check) => {
        if (
          !check.applicable ||
          check.score === null ||
          check.score >= QUALITY_CHECK_PASS_THRESHOLD
        ) {
          return;
        }
        const issue = issues.get(check.key) ?? {
          key: check.key,
          label: check.label,
          count: 0,
        };
        issue.count += 1;
        issues.set(check.key, issue);
      }),
    );
  });
  return [...issues.values()].sort((a, b) => b.count - a.count);
}

export type ScopeHealth = {
  completed: number;
  won: number;
  started: number;
  // Experiments started per month
  startRate: number;
  winRate: number | null;
  // Average quality score of completed experiments; null when none are scored
  quality: number | null;
  healthyRate: number | null;
  // Completed experiments with each kind of health error
  healthErrors: { srm: number; multipleExposures: number; lowPowered: number };
  // Null below HEALTH_MIN_COMPLETED completed experiments
  score: number | null;
  openSrmAlerts: number;
  topQualityIssue: string | null;
};

function countStarts(
  experiments: InsightsExperiment[],
  window: InsightsWindow,
) {
  return experiments.filter((e) => inWindow(getFirstStartDate(e), window))
    .length;
}

function months({ startDate, endDate }: InsightsWindow) {
  return Math.max(daysBetween(startDate, endDate) / DAYS_PER_MONTH, 1 / 30);
}

// Score: mean of quality and healthy rate (healthy rate alone without quality scores)
export function computeScopeHealth({
  experiments,
  window,
  healthSettings,
  getQuality,
}: {
  experiments: InsightsExperiment[];
  window: InsightsWindow;
  healthSettings: ExperimentHealthSettings;
  getQuality: GetQuality;
}): ScopeHealth {
  const standard = experiments.filter((e) => e.type !== "multi-armed-bandit");
  const completed = filterCompletedExperiments(standard, {
    ...window,
    projects: [],
  });
  const started = countStarts(standard, window);

  const qualityScores = completed.flatMap((e) => {
    const score = getQuality(e)?.score;
    return score === null || score === undefined ? [] : [score];
  });
  const quality = qualityScores.length
    ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
    : null;

  const won = completed.filter((e) => e.results === "won").length;
  const healthErrors = { srm: 0, multipleExposures: 0, lowPowered: 0 };
  const healthy = completed.filter((e) => {
    const flags = getHealthFlags(e, healthSettings);
    if (flags.srm) healthErrors.srm += 1;
    if (flags.multipleExposures) healthErrors.multipleExposures += 1;
    // Most experiments have no power target, so only a known miss counts
    if (flags.lowPowered === true) healthErrors.lowPowered += 1;
    return !flags.srm && !flags.multipleExposures && flags.lowPowered !== true;
  }).length;
  const healthyRate = completed.length ? healthy / completed.length : null;
  const blended =
    healthyRate === null
      ? null
      : quality === null
        ? healthyRate * 100
        : (quality + healthyRate * 100) / 2;

  return {
    completed: completed.length,
    won,
    started,
    startRate: started / months(window),
    winRate: completed.length ? won / completed.length : null,
    quality,
    healthyRate,
    healthErrors,
    score:
      completed.length < HEALTH_MIN_COMPLETED || blended === null
        ? null
        : Math.round(
            started > 0 ? blended : Math.min(blended, NO_STARTS_SCORE_CAP),
          ),
    openSrmAlerts: standard.filter(
      (e) =>
        e.status === "running" &&
        !e.archived &&
        getHealthFlags(e, healthSettings).srm,
    ).length,
    topQualityIssue: getQualityIssues(completed, getQuality)[0]?.label ?? null,
  };
}

export type ProjectHealth = { project: string; health: ScopeHealth };

export function computeHealthByProject({
  experiments,
  ...rest
}: Parameters<typeof computeScopeHealth>[0]): ProjectHealth[] {
  const byProject = new Map<string, InsightsExperiment[]>();
  experiments.forEach((e) => {
    const project = e.project ?? "";
    byProject.set(project, [...(byProject.get(project) ?? []), e]);
  });
  return [...byProject.entries()].map(([project, exps]) => ({
    project,
    health: computeScopeHealth({ experiments: exps, ...rest }),
  }));
}

// The organization's score: project scores weighted by completed experiments
export function combineProjectScores(rows: ProjectHealth[]): number | null {
  const scored = rows.filter((r) => r.health.score !== null);
  const weight = scored.reduce((acc, r) => acc + r.health.completed, 0);
  if (!weight) return null;
  return Math.round(
    scored.reduce(
      (acc, r) => acc + (r.health.score ?? 0) * r.health.completed,
      0,
    ) / weight,
  );
}

export type HealthRatio = { count: number; total: number };

export type AttentionItem = {
  type: "SRM" | "Power" | "Stale" | "Draft";
  id: string;
  name: string;
  owner: string;
  since: Date;
};

export type HealthDetails = {
  monthlyStarts: { month: Date; count: number }[];
  runningNow: number;
  cycle: {
    medianDraftDays: number | null;
    medianRunDays: number | null;
    // Completed experiments per 7-day run-length bin; the last bin is open-ended
    durationBins: number[];
    medianBin: number | null;
    stuckDrafts: number;
    longestRunDays: number | null;
  };
  stability: {
    clean: number;
    restarted: number;
    dnf: number;
    mostRestarted: { id: string; name: string; restarts: number }[];
  };
  diagnostics: {
    srm: HealthRatio;
    power: HealthRatio;
    hypothesis: HealthRatio;
    endedEarly: HealthRatio;
  };
  attention: AttentionItem[];
  qualityIssues: QualityIssue[];
};

/** Diagnostics for the Health page's charts and lists. */
export function computeHealthDetails({
  experiments,
  window,
  healthSettings,
  getQuality,
  now = new Date(),
}: {
  experiments: InsightsExperiment[];
  window: InsightsWindow;
  healthSettings: ExperimentHealthSettings;
  getQuality: GetQuality;
  now?: Date;
}): HealthDetails {
  const standard = experiments.filter((e) => e.type !== "multi-armed-bandit");
  const live = standard.filter((e) => !e.archived);
  const completed = filterCompletedExperiments(standard, {
    ...window,
    projects: [],
  });

  const end = window.endDate;
  const monthlyStarts = Array.from({ length: 6 }, (_, i) => {
    const month = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5 + i, 1),
    );
    const next = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
    );
    return {
      month,
      count: countStarts(standard, {
        startDate: month,
        endDate: new Date(next.getTime() - 1),
      }),
    };
  });

  const runs = completed.flatMap((e) => {
    const start = getFirstStartDate(e);
    const stop = getExperimentResultDate(e);
    return start && stop ? [daysBetween(start, stop)] : [];
  });
  const drafts = completed.flatMap((e) => {
    const start = getFirstStartDate(e);
    const created = toDate(e.dateCreated);
    return start && created ? [Math.max(daysBetween(created, start), 0)] : [];
  });
  const binOf = (days: number) =>
    Math.min(Math.floor(days / DURATION_BIN_DAYS), DURATION_BINS - 1);
  const durationBins = Array.from({ length: DURATION_BINS }, () => 0);
  runs.forEach((days) => (durationBins[binOf(days)] += 1));
  const medianRunDays = median(runs);

  const isStuckDraft = (e: InsightsExperiment) => {
    const created = toDate(e.dateCreated);
    return (
      e.status === "draft" &&
      !!created &&
      daysBetween(created, now) > STUCK_DRAFT_DAYS
    );
  };

  const stability = { clean: 0, restarted: 0, dnf: 0 };
  completed.forEach((e) => {
    if (e.results === "dnf") stability.dnf += 1;
    else if (countRestarts(e) > 0) stability.restarted += 1;
    else stability.clean += 1;
  });
  const mostRestarted = [
    ...completed,
    ...live.filter((e) => e.status === "running"),
  ]
    .filter((e) => countRestarts(e) > 0)
    .sort((a, b) => countRestarts(b) - countRestarts(a))
    .slice(0, 5)
    .map((e) => ({ id: e.id, name: e.name, restarts: countRestarts(e) }));

  const flags = new Map(
    standard.map((e) => [e.id, getHealthFlags(e, healthSettings)]),
  );
  const ratio = (
    items: InsightsExperiment[],
    pass: (e: InsightsExperiment) => boolean,
  ): HealthRatio => ({
    count: items.filter(pass).length,
    total: items.length,
  });

  const lastPhaseStart = (e: InsightsExperiment) =>
    toDate(e.phases[e.phases.length - 1]?.dateStarted) ?? now;
  const attention: AttentionItem[] = live.flatMap((e): AttentionItem[] => {
    const item = { id: e.id, name: e.name, owner: e.owner ?? "" };
    if (e.status === "draft") {
      return isStuckDraft(e)
        ? [{ ...item, type: "Draft", since: toDate(e.dateCreated) ?? now }]
        : [];
    }
    if (e.status !== "running") return [];
    const f = flags.get(e.id);
    const items: AttentionItem[] = [];
    if (f?.srm) items.push({ ...item, type: "SRM", since: lastPhaseStart(e) });
    if (f?.lowPowered) {
      items.push({ ...item, type: "Power", since: lastPhaseStart(e) });
    }
    const lastUpdate = toDate(e.lastSnapshotAttempt) ?? lastPhaseStart(e);
    if (daysBetween(lastUpdate, now) > STALE_DAYS) {
      items.push({ ...item, type: "Stale", since: lastUpdate });
    }
    return items;
  });
  const typeOrder: AttentionItem["type"][] = ["SRM", "Power", "Stale", "Draft"];
  attention.sort(
    (a, b) =>
      typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) ||
      a.since.getTime() - b.since.getTime(),
  );

  return {
    monthlyStarts,
    runningNow: live.filter((e) => e.status === "running").length,
    cycle: {
      medianDraftDays: median(drafts),
      medianRunDays,
      durationBins,
      medianBin: medianRunDays === null ? null : binOf(medianRunDays),
      stuckDrafts: live.filter(isStuckDraft).length,
      longestRunDays: runs.length ? Math.max(...runs) : null,
    },
    stability: { ...stability, mostRestarted },
    diagnostics: {
      srm: ratio(
        completed.filter((e) => flags.get(e.id)?.hasTraffic),
        (e) => !flags.get(e.id)?.srm,
      ),
      power: ratio(
        completed.filter((e) => (flags.get(e.id)?.lowPowered ?? null) !== null),
        (e) => flags.get(e.id)?.lowPowered === false,
      ),
      hypothesis: ratio(completed, (e) => !!e.hypothesis?.trim()),
      endedEarly: ratio(completed, (e) => e.results === "dnf"),
    },
    attention: attention.slice(0, MAX_ATTENTION_ITEMS),
    qualityIssues: getQualityIssues(completed, getQuality),
  };
}
