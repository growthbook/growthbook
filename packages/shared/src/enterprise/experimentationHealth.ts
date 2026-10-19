// Import the specific validator files, NOT the shared/validators barrel (see
// experimentQualityScore.ts for the module-initialization cycle it causes).
import {
  ExperimentationHealthGradeWeights,
  ExperimentationHealthGradedArea,
  ExperimentationHealthMetricKey,
  ExperimentationHealthSettingsInterface,
  ExperimentationHealthTarget,
  experimentationHealthGradedAreas,
  experimentationHealthMetricKeys,
} from "../validators/experimentation-health";
import { ExperimentQualityConfigBody } from "../validators/experiment-quality-score";
import {
  ResolvedExperimentQualityScoreSettings,
  reflowShares,
  resolveExperimentQualityScoreSettings,
} from "./experimentQualityScore";

export const EXPERIMENTATION_HEALTH_WINDOW_DAYS = 90;
// Below this many completed experiments in the window, no grade is shown
export const MIN_COMPLETED_EXPERIMENTS_FOR_GRADE = 5;

export type ExperimentationHealthArea =
  | ExperimentationHealthGradedArea
  | "winRate"
  | "ideas";

export const EXPERIMENTATION_HEALTH_AREAS: Record<
  ExperimentationHealthArea,
  { label: string; note?: string; gradeDetail?: string }
> = {
  velocity: { label: "Velocity", gradeDetail: "Experiments started" },
  quality: { label: "Quality", gradeDetail: "Average Quality Score" },
  winRate: {
    label: "Win rate",
    note: "Typically 20%–30%. Higher often means tests are too safe",
  },
  ideas: { label: "Ideas" },
};

export type ExperimentationHealthUnit = "perMonth" | "percent";

export interface ExperimentationHealthMetricDefinition {
  area: ExperimentationHealthArea;
  label: string;
  hint: string;
  unit: ExperimentationHealthUnit;
  defaultTarget: ExperimentationHealthTarget;
  // Metrics where more is never a problem only take a minimum
  minOnly?: boolean;
}

export const EXPERIMENTATION_HEALTH_METRICS: Record<
  ExperimentationHealthMetricKey,
  ExperimentationHealthMetricDefinition
> = {
  experimentsStartedPerMonth: {
    area: "velocity",
    label: "Experiments started per month",
    hint: "First start only. Restarts don't count.",
    unit: "perMonth",
    defaultTarget: { min: 3, max: null },
    minOnly: true,
  },
  averageQualityScore: {
    area: "quality",
    label: "Average Quality Score",
    hint: "Mean score of completed experiments, including how they were run. Configure checks on the Quality Score tab.",
    unit: "percent",
    defaultTarget: { min: 75, max: null },
  },
  winRate: {
    area: "winRate",
    label: "Share of experiments that win",
    hint: "Completed experiments with a winning variation",
    unit: "percent",
    defaultTarget: { min: 20, max: 30 },
  },
  ideasPerMonth: {
    area: "ideas",
    label: "Ideas per month",
    hint: "New ideas added",
    unit: "perMonth",
    defaultTarget: { min: 20, max: null },
  },
};

export const DEFAULT_GRADE_WEIGHTS: ExperimentationHealthGradeWeights = {
  velocity: 50,
  quality: 50,
};

// Drag one area's weight; the others re-flow so the weights keep totalling 100
export function reflowGradeWeights(
  weights: ExperimentationHealthGradeWeights,
  area: ExperimentationHealthGradedArea,
  newWeight: number,
): ExperimentationHealthGradeWeights {
  const next = reflowShares(
    experimentationHealthGradedAreas.map((a) => weights[a]),
    experimentationHealthGradedAreas.indexOf(area),
    newWeight,
  );
  return Object.fromEntries(
    experimentationHealthGradedAreas.map((a, i) => [a, next[i]]),
  ) as ExperimentationHealthGradeWeights;
}

// ---------------------------------------------------------------------------
// Inheritance: a Project record's fields win; everything else comes from the
// organization default's record, then the built-in defaults
// ---------------------------------------------------------------------------

