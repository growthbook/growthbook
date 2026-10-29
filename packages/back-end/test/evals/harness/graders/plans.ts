import type {
  ExperimentInterface,
  ExperimentPhase,
} from "shared/types/experiment";

export type PhaseKey = keyof ExperimentPhase;
export type ExperimentKey = keyof ExperimentInterface;

// The footprint each release plan (or lifecycle action) leaves on an
// experiment. These are written out here on purpose, from the Make Changes
// wizard's behavior, and never imported from the server: a wrong server table
// would otherwise grade itself as correct.
export interface PlanSignature {
  newPhase: boolean;
  seed: "same" | "new";
  // "if-sticky": bumped only when sticky bucketing applies to the experiment;
  // otherwise bucket versions mean nothing and must stay put.
  bucketVersion: "same" | "bump-if-sticky" | "bump";
  minBucketVersion: "same" | "raise-to-bucket-version";
  // Served-phase fields the plan rewrites regardless of what was asked.
  phaseIncidental: PhaseKey[];
  // Experiment fields the plan rewrites regardless of what was asked.
  experimentIncidental: ExperimentKey[];
  // On a bandit, every Make Changes plan restarts exploration with equal
  // weights, even in the same phase.
  restartsBandit: boolean;
}

const NEW_PHASE_INCIDENTAL: PhaseKey[] = [
  "dateStarted",
  "name",
  "reason",
  "lookbackStartDate",
  "banditEvents",
];

export const PLAN_SIGNATURES = {
  // A change with no trade-off (or on a draft) applies directly: same phase,
  // same seed, nobody reassigned.
  "in-place": {
    newPhase: false,
    seed: "same",
    bucketVersion: "same",
    minBucketVersion: "same",
    phaseIncidental: [],
    experimentIncidental: [],
    restartsBandit: true,
  },
  "same-phase-keep-assignments": {
    newPhase: false,
    seed: "same",
    bucketVersion: "same",
    minBucketVersion: "same",
    phaseIncidental: [],
    experimentIncidental: [],
    restartsBandit: true,
  },
  "same-phase-reassign": {
    newPhase: false,
    seed: "same",
    bucketVersion: "bump-if-sticky",
    minBucketVersion: "same",
    phaseIncidental: [],
    experimentIncidental: [],
    restartsBandit: true,
  },
  "new-phase-rerandomize": {
    newPhase: true,
    seed: "new",
    bucketVersion: "bump-if-sticky",
    minBucketVersion: "same",
    phaseIncidental: NEW_PHASE_INCIDENTAL,
    experimentIncidental: [],
    restartsBandit: true,
  },
  "new-phase-keep-assignments": {
    newPhase: true,
    seed: "same",
    bucketVersion: "same",
    minBucketVersion: "same",
    phaseIncidental: NEW_PHASE_INCIDENTAL,
    experimentIncidental: [],
    restartsBandit: true,
  },
  "new-phase-exclude-exposed": {
    newPhase: true,
    seed: "new",
    bucketVersion: "bump",
    minBucketVersion: "raise-to-bucket-version",
    phaseIncidental: NEW_PHASE_INCIDENTAL,
    experimentIncidental: [],
    restartsBandit: true,
  },
  // Starting a draft restarts the phase clock.
  start: {
    newPhase: false,
    seed: "same",
    bucketVersion: "same",
    minBucketVersion: "same",
    phaseIncidental: ["dateStarted"],
    experimentIncidental: [],
    restartsBandit: false,
  },
  // Stopping closes the served phase, with an optional reason and write-up.
  stop: {
    newPhase: false,
    seed: "same",
    bucketVersion: "same",
    minBucketVersion: "same",
    phaseIncidental: ["dateEnded", "reason"],
    experimentIncidental: ["analysis"],
    restartsBandit: false,
  },
} satisfies Record<string, PlanSignature>;

// "untouched" is not a plan: the experiment must come out exactly as seeded.
export type PlanKey = keyof typeof PLAN_SIGNATURES | "untouched";

export const BANDIT_RESET_EXPERIMENT_FIELDS: ExperimentKey[] = [
  "banditStage",
  "banditStageDateStarted",
  "nextSnapshotAttempt",
];
