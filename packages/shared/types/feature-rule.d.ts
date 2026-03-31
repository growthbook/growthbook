import {
  CreateSafeRolloutInterface,
  FeatureRule,
  RampStep,
  RampStepAction,
} from "shared/validators";

/** Wire-format end trigger (dates as ISO strings). */
export type RampEndTrigger = { type: "scheduled"; at: string };

// Inline ramp schedule to create atomically with the rule.
export type InlineRampScheduleCreate = {
  mode: "create";
  name: string;
  // environment the rule lives in (used to build the ramp target)
  environment: string;
  steps: RampStep[];
  // Actions applied when the ramp completes (merged on top of accumulated step patches).
  endActions?: RampStepAction[];
  // ISO datetime string; if set, rule stays disabled until this date, then Step 1 fires.
  // Absent/null means start immediately when the activating revision is published.
  startDate?: string | null;
  endCondition?: {
    trigger?: RampEndTrigger;
  };
};

// Detach a rule from a ramp schedule (removes it from the targets array).
export type InlineRampScheduleDetach = {
  mode: "detach";
  rampScheduleId: string;
  deleteScheduleWhenEmpty?: boolean; // delete schedule when no targets remain
};

// Cancel any pending ramp action (create or detach) for this rule in the draft.
export type InlineRampScheduleClear = {
  mode: "clear";
};

// Update an existing pending/paused ramp schedule.
export type InlineRampScheduleUpdate = {
  mode: "update";
  rampScheduleId: string;
  name?: string;
  steps: RampStep[];
  // Actions applied when the ramp completes (merged on top of accumulated step patches).
  endActions?: RampStepAction[];
  // ISO datetime string; null clears startDate (immediate start).
  startDate?: string | null;
  endCondition?: {
    trigger?: RampEndTrigger;
  } | null;
};

export type PostFeatureRuleBody = {
  rule: FeatureRule;
  environments: string[];
  safeRolloutFields?: CreateSafeRolloutInterface;
  rampSchedule?: InlineRampScheduleCreate | InlineRampScheduleDetach;
};

export type PutFeatureRuleBody = {
  rule: Partial<FeatureRule>;
  environment: string;
  i: number;
  rampSchedule?:
    | InlineRampScheduleCreate
    | InlineRampScheduleUpdate
    | InlineRampScheduleDetach
    | InlineRampScheduleClear;
};