type HealthRecord = Partial<
  Pick<
    ExperimentationHealthSettingsInterface,
    "targets" | "gradeWeights" | "quality"
  >
>;

export interface ResolvedQualityScope {
  enabled: boolean;
  // undefined = the built-in GrowthBook default configuration
  configId?: string;
  // Which fields the Project record sets itself rather than inheriting
  overridden: { enabled: boolean; configId: boolean };
}

// Quality scoring is off unless the org or Project record turns it on
export function resolveQualityScope(
  orgRecord?: HealthRecord | null,
  projectRecord?: HealthRecord | null,
): ResolvedQualityScope {
  const org = orgRecord?.quality;
  const project = projectRecord?.quality;
  return {
    enabled: project?.enabled ?? org?.enabled ?? false,
    configId: project?.configId ?? org?.configId,
    overridden: {
      enabled: project?.enabled !== undefined,
      configId: project?.configId !== undefined,
    },
  };
}

/**
 * The settings that score an experiment, or null when quality scoring is
 * off for its scope. A missing or deleted configuration resolves to the
 * built-in defaults. With org AI off, AI checks are dropped so their share
 * goes to the other checks instead of staying pending.
 */
export function resolveExperimentQualitySettings({
  orgRecord,
  projectRecord,
  getConfig,
  aiEnabled,
}: {
  orgRecord?: HealthRecord | null;
  projectRecord?: HealthRecord | null;
  getConfig: (id: string) => ExperimentQualityConfigBody | null | undefined;
  aiEnabled: boolean;
}): {
  settings: ResolvedExperimentQualityScoreSettings;
  configId?: string;
} | null {
  const { enabled, configId } = resolveQualityScope(orgRecord, projectRecord);
  if (!enabled) return null;
  const config = configId ? getConfig(configId) : null;
  return {
    settings: resolveExperimentQualityScoreSettings(
      aiEnabled ? config : { ...config, aiChecksEnabled: false },
    ),
    configId,
  };
}

export interface ResolvedHealthTarget {
  target: ExperimentationHealthTarget;
  orgTarget: ExperimentationHealthTarget;
  overridden: boolean;
}

export function resolveHealthTargets(
  orgRecord?: HealthRecord | null,
  projectRecord?: HealthRecord | null,
): Record<ExperimentationHealthMetricKey, ResolvedHealthTarget> {
  return Object.fromEntries(
    experimentationHealthMetricKeys.map((key) => {
      const def = EXPERIMENTATION_HEALTH_METRICS[key];
      // A minimum-only metric ignores any stored maximum
      const clean = (t: ExperimentationHealthTarget) =>
        def.minOnly ? { min: t.min, max: null } : t;
      const orgTarget = clean(orgRecord?.targets?.[key] ?? def.defaultTarget);
      const projectTarget = projectRecord?.targets?.[key];
      return [
        key,
        {
          target: projectTarget ? clean(projectTarget) : orgTarget,
          orgTarget,
          overridden: projectTarget !== undefined,
        },
      ];
    }),
  ) as Record<ExperimentationHealthMetricKey, ResolvedHealthTarget>;
}

export function resolveGradeWeights(
  orgRecord?: HealthRecord | null,
  projectRecord?: HealthRecord | null,
): {
  weights: ExperimentationHealthGradeWeights;
  orgWeights: ExperimentationHealthGradeWeights;
  overridden: boolean;
} {
  const orgWeights = orgRecord?.gradeWeights ?? DEFAULT_GRADE_WEIGHTS;
  return {
    weights: projectRecord?.gradeWeights ?? orgWeights,
    orgWeights,
    overridden: projectRecord?.gradeWeights !== undefined,
  };
}

