import { format } from "date-fns";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ResolvedGranularity } from "@/enterprise/components/ProductAnalytics/util";

// Result buckets used by the velocity (stacked-bar) chart. Matches the four
// categories the Executive Report renders.
export const VELOCITY_RESULT_KEYS = [
  "won",
  "lost",
  "inconclusive",
  "dnf",
] as const;
export type VelocityResultKey = (typeof VELOCITY_RESULT_KEYS)[number];

export type Window = { startDate: Date; endDate: Date };

/**
 * Human-readable label for a date window, e.g. "Jan 1, 2026 – Feb 1, 2026".
 * Shared by the Win Percentage and Team Velocity blocks so the compare-mode
 * period labels stay formatted the same way.
 */
export function rangeLabel({ startDate, endDate }: Window): string {
  return `${format(startDate, "MMM d, yyyy")} – ${format(
    endDate,
    "MMM d, yyyy",
  )}`;
}

export type VelocityBucket = {
  // Bucket start, floored to the granularity.
  date: Date;
  won: number;
  lost: number;
  inconclusive: number;
  dnf: number;
  total: number;
};

// Overall win/loss summary for the gauge + the "All Projects" table row.
export type WinRateSummary = {
  wins: number;
  losses: number;
  other: number;
  total: number;
  winRate: number; // 0-100
};

export type WinRateProjectRow = WinRateSummary & {
  id: string;
  name: string;
};

/**
 * The date an experiment "completed", using the same rule as the Executive
 * Report: the most recent "Main" phase end, falling back to the most recent
 * phase end. Returns null when no phase has ended.
 */
export function getExperimentResultDate(
  experiment: ExperimentInterfaceStringDates,
): Date | null {
  const sortByEndedDesc = (
    a: { dateEnded?: string },
    b: { dateEnded?: string },
  ) =>
    new Date(b.dateEnded || 0).getTime() - new Date(a.dateEnded || 0).getTime();

  const mainPhase = experiment.phases
    .filter((p) => p.name === "Main")
    .sort(sortByEndedDesc)[0];
  const usedPhase =
    mainPhase ?? [...experiment.phases].sort(sortByEndedDesc)[0];

  if (!usedPhase?.dateEnded) return null;
  return new Date(usedPhase.dateEnded);
}

// A stopped experiment's result bucket. Anything that isn't an explicit
// won/lost/dnf is treated as inconclusive (matches ExecExperimentsGraph).
export function classifyVelocityResult(
  experiment: ExperimentInterfaceStringDates,
): VelocityResultKey {
  const result = experiment.results;
  if (result === "won" || result === "lost" || result === "dnf") return result;
  return "inconclusive";
}

/**
 * Filter the org's experiments to the completed set inside a window, matching
 * useCompletedExperiments: standard (non-bandit), stopped, project-scoped, with
 * a result date (getExperimentResultDate: most recent Main phase end, falling
 * back to the most recent phase end) inside [startDate, endDate].
 *
 * Using the single result date — rather than "any phase ended in-window" —
 * keeps this filter consistent with bucketVelocity, so the Win Percentage and
 * Team Velocity blocks count exactly the same experiments for a given window.
 */
export function filterCompletedExperiments(
  experiments: ExperimentInterfaceStringDates[],
  { startDate, endDate, projects }: Window & { projects: string[] },
): ExperimentInterfaceStringDates[] {
  return experiments
    .filter((e) => e.type !== "multi-armed-bandit")
    .filter((e) => e.status === "stopped")
    .filter(
      (e) =>
        projects.length === 0 ||
        (e.project ? projects.includes(e.project) : false),
    )
    .filter((e) => {
      const resultDate = getExperimentResultDate(e);
      if (!resultDate) return false;
      return resultDate >= startDate && resultDate <= endDate;
    });
}

/**
 * The equal-length window immediately preceding the current one (span-shift).
 * Mirrors buildComparisonDateRange for rolling windows so compare math lines up
 * with the rest of the dashboard.
 *
 * The previous window ends 1ms before the current window starts so the two
 * windows never share an instant — an experiment ending exactly at the current
 * start is counted in the current window only, never double-counted.
 */
export function getPreviousWindow({ startDate, endDate }: Window): Window {
  const spanMs = endDate.getTime() - startDate.getTime();
  return {
    startDate: new Date(startDate.getTime() - spanMs),
    endDate: new Date(startDate.getTime() - 1),
  };
}

// Floor a date to the start of its bucket for the given granularity. Uses local
// time to match how the buckets are labeled.
export function floorToGranularity(
  date: Date,
  granularity: ResolvedGranularity,
): Date {
  const d = new Date(date);
  switch (granularity) {
    case "year":
      return new Date(d.getFullYear(), 0, 1);
    case "month":
      return new Date(d.getFullYear(), d.getMonth(), 1);
    case "week": {
      // Week starts on Sunday.
      const day = d.getDay();
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      start.setDate(start.getDate() - day);
      return start;
    }
    case "hour":
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());
    case "day":
    default:
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
}

