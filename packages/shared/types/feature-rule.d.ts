import {
  CreateSafeRolloutInterface,
  FeatureRule,
  RampControlledField,
  RampStep,
  RampStepAction,
} from "shared/validators";

/** Wire-format start trigger (dates as ISO strings). */
export type RampStartTrigger =
  | { type: "immediately" }
  | { type: "manual" }
  | { type: "scheduled"; at: string };

/** Wire-format end trigger (dates as ISO strings). */
export type RampEndTrigger = { type: "scheduled"; at: string };

// Inline ramp schedule to create atomically with the rule.
export type InlineRampScheduleCreate = {
  mode: "create";
  name: string;
  // environment the rule lives in (used to build the ramp target)
  environment: string;
  steps: RampStep[];
  startCondition?: {
    trigger: RampStartTrigger;
    actions?: RampStepAction[];
  };
  disableRuleBefore?: boolean;
  disableRuleAfter?: boolean;
  // true = complete when steps finish; false = hold until end date
  endEarlyWhenStepsComplete?: boolean;
  endCondition?: {
    trigger?: RampEndTrigger;
    actions?: RampStepAction[];
  };
  // fields this schedule manages; absent controlled fields in any step are cleared; excludes "enabled" (system-managed)
  controlledFields?: Exclude<RampControlledField, "enabled">[];
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
  startCondition?: {
    // null resets to { trigger: "immediately" }
    trigger?: RampStartTrigger;
    actions?: RampStepAction[];
  } | null;
  disableRuleBefore?: boolean;
  disableRuleAfter?: boolean;
  endEarlyWhenStepsComplete?: boolean;
  endCondition?: {
    // null clears the end condition
    trigger?: RampEndTrigger;
    actions?: RampStepAction[];
  } | null;
  // fields this schedule manages; updates all targets
  controlledFields?: Exclude<RampControlledField, "enabled">[];
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
