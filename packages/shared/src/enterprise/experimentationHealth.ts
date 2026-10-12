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
  process: { label: "Process", gradeDetail: "Process score" },
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
    hint: "Mean score of completed experiments. Power, restarts and SRM are scored inside it. Configure checks on the Quality Score tab.",
    unit: "percent",
    defaultTarget: { min: 75, max: null },
  },
  processScore: {
    area: "process",
    label: "Process score",
    hint: "How cleanly completed experiments were set up and run",
    unit: "percent",
    defaultTarget: { min: 85, max: null },
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
  velocity: 34,
  quality: 33,
  process: 33,
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
  return {
    velocity: next[0],
    quality: next[1],
    process: next[2],
  };
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
  archived?: boolean;
  phases: { dateStarted?: DateLike; dateEnded?: DateLike }[];
  results?: string | null;
  goalMetrics?: string[];
  hypothesis?: string;
  statusUpdateSchedule?: { stopAt?: DateLike } | null;
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

// Non-archived experiments whose last phase ended in the window
export function getCompletedExperimentsInWindow<T extends HealthExperiment>(
  experiments: T[],
  window: HealthWindow,
): T[] {
  return experiments.filter(
    (e) =>
      e.status === "stopped" &&
      !e.archived &&
      inWindow(e.phases[e.phases.length - 1]?.dateEnded, window),
  );
}

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

// ---------------------------------------------------------------------------
// Process: pass/fail signals about how each experiment was set up and run,
// read from the experiment and its change history. Add or remove signals in
// PROCESS_SIGNALS.
// ---------------------------------------------------------------------------

type ProcessFields = Pick<
  HealthExperiment,
  "goalMetrics" | "hypothesis" | "status"
>;

export interface ProcessHistoryEntry {
  date: DateLike;
  // The experiment before and after the change, when the change recorded it
  pre?: Partial<ProcessFields>;
  post?: Partial<ProcessFields>;
}

// true = passed, false = failed, null = not enough information to judge
type ProcessSignalResult = boolean | null;

function sameSet(a: string[] = [], b: string[] = []) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function changesAfterStart(
  experiment: HealthExperiment,
  history: ProcessHistoryEntry[],
): ProcessHistoryEntry[] {
  const start = experiment.phases[0]?.dateStarted;
  if (!start) return [];
  const startTime = new Date(start).getTime();
  return history
    .filter((h) => new Date(h.date).getTime() > startTime)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export const PROCESS_SIGNALS: {
  key: string;
  label: string;
  evaluate: (
    experiment: HealthExperiment,
    history: ProcessHistoryEntry[],
  ) => ProcessSignalResult;
}[] = [
  {
    key: "goal-metrics-before-start",
    label: "Goal metrics were set before the start",
    evaluate: (experiment, history) => {
      if (!history.length) return null;
      // The first change after the start records what was there at the start
      const firstChange = changesAfterStart(experiment, history).find(
        (h) => h.pre?.goalMetrics !== undefined,
      );
      const atStart = firstChange
        ? firstChange.pre?.goalMetrics
        : experiment.goalMetrics;
      return !!atStart?.length;
    },
  },
  {
    key: "goal-metrics-unchanged",
    label: "Goal metrics didn't change after the start",
    evaluate: (experiment, history) => {
      if (!history.length) return null;
      return !changesAfterStart(experiment, history).some(
        (h) =>
          !!h.pre?.goalMetrics?.length &&
          h.post?.goalMetrics !== undefined &&
          !sameSet(h.pre.goalMetrics, h.post.goalMetrics),
      );
    },
  },
  {
    key: "hypothesis-unchanged",
    label: "The hypothesis wasn't edited after the start",
    evaluate: (experiment, history) => {
      if (!history.length) return null;
      return !changesAfterStart(experiment, history).some(
        (h) =>
          h.pre?.hypothesis !== undefined &&
          h.post?.hypothesis !== undefined &&
          h.pre.hypothesis.trim() !== h.post.hypothesis.trim(),
      );
    },
  },
  {
    key: "ran-cleanly",
    label: "Ran without a restart or new phase",
    evaluate: (experiment, history) =>
      experiment.phases.length <= 1 &&
      !history.some(
        (h) => h.pre?.status === "stopped" && h.post?.status === "running",
      ),
  },
  {
    key: "not-ended-early",
    label: "Wasn't ended before its scheduled end",
    evaluate: (experiment) => {
      const stopAt = experiment.statusUpdateSchedule?.stopAt;
      const endedAt =
        experiment.phases[experiment.phases.length - 1]?.dateEnded;
      if (!stopAt || !endedAt) return null;
      // Allow an hour for the scheduled stop job to run
      const tolerance = 60 * 60 * 1000;
      return (
        new Date(endedAt).getTime() >= new Date(stopAt).getTime() - tolerance
      );
    },
  },
];

export function evaluateProcessSignals(
  experiment: HealthExperiment,
  history: ProcessHistoryEntry[],
): Record<string, ProcessSignalResult> {
  return Object.fromEntries(
    PROCESS_SIGNALS.map((s) => [s.key, s.evaluate(experiment, history)]),
  );
}

// Mean, across experiments, of each experiment's share of signals passed
// (unknown signals don't count); 0-100, or null when nothing could be judged
export function getProcessScore(
  results: Record<string, ProcessSignalResult>[],
): number | null {
  const perExperiment = results
    .map((r) => {
      const known = Object.values(r).filter((v): v is boolean => v !== null);
      return known.length ? known.filter(Boolean).length / known.length : null;
    })
    .filter((v): v is number => v !== null);
  const average = getAverage(perExperiment);
  return average === null ? null : average * 100;
}
