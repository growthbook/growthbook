import type {
  ExperimentInterface,
  ExperimentPhase,
} from "shared/types/experiment";
import type { WorldSnapshot } from "back-end/test/evals/harness/record";
import {
  BANDIT_RESET_EXPERIMENT_FIELDS,
  PLAN_SIGNATURES,
  TRAFFIC_FIELDS,
  type ExperimentKey,
  type PhaseKey,
  type PlanKey,
} from "./plans";
import {
  describeExpected,
  equalWeights,
  matches,
  sameValue,
  type Expected,
} from "./matchers";

export interface GradeResult {
  pass: boolean;
  reasons: string[];
}

export interface StateExpectation {
  plan: PlanKey;
  // Requested changes to the served (last) phase.
  phase?: { [K in PhaseKey]?: Expected<ExperimentPhase[K]> };
  // Requested changes to experiment-level fields.
  experiment?: { [K in ExperimentKey]?: Expected<ExperimentInterface[K]> };
}

const ALWAYS_IGNORED = new Set<string>(["dateUpdated"]);

const fmt = (v: unknown) => {
  const s = v === undefined ? "undefined" : JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
};

function changedKeys(a: object, b: object): string[] {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
    (k) => !sameValue(left[k], right[k]),
  );
}

function field(doc: object, key: string): unknown {
  return (doc as Record<string, unknown>)[key];
}

// "" and "{}" both target everyone, and key order or spacing in the JSON
// changes nothing, so conditions are compared as key-sorted JSON.
function canonicalCondition(condition: string | undefined): string {
  if (!condition?.trim()) return "{}";
  try {
    return JSON.stringify(JSON.parse(condition), (key, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
          )
        : value,
    );
  } catch {
    return condition;
  }
}

function canonicalPhases(e: ExperimentInterface): ExperimentInterface {
  return {
    ...e,
    phases: e.phases.map((p) => ({
      ...p,
      condition: canonicalCondition(p.condition),
    })),
  };
}

// The seed users are hashed with: the phase's own, or the tracking key when
// the phase has none, as the SDK payload falls back to it.
function hashSeed(e: ExperimentInterface, p: ExperimentPhase): string {
  return p.seed || e.trackingKey;
}

function result(reasons: string[]): GradeResult {
  return { pass: reasons.length === 0, reasons };
}