// How many settings a record customizes (for "N settings customized")
export function countHealthOverrides(record?: HealthRecord | null): number {
  if (!record) return 0;
  const quality = Object.values(record.quality ?? {}).filter(
    (v) => v !== undefined,
  ).length;
  const targets = Object.keys(record.targets ?? {}).length;
  return quality + targets + (record.gradeWeights ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function getHealthTargetError(
  key: ExperimentationHealthMetricKey,
  target: ExperimentationHealthTarget,
): string | null {
  const { min, max } = target;
  if (EXPERIMENTATION_HEALTH_METRICS[key].minOnly && max !== null) {
    return `${EXPERIMENTATION_HEALTH_METRICS[key].label} only takes a minimum`;
  }
  if ((min !== null && min < 0) || (max !== null && max < 0)) {
    return "Targets can't be negative";
  }
  if (
    EXPERIMENTATION_HEALTH_METRICS[key].unit === "percent" &&
    ((min !== null && min > 100) || (max !== null && max > 100))
  ) {
    return "Percentages must be between 0 and 100";
  }
  if (min !== null && max !== null && min > max) {
    return "The minimum can't be greater than the maximum";
  }
  return null;
}

export function isTargetSet(target: ExperimentationHealthTarget): boolean {
  return target.min !== null || target.max !== null;
}

export function isValueInTarget(
  value: number,
  target: ExperimentationHealthTarget,
): boolean {
  return (
    (target.min === null || value >= target.min) &&
    (target.max === null || value <= target.max)
  );
}

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

/**
 * Scores a value 0-100 against its target: 100 inside the range, falling
 * off proportionally on whichever side it's out (actual ÷ min below a
 * minimum, max ÷ actual above a maximum). Null when there's no target or
 * no value.
 */
export function scoreAgainstTarget(
  value: number | null,
  target: ExperimentationHealthTarget,
): number | null {
  if (value === null || !isTargetSet(target)) return null;
  let score = 100;
  if (target.min !== null && value < target.min) {
    score = target.min > 0 ? (value / target.min) * 100 : 100;
  } else if (target.max !== null && value > target.max) {
    score = value > 0 ? (target.max / value) * 100 : 100;
  }
  return Math.max(0, Math.min(100, score));
}

const GRADE_BANDS: { letter: string; min: number; max: number }[] = [
  { letter: "A", min: 90, max: 100 },
  { letter: "B", min: 75, max: 90 },
  { letter: "C", min: 60, max: 75 },
  { letter: "D", min: 0, max: 60 },
];

// Letter for a 0-100 score, with + / − for the top / bottom third of a band
export function getGradeLetter(score: number): string {
  const band =
    GRADE_BANDS.find((b) => score >= b.min) ??
    GRADE_BANDS[GRADE_BANDS.length - 1];
  const third = (band.max - band.min) / 3;
  if (score >= band.max - third) return `${band.letter}+`;
  if (score < band.min + third) return `${band.letter}−`;
  return band.letter;
}

// "A ≥ 90 · B ≥ 75 · C ≥ 60 · D below"
export const GRADE_BAND_LEGEND = GRADE_BANDS.map((b) =>
  b.min > 0 ? `${b.letter} ≥ ${b.min}` : `${b.letter} below`,
).join(" · ");

export type ExperimentationHealthValues = Record<
  ExperimentationHealthMetricKey,
  number | null
>;

// Response of GET /experimentation-health/summary
export interface ExperimentationHealthSummary {
  windowDays: number;
  completedCount: number;
  values: ExperimentationHealthValues;
  // Ideas show only when the scope has ideas in the window
  ideasInUse: boolean;
  // Completed experiments whose process checks are still being calculated
  processPending: number;
}

export interface ExperimentationHealthGrade {
  // Null when there isn't enough data or no graded area has a target
  score: number | null;
  letter: string | null;
  notEnoughData: boolean;
  areaScores: Record<ExperimentationHealthGradedArea, number | null>;
}

// The grade for a scope's targets and weights against the current values
export function computeHealthGrade({
  values,
  completedCount,
  orgRecord,
  projectRecord,
}: Pick<ExperimentationHealthSummary, "values" | "completedCount"> & {
  orgRecord?: HealthRecord | null;
  projectRecord?: HealthRecord | null;
}): ExperimentationHealthGrade {
  const targets = resolveHealthTargets(orgRecord, projectRecord);
  const { weights } = resolveGradeWeights(orgRecord, projectRecord);
  const areaScores = Object.fromEntries(
    experimentationHealthGradedAreas.map((area) => {
      const scores = experimentationHealthMetricKeys
        .filter((k) => EXPERIMENTATION_HEALTH_METRICS[k].area === area)
        .map((k) => scoreAgainstTarget(values[k], targets[k].target))
        .filter((s): s is number => s !== null);
      return [
        area,
        scores.length
          ? scores.reduce((sum, s) => sum + s, 0) / scores.length
          : null,
      ];
    }),
  ) as Record<ExperimentationHealthGradedArea, number | null>;

  const notEnoughData = completedCount < MIN_COMPLETED_EXPERIMENTS_FOR_GRADE;
  // Areas without a target or a value drop out; the rest share the weight
  const scored = experimentationHealthGradedAreas.filter(
    (a) => areaScores[a] !== null && weights[a] > 0,
  );
  const totalWeight = scored.reduce((sum, a) => sum + weights[a], 0);
  const score =
    notEnoughData || !totalWeight
      ? null
      : scored.reduce(
          (sum, a) => sum + (areaScores[a] as number) * weights[a],
          0,
        ) / totalWeight;

  return {
    score,
    letter: score === null ? null : getGradeLetter(score),
    notEnoughData,
    areaScores,
  };
}

// ---------------------------------------------------------------------------
// Metrics, computed over a trailing window
// ---------------------------------------------------------------------------

type DateLike = Date | string;

export interface HealthWindow {
  start: Date;
  end: Date;
  days: number;
}

export function getHealthWindow(
  now: Date = new Date(),
  days: number = EXPERIMENTATION_HEALTH_WINDOW_DAYS,
): HealthWindow {
  return {
    start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    end: now,
    days,
  };
}

function inWindow(date: DateLike | undefined | null, window: HealthWindow) {
  if (!date) return false;
  const t = new Date(date).getTime();
  return t >= window.start.getTime() && t <= window.end.getTime();
}

function perMonth(count: number, window: HealthWindow): number {
  return count / (window.days / 30);
}

export interface HealthExperiment {
  status: "draft" | "running" | "stopped";
  phases: { name?: string; dateStarted?: DateLike; dateEnded?: DateLike }[];
  results?: string | null;
}

// Experiments first started in the window. Drafts already carry a start
// date from creation, so they're excluded.
export function getExperimentsStartedPerMonth(
  experiments: HealthExperiment[],
  window: HealthWindow,
): number {
  const started = experiments.filter(
    (e) => e.status !== "draft" && inWindow(e.phases[0]?.dateStarted, window),
  ).length;
  return perMonth(started, window);
}

/**
 * When an experiment completed, as the Executive Report and dashboards
 * count it: the latest end of a "Main" phase, or else of any phase. Null
 * when no phase has ended.
 */
export function getExperimentResultDate(experiment: {
  phases: { name?: string; dateEnded?: DateLike }[];
}): Date | null {
  const latestEnded = (phases: { dateEnded?: DateLike }[]) =>
    [...phases].sort(
      (a, b) =>
        new Date(b.dateEnded || 0).getTime() -
        new Date(a.dateEnded || 0).getTime(),
    )[0];
  const phase =
    latestEnded(experiment.phases.filter((p) => p.name === "Main")) ??
    latestEnded(experiment.phases);
  return phase?.dateEnded ? new Date(phase.dateEnded) : null;
}

// Stopped experiments (archived ones too) that completed in the window,
// matching the Executive Report and dashboards
export function getCompletedExperimentsInWindow<T extends HealthExperiment>(
  experiments: T[],
  window: HealthWindow,
): T[] {
  return experiments.filter(
    (e) =>
      e.status === "stopped" && inWindow(getExperimentResultDate(e), window),
  );
}

// Share of completed experiments that won, as the dashboards define it
export function getWinRate(completed: HealthExperiment[]): number | null {
  if (!completed.length) return null;
  const wins = completed.filter((e) => e.results === "won").length;
  return (wins / completed.length) * 100;
}

export function getAverage(values: number[]): number | null {
  return values.length
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : null;
}

export function getIdeasPerMonth(
  ideaDates: DateLike[],
  window: HealthWindow,
): number {
  return perMonth(ideaDates.filter((d) => inWindow(d, window)).length, window);
}
