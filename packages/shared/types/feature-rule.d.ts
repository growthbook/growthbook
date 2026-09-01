import {
  CreateSafeRolloutInterface,
  ExperimentHealthAction,
  FeatureRule,
  LockdownConfig,
  RampMonitoringConfig,
  RampStep,
  RampStepAction,
} from "shared/validators";
import { DraftConflict } from "shared/types/draft-conflict";

// Inline ramp schedule to create atomically with the rule.
export type InlineRampScheduleCreate = {
  mode: "create";
  name?: string;
  // If set, patches are scoped to this environment only.
  // If absent/null, patches apply to all environments that share the ruleId.
  environment?: string | null;
  steps: RampStep[];
  // Actions applied when the ramp starts, before the first step fires.
  startActions?: RampStepAction[];
  // Actions applied when the ramp completes (merged on top of accumulated step patches).
  endActions?: RampStepAction[];
  // ISO datetime string; if set, rule stays disabled until this date, then Step 1 fires.
  // Absent/null means start immediately when the activating revision is published.
  startDate?: string | null;
  // Rule-level kill date (ISO string). When reached, the ramp is completed and
  // the rule is disabled (enabled=false). Use for time-boxed rules that must
  // stop serving on a fixed date regardless of ramp progress. Set to null to clear.
  cutoffDate?: string | null;
  monitoringConfig?: RampMonitoringConfig;
  lockdownConfig?: LockdownConfig;
  experimentHealthAction?: ExperimentHealthAction;
  // When true, the ramp holds at the start (rule disabled, zero traffic) until a
  // human approves via the approve-step action. Composes with startDate.
  requiresStartApproval?: boolean | null;
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
  // Actions applied when the ramp starts, before the first step fires.
  startActions?: RampStepAction[];
  // Actions applied when the ramp completes (merged on top of accumulated step patches).
  endActions?: RampStepAction[];
  // ISO datetime string; null clears startDate (immediate start).
  startDate?: string | null;
  // Rule-level kill date (ISO string). Set to null to clear.
  cutoffDate?: string | null;
  monitoringConfig?: RampMonitoringConfig;
  lockdownConfig?: LockdownConfig;
  experimentHealthAction?: ExperimentHealthAction;
  // Tri-state (mirrors startDate): true = hold for approval, null = explicitly
  // off, undefined/absent = leave unchanged. Toggling on re-arms the gate.
  requiresStartApproval?: boolean | null;
};

export type PostFeatureRuleBody = {
  rule: FeatureRule;
  environments: string[];
  safeRolloutFields?: CreateSafeRolloutInterface;
  rampSchedule?: InlineRampScheduleCreate | InlineRampScheduleDetach;
  // Insert the new rule directly above this rule instead of appending to the
  // end. Falls back to appending when the id isn't in the revision (e.g. the
  // anchor rule was deleted in the draft).
  insertBeforeRuleId?: string;
};

export type PutFeatureRuleConflict = DraftConflict<FeatureRule>;

export type PutFeatureRuleBody = {
  rule: Partial<FeatureRule>;
  // Stable rule locator. Every rule in v2 has an id (assigned at creation
  // or via JIT migration on read), so app callers always send this.
  ruleId: string;
  baseline?: {
    rule: FeatureRule;
  };
  rampSchedule?:
    | InlineRampScheduleCreate
    | InlineRampScheduleUpdate
    | InlineRampScheduleDetach
    | InlineRampScheduleClear;
};
