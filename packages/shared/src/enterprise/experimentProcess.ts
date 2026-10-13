// Process score: how cleanly an experiment was set up, run and stopped,
// judged from its change history (audit log snapshots). Rules look only at
// changes made while the experiment was running, so documentation edits
// after it stops don't count, and looking at results is never penalized —
// only actions like changing the setup or stopping early.
import type { ExperimentProcessResults } from "../validators/experiments";

// Bump when a rule's logic changes so cached results are recomputed
export const EXPERIMENT_PROCESS_RULES_VERSION = 1;

export type ProcessSeverity = "critical" | "significant";

const SEVERITY_WEIGHT: Record<ProcessSeverity, number> = {
  critical: 3,
  significant: 2,
};

// A critical failure can invalidate the results, so it caps the score
export const CRITICAL_PROCESS_FAILURE_SCORE_CAP = 50;

type DateLike = Date | string;

// The fields of an experiment snapshot the rules read
export interface ProcessSnapshot {
  status?: string;
  type?: string;
  trackingKey?: string;
  hypothesis?: string;
  goalMetrics?: string[];
  statusUpdateSchedule?: { stopAt?: DateLike; stopAfter?: unknown } | null;
  sequentialTestingEnabled?: boolean;
  bucketVersion?: number;
  // Assignment: how users are bucketed into variations
  assignment: Record<string, unknown>;
  // Analysis: how results are calculated
  analysis: Record<string, unknown>;
  phases: Array<{
    seed?: string;
    targeting: Record<string, unknown>;
  }>;
}

const ASSIGNMENT_FIELDS = [
  "hashAttribute",
  "fallbackAttribute",
  "hashVersion",
] as const;
const PHASE_TARGETING_FIELDS = [
  "variationWeights",
  "condition",
  "savedGroups",
  "prerequisites",
  "namespace",
] as const;
const ANALYSIS_FIELDS = [
  "statsEngine",
  "regressionAdjustmentEnabled",
  "sequentialTestingEnabled",
  "sequentialTestingTuningParameter",
  "postStratificationEnabled",
  "attributionModel",
  "activationMetric",
  "segment",
  "queryFilter",
  "skipPartialData",
  "metricOverrides",
  "lookbackOverride",
] as const;

const FIELD_LABELS: Record<string, string> = {
  hashAttribute: "the assignment attribute",
  fallbackAttribute: "the fallback attribute",
  hashVersion: "the hashing algorithm",
  variationWeights: "the traffic split",
  condition: "the targeting conditions",
  savedGroups: "the targeted Saved Groups",
  prerequisites: "the prerequisites",
  namespace: "the namespace",
  statsEngine: "the statistics engine",
  regressionAdjustmentEnabled: "CUPED",
  sequentialTestingEnabled: "sequential testing",
  sequentialTestingTuningParameter: "the sequential testing tuning",
  postStratificationEnabled: "post-stratification",
  attributionModel: "the conversion window model",
  activationMetric: "the activation metric",
  segment: "the segment",
  queryFilter: "the custom SQL filter",
  skipPartialData: "partial data handling",
  metricOverrides: "the metric overrides",
  lookbackOverride: "the lookback window",
};

function pick(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f, source[f]]));
}

// The process-relevant parts of an experiment document or audit snapshot,
// or null when the value isn't an experiment
export function toProcessSnapshot(doc: unknown): ProcessSnapshot | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  const phases = Array.isArray(d.phases) ? d.phases : [];
  const schedule = d.statusUpdateSchedule;
  return {
    status: typeof d.status === "string" ? d.status : undefined,
    type: typeof d.type === "string" ? d.type : undefined,
    trackingKey: typeof d.trackingKey === "string" ? d.trackingKey : undefined,
    hypothesis: typeof d.hypothesis === "string" ? d.hypothesis : undefined,
    goalMetrics: Array.isArray(d.goalMetrics)
      ? d.goalMetrics.filter((m): m is string => typeof m === "string")
      : undefined,
    statusUpdateSchedule:
      schedule && typeof schedule === "object"
        ? (schedule as ProcessSnapshot["statusUpdateSchedule"])
        : null,
    sequentialTestingEnabled:
      typeof d.sequentialTestingEnabled === "boolean"
        ? d.sequentialTestingEnabled
        : undefined,
    bucketVersion:
      typeof d.bucketVersion === "number" ? d.bucketVersion : undefined,
    assignment: pick(d, ASSIGNMENT_FIELDS),
    analysis: pick(d, ANALYSIS_FIELDS),
    phases: phases.map((p) => {
      const phase = (p ?? {}) as Record<string, unknown>;
      return {
        seed: typeof phase.seed === "string" ? phase.seed : undefined,
        targeting: pick(phase, PHASE_TARGETING_FIELDS),
      };
    }),
  };
}

