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

/** Inline ramp schedule to create atomically with the rule. */
export type InlineRampScheduleCreate = {
  mode: "create";
  name: string;
  /** The environment the rule lives in (used to build the ramp target). */
  environment: string;
  /** May be empty when the ramp is defined purely by startCondition/endCondition triggers. */
  steps: RampStep[];
  /** Start trigger + initial actions, mirrors step shape. Absent = immediately, no start actions. */
  startCondition?: {
    trigger: RampStartTrigger;
    actions?: RampStepAction[];
  };
  /** When true, rule is hidden from SDK payload before the schedule starts. */
  disableRuleBefore?: boolean;
  /** When true, rule is hidden from SDK payload after the schedule ends. */
  disableRuleAfter?: boolean;
  /** When true (default for ramp-ups), complete immediately when all steps finish even if endCondition date is future. When false, hold until the end date fires. */
  endEarlyWhenStepsComplete?: boolean;
  /** End trigger + teardown actions. trigger is optional (no deadline = fires on natural completion). */
  endCondition?: {
    trigger?: RampEndTrigger;
    actions?: RampStepAction[];
  };
  /** Which feature rule fields this schedule manages. Absent controlled fields in any step are cleared. Does not include "enabled" (system-managed). */
  controlledFields?: Exclude<RampControlledField, "enabled">[];
};

/** Link the new rule as an additional target on an existing ramp schedule.
 * TODO: Add linking to existing schedules if/when we implement multiple targets per rule.
 */
// export type InlineRampScheduleLink = {
//   mode: "link";
//   rampScheduleId: string;
// };

/** Detach a rule from a ramp schedule (removes it from the targets array). */
export type InlineRampScheduleDetach = {
  mode: "detach";
  rampScheduleId: string;
  /** If true, delete the ramp schedule if no implementations remain. */
  deleteScheduleWhenEmpty?: boolean;
};

/**
 * Cancel any pending ramp action (create or detach) for this rule in the draft.
 * Sent when the user opens a rule that has a pending detach and saves it without
 * configuring a new ramp schedule, effectively un-queuing the removal.
 */
export type InlineRampScheduleClear = {
  mode: "clear";
};

/** Update an existing pending/paused ramp schedule. */
export type InlineRampScheduleUpdate = {
  mode: "update";
  rampScheduleId: string;
  name?: string;
  steps: RampStep[];
  /** null resets start condition to { trigger: "immediately" }. */
  startCondition?: {
    trigger?: RampStartTrigger;
    actions?: RampStepAction[];
  } | null;
  disableRuleBefore?: boolean;
  disableRuleAfter?: boolean;
  endEarlyWhenStepsComplete?: boolean;
  /** null clears the end condition entirely. */
  endCondition?: {
    trigger?: RampEndTrigger;
    actions?: RampStepAction[];
  } | null;
  /** Which feature rule fields this schedule manages. Updates all targets. */
  controlledFields?: Exclude<RampControlledField, "enabled">[];
};

export type PostFeatureRuleBody = {
  rule: FeatureRule;
  environments: string[];
  safeRolloutFields?: CreateSafeRolloutInterface;
  /** Optional ramp schedule to create or detach atomically with the rule. */
  rampSchedule?: InlineRampScheduleCreate | InlineRampScheduleDetach;
};

export type PutFeatureRuleBody = {
  rule: Partial<FeatureRule>;
  environment: string;
  i: number;
  /** Optional ramp schedule to create, update, detach, or clear atomically with the rule edit. */
  rampSchedule?:
    | InlineRampScheduleCreate
    | InlineRampScheduleUpdate
    | InlineRampScheduleDetach
    | InlineRampScheduleClear;
};
