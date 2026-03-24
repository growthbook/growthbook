/**
 * rampPresets.ts
 *
 * Utilities to generate RampStep[] arrays from high-level preset parameters.
 * All preset-generated steps use cumulative=true on interval triggers internally so
 * total schedule duration is predictable regardless of Agenda processing delays.
 *
 * The `cumulative` flag is an internal implementation detail — it is NEVER exposed
 * in the UI. Users see only the total duration and step count.
 *
 * Naming convention for functions: generateXxxPreset(params) → RampStep[]
 */

import { RampStep, RampStepAction } from "shared/validators";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Common options shared by all presets */
interface BasePresetOptions {
  /** Actions to apply at each step. If an array per step is provided, it overrides the default. */
  stepActions?: RampStepAction[];
}

export interface LinearRampOptions extends BasePresetOptions {
  /** Total ramp duration in seconds */
  totalDurationSeconds: number;
  /** Number of equal-duration interval steps */
  stepCount: number;
}

export interface ApprovalMilestoneOptions extends BasePresetOptions {
  /**
   * Interval durations between milestones (in seconds).
   * Approval gates are inserted before each milestone.
   * E.g. [600, 3600] → interval 10min → approval → interval 1hr → approval → done
   */
  intervalDurationsSeconds: number[];
  /** If true, the last interval step is followed by a final approval gate */
  finalApproval?: boolean;
}

export interface FastRampOptions extends BasePresetOptions {
  /** Interval duration between each step in seconds (default: 300 = 5 minutes) */
  intervalBetweenStepsSeconds?: number;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function intervalStep(
  seconds: number,
  actions: RampStepAction[],
  notifyOnEntry?: boolean,
): RampStep {
  return {
    trigger: {
      type: "interval",
      seconds,
    },
    actions,
    ...(notifyOnEntry ? { notifyOnEntry: true } : {}),
  };
}

function approvalStep(
  actions: RampStepAction[],
  notifyOnEntry?: boolean,
): RampStep {
  return {
    trigger: { type: "approval" },
    actions,
    ...(notifyOnEntry ? { notifyOnEntry: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Linear ramp over a fixed total duration, split into equal interval steps.
 *
 * Example: 30 minutes, 6 steps → each step fires every 5 minutes.
 * Users specify total duration + step count; we compute per-step seconds internally.
 */
export function generateLinearRampPreset(
  options: LinearRampOptions,
): RampStep[] {
  const { totalDurationSeconds, stepCount, stepActions = [] } = options;
  if (stepCount < 1) throw new Error("stepCount must be at least 1");

  const perStepSeconds = totalDurationSeconds / stepCount;
  const steps: RampStep[] = [];

  for (let i = 0; i < stepCount; i++) {
    // Cumulative total at this step = perStepSeconds * (i + 1)
    // With cumulative=true, nextStepAt = phaseStartedAt + perStepSeconds*(i+1)
    steps.push(intervalStep(perStepSeconds * (i + 1), stepActions, i === 0));
  }

  return steps;
}

/**
 * Fast ramp preset: 3 steps with short intervals between them.
 * Typical use: 10% → 50% → 100% coverage, 5 minutes between each.
 * Actions passed in stepActions are applied at every step.
 */
export function generateFastRampPreset(
  options: FastRampOptions = {},
): RampStep[] {
  const {
    intervalBetweenStepsSeconds = 300, // 5 minutes
    stepActions = [],
  } = options;

  return [
    intervalStep(intervalBetweenStepsSeconds, stepActions, true),
    intervalStep(intervalBetweenStepsSeconds * 2, stepActions),
    intervalStep(intervalBetweenStepsSeconds * 3, stepActions),
  ];
}

/**
 * Approval-gated milestones preset.
 * Generates alternating interval → approval → interval → approval … sequences.
 *
 * Example: intervalDurationsSeconds=[600, 3600]
 *   Step 0: interval 10min (notifyOnEntry)
 *   Step 1: approval gate (notifyOnEntry — auto-requests review)
 *   Step 2: interval 1hr
 *   Step 3: approval gate
 */
export function generateApprovalMilestonePreset(
  options: ApprovalMilestoneOptions,
): RampStep[] {
  const {
    intervalDurationsSeconds,
    finalApproval = false,
    stepActions = [],
  } = options;

  if (intervalDurationsSeconds.length === 0) {
    throw new Error("intervalDurationsSeconds must have at least one entry");
  }

  const steps: RampStep[] = [];
  let cumulativeSeconds = 0;

  intervalDurationsSeconds.forEach((seconds, i) => {
    cumulativeSeconds += seconds;
    steps.push(intervalStep(cumulativeSeconds, stepActions, i === 0));
    steps.push(approvalStep(stepActions, true));
  });

  if (!finalApproval && steps[steps.length - 1]?.trigger.type === "approval") {
    // Remove trailing approval if not wanted
    steps.pop();
  }

  return steps;
}

/**
 * Fastest possible ramp: fire a step every `intervalSeconds` for `stepCount` steps.
 * Useful for "at the fastest update cadence supported by my cron schedule."
 * The Agenda job runs every 1 minute, so intervalSeconds >= 60 is effective.
 */
export function generateMinIntervalRampPreset(params: {
  intervalSeconds: number;
  stepCount: number;
  stepActions?: RampStepAction[];
}): RampStep[] {
  const { intervalSeconds, stepCount, stepActions = [] } = params;

  return Array.from({ length: stepCount }, (_, i) =>
    intervalStep(intervalSeconds * (i + 1), stepActions, i === 0),
  );
}

// ---------------------------------------------------------------------------
// Preset registry (for UI preset picker)
// ---------------------------------------------------------------------------

export type PresetKey =
  | "linear"
  | "fast"
  | "approvalMilestones"
  | "minInterval";

export interface PresetMeta {
  key: PresetKey;
  label: string;
  description: string;
}

export const RAMP_PRESET_OPTIONS: PresetMeta[] = [
  {
    key: "linear",
    label: "Linear ramp",
    description:
      "Equal increments over a fixed total duration. Specify total time and number of steps.",
  },
  {
    key: "fast",
    label: "Fast ramp (3 steps)",
    description:
      "Three quick steps with a configurable interval between them. Good for low-risk rollouts.",
  },
  {
    key: "approvalMilestones",
    label: "Approval-gated milestones",
    description:
      "Alternating timed interval and approval gate steps. Ideal for staged rollouts requiring human sign-off at each stage.",
  },
  {
    key: "minInterval",
    label: "Fastest cadence",
    description:
      "Steps fire at the minimum supported interval. Use when you want the fastest possible ramp supported by the scheduler.",
  },
];
