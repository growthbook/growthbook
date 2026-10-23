import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import {
  getStandardErrorFromLargestSample,
  jamesSteinAdjustment,
} from "@/components/HomePage/ExperimentImpact/JamesSteinAdjustment";
import { getExperimentResultDate } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/completedExperimentsData";

export const DAYS_PER_YEAR = 365;
// Below this many experiments, James-Stein shrinkage is too noisy to apply
const MIN_EXPERIMENTS_TO_DEBIAS = 5;

export type ImpactResult = "won" | "lost" | "other";

export type ExperimentImpactRow = {
  id: string;
  name: string;
  project: string;
  result: ImpactResult;
  startDate: Date | null;
  endDate: Date | null;
  // Key variation: the shipped winner, or the worst loser
  dailyImpact: number | null;
  dailyImpactSE: number | null;
  relativeLift: number | null;
  // Value to the program: the gain for winners, the avoided loss for losers
  annualValue: number | null;
  missingScaledImpact: boolean;
};

function classifyResult(e: ExperimentInterfaceStringDates): ImpactResult {
  if (e.status !== "stopped") return "other";
  if (e.results === "won" && !!e.winner) return "won";
  if (e.results === "lost") return "lost";
  return "other";
}

function getStartDate(e: ExperimentInterfaceStringDates): Date | null {
  const started = e.phases.find((p) => p.dateStarted)?.dateStarted;
  return started ? new Date(started) : null;
}