export function gradeState(
  expect: StateExpectation,
  before: WorldSnapshot,
  after: WorldSnapshot,
): GradeResult {
  if (!before.experiment) return result(["the seed wrote no experiment"]);
  if (!after.experiment) return result(["the experiment no longer exists"]);
  const B = canonicalPhases(before.experiment);
  const A = canonicalPhases(after.experiment);

  if (expect.plan === "untouched") {
    return result(
      changedKeys(B, A)
        .filter((k) => !ALWAYS_IGNORED.has(k))
        .map(
          (k) =>
            `experiment.${k} changed from ${fmt(field(B, k))} to ${fmt(field(A, k))}, expected no change`,
        ),
    );
  }

  const plan = PLAN_SIGNATURES[expect.plan];
  const trafficOnly = Object.keys(expect.phase ?? {}).every((k) =>
    TRAFFIC_FIELDS.includes(k as PhaseKey),
  );
  const restartsBandit =
    B.type === "multi-armed-bandit" &&
    (plan.restartsBandit === "always" ||
      (plan.restartsBandit === "unless-traffic-only" && !trafficOnly));
  const sticky = before.orgStickyBucketing && !B.disableStickyBucketing;
  const reasons: string[] = [];

  const requested = Object.entries(expect.experiment ?? {});
  for (const [key, expected] of requested) {
    if (!matches(field(A, key), expected)) {
      reasons.push(
        `experiment.${key} is ${fmt(field(A, key))}, expected ${describeExpected(expected)}`,
      );
    }
  }
  const mayChange = new Set<string>([
    ...ALWAYS_IGNORED,
    "phases",
    "bucketVersion",
    "minBucketVersion",
    ...requested.map(([k]) => k),
    ...plan.experimentIncidental,
    ...(restartsBandit ? BANDIT_RESET_EXPERIMENT_FIELDS : []),
  ]);
  for (const key of changedKeys(B, A)) {
    if (!mayChange.has(key)) {
      reasons.push(
        `experiment.${key} changed from ${fmt(field(B, key))} to ${fmt(field(A, key))}`,
      );
    }
  }
  if (restartsBandit && A.banditStage !== "explore") {
    reasons.push(
      `banditStage is ${fmt(A.banditStage)}, expected "explore" (a bandit change restarts exploration)`,
    );
  }

  const bucketVersion = B.bucketVersion ?? 0;
  const expectedBucketVersion =
    plan.bucketVersion === "bump" ||
    (plan.bucketVersion === "bump-if-sticky" && sticky)
      ? bucketVersion + 1
      : bucketVersion;
  const expectedMinBucketVersion =
    plan.minBucketVersion === "raise-to-bucket-version"
      ? expectedBucketVersion
      : (B.minBucketVersion ?? 0);
  const stickyNote = sticky ? "sticky bucketing on" : "sticky bucketing off";
  if ((A.bucketVersion ?? 0) !== expectedBucketVersion) {
    reasons.push(
      `bucketVersion is ${fmt(A.bucketVersion)}, expected ${expectedBucketVersion} for ${expect.plan} with ${stickyNote}`,
    );
  }
  if ((A.minBucketVersion ?? 0) !== expectedMinBucketVersion) {
    reasons.push(
      `minBucketVersion is ${fmt(A.minBucketVersion)}, expected ${expectedMinBucketVersion} for ${expect.plan} with ${stickyNote}`,
    );
  }

  const n = B.phases.length;
  const expectedPhases = n + (plan.newPhase ? 1 : 0);
  if (A.phases.length !== expectedPhases) {
    reasons.push(
      `has ${A.phases.length} phases, expected ${expectedPhases} (${plan.newPhase ? "one new phase" : "the same phase"})`,
    );
    return result(reasons);
  }

  for (let i = 0; i < n - 1; i++) {
    for (const key of changedKeys(B.phases[i], A.phases[i])) {
      reasons.push(`phase ${i + 1}.${key} changed`);
    }
  }

  const base = B.phases[n - 1];
  const served = A.phases[A.phases.length - 1];
  if (plan.newPhase) {
    const closed = A.phases[n - 1];
    if (!closed.dateEnded) {
      reasons.push(`the previous phase (${n}) wasn't closed`);
    }
    for (const key of changedKeys(base, closed)) {
      if (key !== "dateEnded" && key !== "reason") {
        reasons.push(
          `the previous phase's ${key} changed from ${fmt(field(base, key))} to ${fmt(field(closed, key))}`,
        );
      }
    }
    if (served.dateEnded) {
      reasons.push("the new phase already has an end date");
    }
  }

  // Requested values are matched as written; matchers parse conditions.
  const written = after.experiment.phases[A.phases.length - 1];
  const phaseRequested = Object.entries(expect.phase ?? {});
  for (const [key, expected] of phaseRequested) {
    if (!matches(field(written, key), expected)) {
      reasons.push(
        `phase.${key} is ${fmt(field(written, key))}, expected ${describeExpected(expected)}`,
      );
    }
  }
  const phaseMayChange = new Set<string>([
    "seed",
    ...phaseRequested.map(([k]) => k),
    ...plan.phaseIncidental,
    ...(restartsBandit ? ["variationWeights", "banditEvents"] : []),
  ]);
  for (const key of changedKeys(base, served)) {
    if (!phaseMayChange.has(key)) {
      reasons.push(
        `phase.${key} changed from ${fmt(field(base, key))} to ${fmt(field(served, key))}`,
      );
    }
  }

  const baseSeed = hashSeed(B, base);
  const servedSeed = hashSeed(A, served);
  if (plan.seed === "same" && servedSeed !== baseSeed) {
    reasons.push(
      `seed changed from ${fmt(base.seed)} to ${fmt(served.seed)}, which re-randomizes users`,
    );
  }
  if (plan.seed === "new" && (!servedSeed || servedSeed === baseSeed)) {
    reasons.push(
      `seed is ${fmt(served.seed)}, expected a new seed so users are re-randomized`,
    );
  }
  if (
    restartsBandit &&
    !expect.phase?.variationWeights &&
    !equalWeights().test(served.variationWeights)
  ) {
    reasons.push(
      `bandit weights are ${fmt(served.variationWeights)}, expected equal weights after the restart`,
    );
  }

  return result(reasons);
}
