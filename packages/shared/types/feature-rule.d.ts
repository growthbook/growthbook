import {
  CreateSafeRolloutInterface,
  FeatureRule,
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
  /** May be empty when the ramp is defined purely by startTrigger/endSchedule. */
  steps: RampStep[];
  /** Controls when the ramp auto-starts. Absent = "immediately". */
  startTrigger?: RampStartTrigger;
  /** Patch applied immediately when the ramp starts (e.g. set coverage to 0). */
  startActions?: RampStepAction[];
  /**
   * When true, the rule is hidden from the SDK payload while the ramp is pending and again
   * after it completes. The backend auto-injects enabled:true into startActions and
   * enabled:false into the completion patch.
   */
  disableOutsideSchedule?: boolean;
  endSchedule?: {
    trigger: RampEndTrigger;
    actions: RampStepAction[];
  };
};

/** Link the new rule as an additional target on an existing ramp schedule. */
export type InlineRampScheduleLink = {
  mode: "link";
  rampScheduleId: string;
  environment: string;
};

/** Detach a rule from a ramp schedule (removes it from the targets array). */
export type InlineRampScheduleDetach = {
  mode: "detach";
  rampScheduleId: string;
};

/** Update an existing pending/paused ramp schedule. */
export type InlineRampScheduleUpdate = {
  mode: "update";
  rampScheduleId: string;
  name?: string;
  steps: RampStep[];
  /** null clears the trigger back to "immediately". */
  startTrigger?: RampStartTrigger | null;
  startActions?: RampStepAction[] | null;
  disableOutsideSchedule?: boolean | null;
  endSchedule?: { trigger: RampEndTrigger; actions: RampStepAction[] } | null;
};

export type PostFeatureRuleBody = {
  rule: FeatureRule;
  environments: string[];
  safeRolloutFields?: CreateSafeRolloutInterface;
  /** Optional ramp schedule to create, link, or detach atomically with the rule. */
  rampSchedule?:
    | InlineRampScheduleCreate
    | InlineRampScheduleLink
    | InlineRampScheduleDetach;
};

export type PutFeatureRuleBody = {
  rule: Partial<FeatureRule>;
  environment: string;
  i: number;
  /** Optional ramp schedule to create, update, link, or detach atomically with the rule edit. */
  rampSchedule?:
    | InlineRampScheduleCreate
    | InlineRampScheduleUpdate
    | InlineRampScheduleLink
    | InlineRampScheduleDetach;
};