// `debias` shrinks every variation's impact toward zero (James-Stein) for winner's curse
export function computeExperimentImpacts({
  experiments,
  snapshots,
  metricId,
  inverse,
  debias,
}: {
  experiments: ExperimentInterfaceStringDates[];
  snapshots: ExperimentSnapshotInterface[];
  metricId: string;
  inverse: boolean;
  debias: boolean;
}): ExperimentImpactRow[] {
  const snapshotsByExperiment = new Map(
    snapshots.map((s) => [s.experiment, s]),
  );
  const samples: { totalUnits: number; standardError: number }[] = [];
  const allImpacts: number[] = [];

  const parsed = experiments.map((e) => {
    const variations: ({
      impact: number;
      se: number;
      lift: number | null;
    } | null)[] = [];
    let missingScaledImpact = false;
    const s = snapshotsByExperiment.get(e.id);
    const defaultAnalysis = s ? getSnapshotAnalysis(s) : null;
    const settings = defaultAnalysis?.settings;
    const scaled =
      s && settings
        ? getSnapshotAnalysis(s, { ...settings, differenceType: "scaled" })
        : null;
    const relative =
      s && settings
        ? getSnapshotAnalysis(s, { ...settings, differenceType: "relative" })
        : null;

    if (scaled?.results.length) {
      const res = scaled.results[0];
      res.variations.forEach((v, i) => {
        if (i === 0) return;
        const result = v.metrics[metricId];
        // Placeholder keeps indexes aligned with `e.winner`
        if (!result) {
          variations.push(null);
          return;
        }
        const impact = result.expected ?? 0;
        const se = result.uplift?.stddev ?? 0;
        const lift =
          relative?.results[0]?.variations[i]?.metrics[metricId]?.expected ??
          null;
        variations.push({ impact, se, lift });
        allImpacts.push(impact);
        samples.push({
          totalUnits: v.users + res.variations[0].users,
          standardError: se,
        });
      });
    } else if (defaultAnalysis?.status === "success") {
      missingScaledImpact = true;
    }
    return { e, variations, missingScaledImpact };
  });

  const applyDebias = debias && parsed.length >= MIN_EXPERIMENTS_TO_DEBIAS;
  const adjustment = jamesSteinAdjustment(
    allImpacts,
    getStandardErrorFromLargestSample(samples) ?? 0,
  );
  const shrink = (impact: number) =>
    applyDebias
      ? adjustment.mean +
        (1 - adjustment.adjustment) * (impact - adjustment.mean)
      : impact;

  return parsed.map(({ e, variations, missingScaledImpact }) => {
    const result = classifyResult(e);
    let key: (typeof variations)[number] | undefined;
    if (result === "won") {
      key = variations[(e.winner ?? 0) - 1];
    } else if (result === "lost") {
      // The worst variation is the loss the rollback avoided
      key = variations.reduce<(typeof variations)[number] | undefined>(
        (worst, v) =>
          v &&
          (!worst ||
            (inverse ? v.impact > worst.impact : v.impact < worst.impact))
            ? v
            : worst,
        undefined,
      );
    }
    const dailyImpact = key ? shrink(key.impact) : null;
    const value =
      dailyImpact === null || result === "other"
        ? null
        : result === "won"
          ? dailyImpact
          : -dailyImpact;
    return {
      id: e.id,
      name: e.name,
      project: e.project ?? "",
      result,
      startDate: getStartDate(e),
      endDate: e.status === "stopped" ? getExperimentResultDate(e) : null,
      dailyImpact,
      dailyImpactSE: key?.se ?? null,
      relativeLift: key?.lift ?? null,
      annualValue: value === null ? null : value * DAYS_PER_YEAR,
      missingScaledImpact,
    };
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type ImpactSummary = {
  won: number;
  wonCount: number;
  avoidedLoss: number;
  lostCount: number;
  total: number;
  // 95% interval half-width on the total
  totalCI: number;
  medianWin: number | null;
};

export function summarizeImpact(rows: ExperimentImpactRow[]): ImpactSummary {
  const wins = rows.filter((r) => r.result === "won" && r.annualValue !== null);
  const losses = rows.filter(
    (r) => r.result === "lost" && r.annualValue !== null,
  );
  const sum = (rs: ExperimentImpactRow[]) =>
    rs.reduce((acc, r) => acc + (r.annualValue ?? 0), 0);
  const variance = [...wins, ...losses].reduce(
    (acc, r) => acc + Math.pow((r.dailyImpactSE ?? 0) * DAYS_PER_YEAR, 2),
    0,
  );
  const won = sum(wins);
  const avoidedLoss = sum(losses);
  return {
    won,
    wonCount: wins.length,
    avoidedLoss,
    lostCount: losses.length,
    total: won + avoidedLoss,
    totalCI: 1.96 * Math.sqrt(variance),
    medianWin: median(wins.map((r) => r.annualValue ?? 0)),
  };
}

export function sumValueByProject(
  rows: ExperimentImpactRow[],
): Map<string, number> {
  const totals = new Map<string, number>();
  rows.forEach((r) => {
    if (r.annualValue === null) return;
    totals.set(r.project, (totals.get(r.project) ?? 0) + r.annualValue);
  });
  return totals;
}

export type MetricSeriesPoint = {
  date: Date;
  // What the chart plots: the per-unit value, or the total for count metrics
  value: number;
  // The metric's daily total, in the same units as scaled impact
  total: number;
};

export type CounterfactualPoint = {
  date: Date;
  actual: number;
  without: number;
  lower: number;
  upper: number;
};

// Share of a shipped effect present on `date`: linear over the run, then held
export function rampShare(date: Date, start: Date, ship: Date): number {
  const t = date.getTime();
  if (t <= start.getTime()) return 0;
  if (t >= ship.getTime()) return 1;
  return (t - start.getTime()) / (ship.getTime() - start.getTime());
}

// actual ÷ (1 + Σ each winner's daily scaled impact ÷ the average daily total)
export function buildCounterfactual(
  series: MetricSeriesPoint[],
  rows: ExperimentImpactRow[],
): {
  points: CounterfactualPoint[];
  lift: number;
  liftCI: number;
  meanTotal: number;
} | null {
  const meanTotal =
    series.reduce((acc, p) => acc + p.total, 0) / (series.length || 1);
  if (!series.length || meanTotal <= 0) return null;

  const contributors = rows.flatMap((r) =>
    r.result === "won" &&
    r.dailyImpact !== null &&
    r.startDate !== null &&
    r.endDate !== null
      ? [
          {
            start: r.startDate,
            ship: r.endDate,
            share: r.dailyImpact / meanTotal,
            se: (r.dailyImpactSE ?? 0) / meanTotal,
          },
        ]
      : [],
  );

  let lift = 0;
  let liftCI = 0;
  const points = series.map((p) => {
    let s = 0;
    let v = 0;
    contributors.forEach((c) => {
      const ramp = rampShare(p.date, c.start, c.ship);
      s += ramp * c.share;
      v += Math.pow(ramp * c.se, 2);
    });
    const ci = 1.96 * Math.sqrt(v);
    lift = s;
    liftCI = ci;
    // Guard against a non-positive divisor from a large negative estimate
    const scale = (x: number) => p.value / Math.max(1 + x, 0.01);
    return {
      date: p.date,
      actual: p.value,
      without: scale(s),
      lower: scale(s + ci),
      upper: scale(s - ci),
    };
  });
  return { points, lift, liftCI, meanTotal };
}