// Advance a bucket-start date to the next bucket for the granularity.
function advanceBucket(date: Date, granularity: ResolvedGranularity): Date {
  const d = new Date(date);
  switch (granularity) {
    case "year":
      d.setFullYear(d.getFullYear() + 1);
      return d;
    case "month":
      d.setMonth(d.getMonth() + 1);
      return d;
    case "week":
      d.setDate(d.getDate() + 7);
      return d;
    case "hour":
      d.setHours(d.getHours() + 1);
      return d;
    case "day":
    default:
      d.setDate(d.getDate() + 1);
      return d;
  }
}

/**
 * Bucket completed experiments into won/lost/inconclusive/dnf counts per time
 * bucket. Emits an entry for every bucket in the window (including empties) so
 * the x-axis is continuous.
 */
export function bucketVelocity(
  experiments: ExperimentInterfaceStringDates[],
  { startDate, endDate }: Window,
  granularity: ResolvedGranularity,
): VelocityBucket[] {
  const buckets: VelocityBucket[] = [];
  const indexByKey = new Map<number, number>();

  // Pre-seed empty buckets across the window.
  let cursor = floorToGranularity(startDate, granularity);
  const lastBucketStart = floorToGranularity(endDate, granularity);
  // Guard against pathological ranges producing an unbounded loop.
  let guard = 0;
  while (cursor.getTime() <= lastBucketStart.getTime() && guard < 100000) {
    indexByKey.set(cursor.getTime(), buckets.length);
    buckets.push({
      date: new Date(cursor),
      won: 0,
      lost: 0,
      inconclusive: 0,
      dnf: 0,
      total: 0,
    });
    cursor = advanceBucket(cursor, granularity);
    guard++;
  }

  experiments.forEach((experiment) => {
    const resultDate = getExperimentResultDate(experiment);
    if (!resultDate) return;
    if (resultDate < startDate || resultDate > endDate) return;
    const key = floorToGranularity(resultDate, granularity).getTime();
    const idx = indexByKey.get(key);
    if (idx === undefined) return;
    const bucket = buckets[idx];
    const result = classifyVelocityResult(experiment);
    bucket[result] += 1;
    bucket.total += 1;
  });

  return buckets;
}

// Overall win/loss/other summary across a set of completed experiments.
export function computeWinRateSummary(
  experiments: ExperimentInterfaceStringDates[],
): WinRateSummary {
  let wins = 0;
  let losses = 0;
  experiments.forEach((exp) => {
    if (exp.status !== "stopped") return;
    if (exp.results === "won") wins += 1;
    else if (exp.results === "lost") losses += 1;
  });
  const total = experiments.filter((e) => e.status === "stopped").length;
  const other = total - wins - losses;
  return {
    wins,
    losses,
    other,
    total,
    winRate: total > 0 ? (wins / total) * 100 : 0,
  };
}

/**
 * Per-project win/loss rows for the breakdown table. When no projects are
 * selected, an "All Projects" aggregate row is prepended (matching
 * ExperimentWinRateByProject).
 */
export function computeWinRateByProject(
  experiments: ExperimentInterfaceStringDates[],
  selectedProjects: string[],
  projects: { id: string; name: string }[],
): WinRateProjectRow[] {
  const projectMap: Record<
    string,
    { id: string; name: string; wins: number; losses: number; total: number }
  > = {};
  projects.forEach((p) => {
    projectMap[p.id] = { id: p.id, name: p.name, wins: 0, losses: 0, total: 0 };
  });

  let allWins = 0;
  let allLosses = 0;
  let allTotal = 0;

  experiments.forEach((exp) => {
    if (exp.status !== "stopped") return;
    const isWin = exp.results === "won";
    const isLoss = exp.results === "lost";
    allTotal += 1;
    if (isWin) allWins += 1;
    if (isLoss) allLosses += 1;
    if (exp.project) {
      if (!projectMap[exp.project]) {
        projectMap[exp.project] = {
          id: exp.project,
          name: exp.project,
          wins: 0,
          losses: 0,
          total: 0,
        };
      }
      projectMap[exp.project].total += 1;
      if (isWin) projectMap[exp.project].wins += 1;
      if (isLoss) projectMap[exp.project].losses += 1;
    }
  });

  if (selectedProjects.length > 0) {
    Object.keys(projectMap).forEach((key) => {
      if (!selectedProjects.includes(key)) delete projectMap[key];
    });
  }

  const rows: WinRateProjectRow[] = Object.values(projectMap).map((p) => ({
    id: p.id,
    name: p.name,
    wins: p.wins,
    losses: p.losses,
    other: p.total - p.wins - p.losses,
    total: p.total,
    winRate: p.total > 0 ? (p.wins / p.total) * 100 : 0,
  }));

  if (selectedProjects.length === 0) {
    rows.unshift({
      id: "all",
      name: "All Projects",
      wins: allWins,
      losses: allLosses,
      other: allTotal - allWins - allLosses,
      total: allTotal,
      winRate: allTotal > 0 ? (allWins / allTotal) * 100 : 0,
    });
  }

  return rows;
}