// One recorded change: the experiment before and after it
export interface ProcessChange {
  date: DateLike;
  user?: string;
  pre: ProcessSnapshot;
  post: ProcessSnapshot;
}

export type ProcessRuleResult = ExperimentProcessResults["rules"][number];

export interface ProcessRuleContext {
  // Changes in date order
  history: ProcessChange[];
  // Sequential testing makes stopping early statistically valid; an
  // experiment that doesn't set it follows the org default
  orgSequentialTestingEnabled: boolean;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const sameSet = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && a.every((x) => b.includes(x));

const changedFields = (
  pre: Record<string, unknown>,
  post: Record<string, unknown>,
) => Object.keys(post).filter((f) => !same(pre[f], post[f]));

const describeFields = (fields: string[]) =>
  fields.map((f) => FIELD_LABELS[f] ?? f).join(", ");

const evidence = (change: ProcessChange, detail: string) => ({
  date: new Date(change.date),
  user: change.user,
  detail,
});

// Changes made while the experiment was running
const whileRunning = (history: ProcessChange[]) =>
  history.filter((h) => h.pre.status === "running");

// The change that first started the experiment
const firstStart = (history: ProcessChange[]) =>
  history.find(
    (h) => h.pre.status !== "running" && h.post.status === "running",
  );

export const PROCESS_RULES: {
  key: string;
  label: string;
  severity: ProcessSeverity;
  evaluate: (ctx: ProcessRuleContext) => Omit<ProcessRuleResult, "key">;
}[] = [
  {
    key: "goal-metrics-locked",
    label: "Goal metrics set before the start and unchanged while running",
    severity: "critical",
    evaluate: ({ history }) => {
      const start = firstStart(history);
      if (!start) return { result: "na" };
      if (!start.post.goalMetrics?.length) {
        return {
          result: "fail",
          ...evidence(start, "Started without goal metrics"),
        };
      }
      const change = whileRunning(history).find(
        (h) => !sameSet(h.pre.goalMetrics, h.post.goalMetrics),
      );
      return change
        ? {
            result: "fail",
            ...evidence(change, "Goal metrics changed while running"),
          }
        : { result: "pass" };
    },
  },
  {
    key: "hypothesis-locked",
    label: "Hypothesis written before the start and unchanged while running",
    severity: "significant",
    evaluate: ({ history }) => {
      const start = firstStart(history);
      if (!start) return { result: "na" };
      if (!start.post.hypothesis?.trim()) {
        return {
          result: "fail",
          ...evidence(start, "Started without a hypothesis"),
        };
      }
      const change = whileRunning(history).find(
        (h) =>
          (h.pre.hypothesis ?? "").trim() !== (h.post.hypothesis ?? "").trim(),
      );
      return change
        ? {
            result: "fail",
            ...evidence(change, "Hypothesis changed while running"),
          }
        : { result: "pass" };
    },
  },
  {
    key: "planned-end",
    label: "End date planned before the start",
    severity: "significant",
    evaluate: ({ history }) => {
      const start = firstStart(history);
      if (!start) return { result: "na" };
      const schedule = start.post.statusUpdateSchedule;
      return schedule?.stopAt || schedule?.stopAfter
        ? { result: "pass" }
        : {
            result: "fail",
            ...evidence(start, "Started without a planned end date"),
          };
    },
  },
  {
    key: "stable-assignment",
    label: "Traffic split and targeting unchanged within a phase",
    severity: "critical",
    evaluate: ({ history }) => {
      if (!history.length) return { result: "na" };
      for (const h of whileRunning(history)) {
        // A new phase is judged by the restart rule instead
        if (h.post.phases.length !== h.pre.phases.length) continue;
        const pre = h.pre.phases[h.pre.phases.length - 1];
        const post = h.post.phases[h.post.phases.length - 1];
        const fields = [
          ...changedFields(h.pre.assignment, h.post.assignment),
          ...(pre && post ? changedFields(pre.targeting, post.targeting) : []),
        ];
        if (fields.length) {
          return {
            result: "fail",
            ...evidence(h, `Changed ${describeFields(fields)} while running`),
          };
        }
      }
      return { result: "pass" };
    },
  },
  {
    key: "stable-analysis",
    label: "Analysis settings unchanged while running",
    severity: "significant",
    evaluate: ({ history }) => {
      if (!history.length) return { result: "na" };
      for (const h of whileRunning(history)) {
        const fields = changedFields(h.pre.analysis, h.post.analysis);
        if (fields.length) {
          return {
            result: "fail",
            ...evidence(h, `Changed ${describeFields(fields)} while running`),
          };
        }
      }
      return { result: "pass" };
    },
  },
  {
    key: "no-early-stop",
    label: "Not stopped before its planned end",
    severity: "critical",
    evaluate: ({ history, orgSequentialTestingEnabled }) => {
      const stop = [...history]
        .reverse()
        .find((h) => h.pre.status === "running" && h.post.status === "stopped");
      const plannedStop = stop?.pre.statusUpdateSchedule?.stopAt;
      if (!stop || !plannedStop) return { result: "na" };
      // Sequential testing is designed for stopping as soon as it's clear
      if (stop.pre.sequentialTestingEnabled ?? orgSequentialTestingEnabled) {
        return { result: "na" };
      }
      // Allow an hour for the scheduled stop job to run
      const early =
        new Date(plannedStop).getTime() - new Date(stop.date).getTime();
      if (early <= 60 * 60 * 1000) return { result: "pass" };
      const days = Math.max(1, Math.round(early / (24 * 60 * 60 * 1000)));
      return {
        result: "fail",
        ...evidence(
          stop,
          `Stopped ${days} ${days === 1 ? "day" : "days"} before its planned end`,
        ),
      };
    },
  },
  {
    key: "clean-restarts",
    label: "New phases re-randomized users",
    severity: "significant",
    evaluate: ({ history }) => {
      if (!history.length) return { result: "na" };
      for (const h of history) {
        const added = h.post.phases.length > h.pre.phases.length;
        if (!added || !h.pre.phases.length) continue;
        const seedOf = (s: ProcessSnapshot) =>
          s.phases[s.phases.length - 1]?.seed || s.trackingKey;
        const reseeded =
          seedOf(h.post) !== seedOf(h.pre) ||
          (h.post.bucketVersion ?? 0) > (h.pre.bucketVersion ?? 0);
        if (!reseeded) {
          return {
            result: "fail",
            ...evidence(h, "Started a new phase without re-randomizing"),
          };
        }
      }
      return { result: "pass" };
    },
  },
];

export function evaluateProcessRules(
  ctx: ProcessRuleContext,
): ProcessRuleResult[] {
  return PROCESS_RULES.map((rule) => ({
    key: rule.key,
    ...rule.evaluate(ctx),
  }));
}

/**
 * 0-100: the severity-weighted share of judged rules passed, capped when a
 * critical rule failed. Null when nothing could be judged (e.g. no history).
 */
export function getProcessScore(
  results: Pick<ProcessRuleResult, "key" | "result">[],
): number | null {
  let earned = 0;
  let possible = 0;
  let criticalFailed = false;
  for (const r of results) {
    const rule = PROCESS_RULES.find((p) => p.key === r.key);
    if (!rule || r.result === "na") continue;
    const weight = SEVERITY_WEIGHT[rule.severity];
    possible += weight;
    if (r.result === "pass") earned += weight;
    else if (rule.severity === "critical") criticalFailed = true;
  }
  if (!possible) return null;
  const score = Math.round((100 * earned) / possible);
  return criticalFailed
    ? Math.min(score, CRITICAL_PROCESS_FAILURE_SCORE_CAP)
    : score;
}
