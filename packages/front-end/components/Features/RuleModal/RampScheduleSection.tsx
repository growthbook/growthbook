// Inline ramp schedule editor inside RuleModal.

import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import pick from "lodash/pick";
import { Box, Flex, Separator, IconButton } from "@radix-ui/themes";
import {
  PiPlusBold,
  PiXBold,
  PiCaretRightFill,
  PiCaretDownFill,
} from "react-icons/pi";
import Collapsible from "react-collapsible";
import type {
  FeatureInterface,
  SavedGroupTargeting,
  FeaturePrerequisite,
} from "shared/types/feature";
import {
  RampScheduleInterface,
  RampStepAction,
  type RampStep,
  type FeatureRulePatch,
} from "shared/validators";
import type { RevisionRampCreateAction } from "shared/src/validators/features";
import {
  getRampBadgeColor,
  getRampStatusLabel,
  getRampStepsCompleted,
} from "@/components/RampSchedule/RampTimeline";
import RampScheduleDisplay from "@/components/RampSchedule/RampScheduleDisplay";
import Badge from "@/ui/Badge";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import Switch from "@/ui/Switch";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import Checkbox from "@/ui/Checkbox";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import Text from "@/ui/Text";
import FeatureValueField from "@/components/Features/FeatureValueField";
import Callout from "@/ui/Callout";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import styles from "./RampScheduleSection.module.scss";

// ─── Types ──────────────────────────────────────────────────────────────────

export type IntervalUnit = "minutes" | "hours" | "days";

export type StepField =
  | "coverage"
  | "condition"
  | "savedGroups"
  | "prerequisites"
  | "force";

export const STEP_FIELD_LABELS: Record<StepField, string> = {
  coverage: "Rollout %",
  condition: "Attribute targeting",
  savedGroups: "Saved groups",
  prerequisites: "Prerequisites",
  force: "Feature value",
};

// coverage is 0–100 in the UI, converted to 0–1 in payloads.
export type UIStepPatch = {
  coverage?: number;
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: FeaturePrerequisite[];
  force?: string;
};

export type UIStep = {
  patch: UIStepPatch;
  triggerType: "interval" | "approval";
  intervalValue: number;
  intervalUnit: IntervalUnit;
  approvalNotes: string;
  notesOpen: boolean; // UI-only: whether the notes field is expanded
};

export type RampMode = "off" | "create" | "edit" | "link";
export type StartMode = "immediately" | "manual" | "specific-time";

export interface RampSectionState {
  mode: RampMode;
  name: string;
  startMode: StartMode; // "immediately" | "manual" | "specific-time"
  startTime: string; // ISO datetime, only used when startMode === "specific-time"
  startPatch: UIStepPatch; // patch applied when the ramp starts (e.g. coverage: 0)
  disableRuleBefore: boolean;
  disableRuleAfter: boolean;
  // true = complete when steps finish (ramp-up); false = hold until end date (scheduled rule)
  endEarlyWhenStepsComplete: boolean;
  steps: UIStep[];
  endScheduleAt: string; // "" = automatic end; non-empty = specific time
  endPatch: UIStepPatch;
  linkedRampId: string;
}

const UNIT_MULT: Record<IntervalUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

export const VALID_STEP_FIELDS: StepField[] = [
  "coverage",
  "force",
  "condition",
  "savedGroups",
  "prerequisites",
];

export function scrubRampStateForRuleType(
  state: RampSectionState,
): RampSectionState {
  const scrub = (p: UIStepPatch): UIStepPatch =>
    pick(p, VALID_STEP_FIELDS) as UIStepPatch;
  return {
    ...state,
    startPatch: scrub(state.startPatch),
    endPatch: scrub(state.endPatch),
    steps: state.steps.map((s) => ({ ...s, patch: scrub(s.patch) })),
  };
}

export function isRampSectionConfigured(state: RampSectionState): boolean {
  return (
    state.mode !== "create" ||
    state.steps.length > 0 ||
    state.startMode === "specific-time" ||
    !!state.endScheduleAt
  );
}

// ─── Grid column widths ──────────────────────────────────────────────────────

const COL = {
  num: 30, // "1" / "2" / "start" / "end"
  trigger: 130, // trigger type select
  duration: 200, // trigger details (interval inputs, datetime, "Awaiting approval")
  coverage: 80, // [number] %
} as const;

// ─── Build helpers ───────────────────────────────────────────────────────────

export function buildPatch(
  patch: UIStepPatch,
  ruleId: string,
): RampStepAction["patch"] {
  const out: RampStepAction["patch"] = { ruleId };
  if (patch.coverage !== undefined) out.coverage = patch.coverage / 100;
  if (patch.condition !== undefined) out.condition = patch.condition;
  if (patch.savedGroups !== undefined) out.savedGroups = patch.savedGroups;
  if (patch.prerequisites !== undefined)
    out.prerequisites = patch.prerequisites;
  if (patch.force !== undefined) {
    try {
      out.force = JSON.parse(patch.force);
    } catch {
      out.force = patch.force;
    }
  }
  return out;
}

export function buildRampSteps(
  steps: UIStep[],
  targetId: string,
  ruleId: string,
) {
  return steps.map((s) => {
    const patch = buildPatch(s.patch, ruleId);
    return {
      trigger:
        s.triggerType === "interval"
          ? {
              type: "interval" as const,
              seconds: s.intervalValue * UNIT_MULT[s.intervalUnit],
            }
          : { type: "approval" as const },
      actions: [{ targetType: "feature-rule" as const, targetId, patch }],
      ...(s.triggerType === "approval" && s.approvalNotes
        ? { approvalNotes: s.approvalNotes }
        : {}),
    };
  });
}

export function buildStartActions(
  patch: UIStepPatch,
  targetId: string,
  ruleId: string,
): RampStepAction[] {
  const hasAny = Object.values(patch).some((v) => v !== undefined);
  if (!hasAny) return [];
  return [
    {
      targetType: "feature-rule" as const,
      targetId,
      patch: buildPatch(patch, ruleId) as RampStepAction["patch"],
    },
  ];
}

export function buildEndScheduleActions(
  patch: UIStepPatch,
  targetId: string,
  ruleId: string,
): RampStepAction[] {
  const hasAny = Object.values(patch).some((v) => v !== undefined);
  if (!hasAny) return [];
  return [
    {
      targetType: "feature-rule" as const,
      targetId,
      patch: buildPatch(patch, ruleId) as RampStepAction["patch"],
    },
  ];
}

// Returns a validation error message if any required date fields are missing, or null if valid.
export function validateRampSectionState(
  state: RampSectionState,
): string | null {
  if (state.mode === "off" || state.mode === "link") return null;
  if (state.startMode === "specific-time" && !state.startTime) {
    return "A start date is required.";
  }
  // endScheduleAt non-empty means the end trigger type is "specific-time".
  // If it's empty but was intended to be set (user has not filled it in), we can't
  // detect that from state alone — instead, the DatePicker simply won't submit a date,
  // which leaves endScheduleAt="". We therefore block only when a specific-time end
  // was expected: treat endScheduleAt="" + disableRuleAfter=true as incomplete
  // because all three scheduled presets that require an end date also set disableRuleAfter.
  // (A plain ramp with disableRuleAfter=true and automatic end is valid — only the
  // scheduled "Disable rule on specific date" presets set both together.)
  // More precisely: if the end SelectField shows "Specific time" (endScheduleAt non-empty)
  // we're fine. If it's empty and disableRuleAfter is true AND there are no steps, that
  // means it's a pure scheduled rule that needs an end date.
  if (
    state.disableRuleAfter &&
    state.endScheduleAt === "" &&
    state.steps.length === 0
  ) {
    return "An end date is required.";
  }
  return null;
}

// ─── Small reusable sub-components ──────────────────────────────────────────

function ColHeader({
  children,
  width,
  align = "left",
}: {
  children: ReactNode;
  width: number;
  align?: "left" | "center";
}) {
  return (
    <Box style={{ width, flexShrink: 0, textAlign: align }}>
      <Text size="small" weight="medium" color="text-low">
        {children}
      </Text>
    </Box>
  );
}

// ─── Presets ─────────────────────────────────────────────────────────────────

// Presets use apply-first semantics: each step's effects are applied immediately,
// then the step holds for its own interval before advancing. The initial 0% state
// is applied by startCondition.actions; steps start from the first non-zero coverage.
// Step counts do NOT include the start anchor (step 0).
const RAMP_PRESETS: {
  label: string;
  name: string;
  defaultDurationValue: number;
  defaultDurationUnit: IntervalUnit;
  coverages: number[];
  triggerType: "interval" | "approval";
  // Approval-gated presets start manually so the user confirms before anything fires
  manualStart?: boolean;
}[] = [
  {
    label: "Standard (1, 5, 10, 25, 50, 100)",
    name: "standard ramp-up",
    defaultDurationValue: 1,
    defaultDurationUnit: "hours",
    coverages: [1, 5, 10, 25, 50, 100],
    triggerType: "interval",
  },
  {
    label: "Safe (Standard, with approval steps)",
    name: "safe standard ramp-up",
    defaultDurationValue: 1,
    defaultDurationUnit: "hours",
    coverages: [1, 5, 10, 25, 50, 100],
    triggerType: "approval",
    manualStart: true,
  },
  {
    label: "Quick (10, 50, 100)",
    name: "quick ramp-up",
    defaultDurationValue: 10,
    defaultDurationUnit: "minutes",
    coverages: [10, 50, 100],
    triggerType: "interval",
  },
  {
    label: "Quick safe (Quick, with approval steps)",
    name: "quick safe ramp-up",
    defaultDurationValue: 10,
    defaultDurationUnit: "minutes",
    coverages: [10, 50, 100],
    triggerType: "approval",
    manualStart: true,
  },
  {
    label: "Linear (5 steps)",
    name: "linear 5-step ramp-up",
    defaultDurationValue: 1,
    defaultDurationUnit: "hours",
    coverages: [20, 40, 60, 80, 100],
    triggerType: "interval",
  },
  {
    label: "Linear (10 steps)",
    name: "linear 10-step ramp-up",
    defaultDurationValue: 1,
    defaultDurationUnit: "hours",
    coverages: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    triggerType: "interval",
  },
];

/**
 * Detect which preset (if any) matches the given steps + start configuration.
 *
 * Returns the preset label string if a match is found, "custom" if steps exist
 * but don't match any preset, or "" (empty) if there are no steps yet.
 *
 * Matching rules:
 *  - Step count must equal preset.coverages.length
 *  - Every step's triggerType must match preset.triggerType
 *  - Every step's patch.coverage must equal the corresponding preset coverage value
 *  - Each step's patch must contain ONLY coverage (no extra effects)
 *  - manualStart flag must match (preset.manualStart ↔ startMode === "manual")
 *  - disableRuleBefore / disableRuleAfter must both be false (presets don't set these)
 */
function detectPreset(
  steps: UIStep[],
  startMode: StartMode,
  disableRuleBefore: boolean,
  disableRuleAfter: boolean,
): string {
  if (steps.length === 0) return "";
  // Presets never enable disableRuleBefore/After — any such config is custom.
  if (disableRuleBefore || disableRuleAfter) return "custom";

  for (const preset of RAMP_PRESETS) {
    if (steps.length !== preset.coverages.length) continue;

    const triggerMatches = steps.every(
      (s) => s.triggerType === preset.triggerType,
    );
    if (!triggerMatches) continue;

    const manualStartExpected = !!preset.manualStart;
    if (manualStartExpected !== (startMode === "manual")) continue;

    const coveragesMatch = steps.every(
      (s, i) => s.patch.coverage === preset.coverages[i],
    );
    if (!coveragesMatch) continue;

    // Reject if any step has effects beyond just coverage.
    const hasExtraEffects = steps.some((s) => {
      const keys = (Object.keys(s.patch) as StepField[]).filter(
        (k) => k !== "coverage" && s.patch[k] !== undefined,
      );
      return keys.length > 0;
    });
    if (hasExtraEffects) continue;

    return preset.label;
  }

  return "custom";
}

// Divide total duration evenly across interval steps. Approval steps use 10 min
// as a placeholder (trigger type controls advancement, not the interval value).
// Respects activeFields so every step is pre-populated with baseline values.
function buildPresetSteps(
  coverages: number[],
  triggerType: "interval" | "approval",
  totalDurationValue: number,
  totalDurationUnit: IntervalUnit,
  activeFields: Set<StepField>,
  ruleBaseline: Partial<UIStepPatch>,
): UIStep[] {
  const totalSeconds = totalDurationValue * UNIT_MULT[totalDurationUnit];
  const intervalCount = triggerType === "interval" ? coverages.length : 1;
  const perStepSeconds = Math.max(1, Math.ceil(totalSeconds / intervalCount));
  const intervalUnit: IntervalUnit =
    perStepSeconds % 86400 === 0 && perStepSeconds >= 86400
      ? "days"
      : perStepSeconds % 3600 === 0 && perStepSeconds >= 3600
        ? "hours"
        : "minutes";
  const intervalValue =
    intervalUnit === "days"
      ? perStepSeconds / 86400
      : intervalUnit === "hours"
        ? perStepSeconds / 3600
        : Math.ceil(perStepSeconds / 60);

  return coverages.map((coverage) => {
    const patch: UIStepPatch = {};
    if (activeFields.has("coverage")) patch.coverage = coverage;
    if (activeFields.has("condition"))
      patch.condition = ruleBaseline.condition ?? "{}";
    if (activeFields.has("savedGroups"))
      patch.savedGroups = ruleBaseline.savedGroups ?? [];
    if (activeFields.has("prerequisites"))
      patch.prerequisites = ruleBaseline.prerequisites ?? [];
    if (activeFields.has("force")) patch.force = ruleBaseline.force ?? "";
    return {
      patch,
      triggerType,
      intervalValue,
      intervalUnit,
      approvalNotes: "",
      notesOpen: false,
    };
  });
}

// Apply a total duration to existing interval steps by dividing evenly.
function applyTotalDuration(
  steps: UIStep[],
  totalDurationValue: number,
  totalDurationUnit: IntervalUnit,
): UIStep[] {
  const intervalSteps = steps.filter((s) => s.triggerType === "interval");
  if (intervalSteps.length === 0) return steps;
  const totalSeconds = totalDurationValue * UNIT_MULT[totalDurationUnit];
  const perStepSeconds = Math.max(
    1,
    Math.ceil(totalSeconds / intervalSteps.length),
  );
  const intervalUnit: IntervalUnit =
    perStepSeconds % 86400 === 0 && perStepSeconds >= 86400
      ? "days"
      : perStepSeconds % 3600 === 0 && perStepSeconds >= 3600
        ? "hours"
        : "minutes";
  const intervalValue =
    intervalUnit === "days"
      ? perStepSeconds / 86400
      : intervalUnit === "hours"
        ? perStepSeconds / 3600
        : Math.ceil(perStepSeconds / 60);
  return steps.map((s) =>
    s.triggerType === "interval" ? { ...s, intervalValue, intervalUnit } : s,
  );
}

// ─── Active-field helpers (exported for use in parent forms) ─────────────────

export function activeFieldsFromState(state: RampSectionState): Set<StepField> {
  const fields = new Set<StepField>();
  state.steps.forEach((s) => {
    (Object.keys(s.patch) as StepField[]).forEach((k) => fields.add(k));
  });
  (Object.keys(state.startPatch) as StepField[]).forEach((k) => fields.add(k));
  (Object.keys(state.endPatch) as StepField[]).forEach((k) => fields.add(k));
  return fields;
}

// Rebuild all patches to include exactly newFields; new fields are seeded from baseline.
export function rebuildStateWithActiveFields(
  state: RampSectionState,
  newFields: StepField[],
  baseline: Partial<UIStepPatch>,
): RampSectionState {
  const newSet = new Set(newFields);
  const n = state.steps.length;

  const baselineFor = (f: StepField): unknown => {
    if (baseline[f] !== undefined) return baseline[f];
    if (f === "savedGroups" || f === "prerequisites") return [];
    if (f === "coverage") return 0;
    return "";
  };

  const rebuildPatch = (existing: UIStepPatch, idx?: number): UIStepPatch => {
    const p: UIStepPatch = {};
    newSet.forEach((f) => {
      if (existing[f] !== undefined) {
        (p as Record<string, unknown>)[f] = existing[f];
      } else if (f === "coverage" && idx !== undefined) {
        p.coverage = Math.round(((idx + 1) / Math.max(n, 1)) * 100);
      } else {
        (p as Record<string, unknown>)[f] = baselineFor(f);
      }
    });
    return p;
  };

  return {
    ...state,
    startPatch: rebuildPatch(state.startPatch),
    // Pre-seed coverage: 100 so newly-activated coverage on the end patch
    // defaults to 100% rather than 0. Explicitly-set values are preserved.
    endPatch: rebuildPatch({
      coverage: 100,
      ...state.endPatch,
    }),
    steps: state.steps.map((s, i) => ({
      ...s,
      patch: rebuildPatch(s.patch, i),
    })),
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  featureRampSchedules: RampScheduleInterface[];
  ruleRampSchedule: RampScheduleInterface | undefined;
  state: RampSectionState;
  setState: (s: RampSectionState) => void;
  hideOuterToggle?: boolean;
  feature: FeatureInterface;
  environments: string[];
  onSetRuleCoverage?: (coverage: number) => void;
  // Live rule values used as defaults when a new field is first added to the schedule.
  ruleBaseline?: UIStepPatch;
  // The rule type this schedule is attached to. Used to hide unsupported fields
  // (e.g. coverage on force rules) and auto-convert when a coverage preset is chosen.
  ruleType?: "force" | "rollout";
  // Called when a coverage-based preset is selected while ruleType === "force".
  onConvertToRollout?: () => void;
  // When true, wraps the step grid + more options in an appbox card,
  // leaving the preset/duration controls outside. Used by the standalone modal.
  boxStepGrid?: boolean;
  // When true, hides the name field from the UI. Used in standalone modal to hide
  // the naming concept from the editor. Name is still stored/managed but not editable.
  hideNameField?: boolean;
  // When true, a draft detach action is pending for this rule. Shows a "pending removal"
  // badge in place of the normal status badge.
  pendingDetach?: boolean;
}

type CopyTarget =
  | "empty"
  | "all"
  | "subsequent"
  | "previous"
  | "start"
  | "end"
  | number;

interface CopyToDropdownProps {
  field: StepField;
  currentStepIndex: number | "start" | "end";
  state: RampSectionState;
  isPatchFieldEmpty: (p: UIStepPatch, field: StepField) => boolean;
  onCopy: (field: StepField, target: CopyTarget) => void;
}

function CopyToDropdown({
  field,
  currentStepIndex,
  state,
  isPatchFieldEmpty,
  onCopy,
}: CopyToDropdownProps) {
  const [open, setOpen] = useState(false);

  function pick(target: CopyTarget) {
    onCopy(field, target);
    setOpen(false);
  }

  const hasEmptyTargets =
    (currentStepIndex !== "start" &&
      isPatchFieldEmpty(state.startPatch, field)) ||
    state.steps.some(
      (s, i) => i !== currentStepIndex && isPatchFieldEmpty(s.patch, field),
    ) ||
    (currentStepIndex !== "end" && isPatchFieldEmpty(state.endPatch, field));

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Link
          type="button"
          style={{ color: "var(--color-text-mid)", fontSize: "13px" }}
        >
          Copy to... <PiCaretDownFill style={{ fontSize: "9px" }} />
        </Link>
      }
      menuPlacement="end"
      variant="soft"
    >
      <DropdownMenuGroup>
        {hasEmptyTargets && (
          <DropdownMenuItem onClick={() => pick("empty")}>
            Empty steps
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => pick("all")}>
          All steps
        </DropdownMenuItem>
        {currentStepIndex !== "end" && (
          <DropdownMenuItem onClick={() => pick("subsequent")}>
            Future steps
          </DropdownMenuItem>
        )}
        {currentStepIndex !== "start" && (
          <DropdownMenuItem onClick={() => pick("previous")}>
            Previous steps
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      <DropdownSubMenu trigger="Step">
        {currentStepIndex !== "start" && (
          <DropdownMenuItem onClick={() => pick("start")}>
            Start
          </DropdownMenuItem>
        )}
        {state.steps.map((_, i) =>
          i === currentStepIndex ? null : (
            <DropdownMenuItem key={i} onClick={() => pick(i)}>
              Step {i + 1}
            </DropdownMenuItem>
          ),
        )}
        {currentStepIndex !== "end" && (
          <DropdownMenuItem onClick={() => pick("end")}>End</DropdownMenuItem>
        )}
      </DropdownSubMenu>
    </DropdownMenu>
  );
}

export default function RampScheduleSection({
  featureRampSchedules: _featureRampSchedules,
  ruleRampSchedule,
  state,
  setState,
  hideOuterToggle = false,
  feature,
  environments,
  onSetRuleCoverage,
  ruleBaseline = {},
  ruleType,
  onConvertToRollout,
  boxStepGrid = false,
  hideNameField = false,
  pendingDetach = false,
}: Props) {
  const [open, setOpen] = useState(hideOuterToggle || state.mode !== "off");

  // Per-step version counters for ConditionInput (uncontrolled) — incremented
  // when a copy operation writes a new condition value into a step so the
  // component remounts and picks up the new defaultValue.
  const [conditionVersions, setConditionVersions] = useState<
    Record<string, number>
  >({});

  // Auto-switch to "create" mode when opening a ramp editor with no existing ramp
  useEffect(() => {
    if (!ruleRampSchedule && state.mode === "off") {
      patchState({ mode: "create" });
    }
    // patchState is stable (wrapped in useCallback) — omitting it avoids an infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleRampSchedule, state.mode]);

  const [moreOptionsOpen, setMoreOptionsOpen] = useState(() => {
    if (state.disableRuleBefore || state.disableRuleAfter) return true;
    // Open if any field beyond coverage is controlled
    const fields = new Set<StepField>();
    state.steps.forEach((s) =>
      (Object.keys(s.patch) as StepField[]).forEach((k) => fields.add(k)),
    );
    (Object.keys(state.startPatch) as StepField[]).forEach((k) =>
      fields.add(k),
    );
    (Object.keys(state.endPatch) as StepField[]).forEach((k) => fields.add(k));
    return fields.size > 1 || (fields.size === 1 && !fields.has("coverage"));
  });
  const [durationValue, setDurationValue] = useState<string>(() => {
    const detected = detectPreset(
      state.steps,
      state.startMode,
      state.disableRuleBefore,
      state.disableRuleAfter,
    );
    return String(
      RAMP_PRESETS.find((p) => p.label === detected)?.defaultDurationValue ??
        10,
    );
  });
  const [durationUnit, setDurationUnit] = useState<IntervalUnit>(() => {
    const detected = detectPreset(
      state.steps,
      state.startMode,
      state.disableRuleBefore,
      state.disableRuleAfter,
    );
    return (
      RAMP_PRESETS.find((p) => p.label === detected)?.defaultDurationUnit ??
      "minutes"
    );
  });
  const [durationDirty, setDurationDirty] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(() =>
    detectPreset(
      state.steps,
      state.startMode,
      state.disableRuleBefore,
      state.disableRuleAfter,
    ),
  );
  const pollIntervalSeconds = 60;

  function patchState(partial: Partial<RampSectionState>) {
    setState({ ...state, ...partial });
  }

  // Active fields are derived from all patches (start, steps, end).
  const activeFields = useMemo<Set<StepField>>(
    () => activeFieldsFromState(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.steps, state.startPatch, state.endPatch],
  );

  // ── Step mutations ──────────────────────────────────────────────────────────

  function updateStep(i: number, update: Partial<UIStep>) {
    setSelectedPreset("custom");
    patchState({
      steps: state.steps.map((s, idx) => (idx === i ? { ...s, ...update } : s)),
    });
  }

  function updateStepPatch(i: number, field: StepField, value: unknown) {
    setSelectedPreset("custom");
    patchState({
      steps: state.steps.map((s, idx) =>
        idx === i ? { ...s, patch: { ...s.patch, [field]: value } } : s,
      ),
    });
  }

  function removeStep(i: number) {
    setSelectedPreset("custom");
    patchState({ steps: state.steps.filter((_, idx) => idx !== i) });
  }

  function addStep() {
    setSelectedPreset("custom");
    const last = state.steps[state.steps.length - 1];
    const newPatch: UIStepPatch = {};
    if (activeFields.has("coverage")) {
      newPatch.coverage =
        last?.patch.coverage !== undefined
          ? Math.min(100, last.patch.coverage + 20)
          : 50;
    }
    if (activeFields.has("condition"))
      newPatch.condition = ruleBaseline.condition ?? "";
    if (activeFields.has("savedGroups"))
      newPatch.savedGroups = ruleBaseline.savedGroups ?? [];
    if (activeFields.has("prerequisites"))
      newPatch.prerequisites = ruleBaseline.prerequisites ?? [];
    if (activeFields.has("force")) newPatch.force = ruleBaseline.force ?? "";

    patchState({
      steps: [
        ...state.steps,
        {
          patch: newPatch,
          triggerType: "interval",
          intervalValue: last?.intervalValue ?? 10,
          intervalUnit: last?.intervalUnit ?? "minutes",
          approvalNotes: "",
          notesOpen: false,
        },
      ],
    });
  }

  // ── Toggle ────────────────────────────────────────────────────────────────

  function handleToggle(checked: boolean) {
    setOpen(checked);
    if (!checked) {
      patchState({ mode: "off" });
    } else if (ruleRampSchedule) {
      patchState({ mode: "edit", linkedRampId: ruleRampSchedule.id });
    } else {
      patchState({ mode: "create" });
    }
  }

  // ── Step grid ─────────────────────────────────────────────────────────────

  function renderStepGrid() {
    const endTriggerType = state.endScheduleAt
      ? state.endEarlyWhenStepsComplete
        ? "on-or-before"
        : "on"
      : "automatic";
    const hasTargeting = (
      ["condition", "savedGroups", "prerequisites"] as StepField[]
    ).some((f) => activeFields.has(f));
    const hasEffects = activeFields.has("force") || hasTargeting;
    const rowBorder: React.CSSProperties = hasEffects
      ? { borderBottom: "1px solid var(--gray-a6)" }
      : {};
    const subRowIndent = COL.num + 16;
    const effectsHeader = activeFields.has("coverage")
      ? "Other effects"
      : "Effects";
    const effectsCount = (
      ["force", "condition", "savedGroups", "prerequisites"] as StepField[]
    ).filter((f) => activeFields.has(f)).length;

    // Sub-row renderer for feature value + targeting fields.
    // Force value is shown as the first sub-row (above targeting).
    // A section header is shown when any effects are active.
    function renderPatchSubRows(
      patch: UIStepPatch,
      setPatchFn: (field: StepField, value: unknown) => void,
      currentStepIndex: number | "start" | "end",
    ) {
      if (!hasEffects) return null;

      // A patch field counts as "empty" when it hasn't been meaningfully filled in.
      function isPatchFieldEmpty(p: UIStepPatch, field: StepField): boolean {
        const v = p[field];
        if (v === undefined) return true;
        if (field === "condition") return v === "" || v === "{}";
        if (field === "savedGroups" || field === "prerequisites")
          return Array.isArray(v) && v.length === 0;
        return false;
      }

      // Helper to copy current patch field value to other steps
      function copyFieldValue(field: StepField, target: CopyTarget) {
        const sourceValue = patch[field];
        const newState = { ...state };

        // Maps start/end/number to a comparable position in the step sequence.
        const order = (idx: number | "start" | "end"): number => {
          if (idx === "start") return -1;
          if (idx === "end") return state.steps.length;
          return idx;
        };
        const currentOrder = order(currentStepIndex);

        const shouldUpdatePatch = (
          targetPatch: UIStepPatch,
          targetIndex: number | "start" | "end",
        ): boolean => {
          if (targetIndex === currentStepIndex) return false;

          if (target === "all") return true;
          if (target === "empty") return isPatchFieldEmpty(targetPatch, field);
          if (target === "subsequent") return order(targetIndex) > currentOrder;
          if (target === "previous") return order(targetIndex) < currentOrder;
          if (target === "start") return targetIndex === "start";
          if (target === "end") return targetIndex === "end";
          if (typeof target === "number") return targetIndex === target;
          return false;
        };

        if (shouldUpdatePatch(newState.startPatch, "start")) {
          newState.startPatch = {
            ...newState.startPatch,
            [field]: sourceValue,
          };
        }

        newState.steps = newState.steps.map((step, i) => {
          if (shouldUpdatePatch(step.patch, i)) {
            return { ...step, patch: { ...step.patch, [field]: sourceValue } };
          }
          return step;
        });

        if (shouldUpdatePatch(newState.endPatch, "end")) {
          newState.endPatch = { ...newState.endPatch, [field]: sourceValue };
        }

        setState(newState);

        // ConditionInput is uncontrolled (useState(defaultValue)), so we must
        // bump the version for each affected step to force a remount.
        if (field === "condition") {
          setConditionVersions((prev) => {
            const next = { ...prev };
            if (shouldUpdatePatch(newState.startPatch, "start")) {
              next["start"] = (next["start"] ?? 0) + 1;
            }
            newState.steps.forEach((_, i) => {
              if (shouldUpdatePatch(newState.steps[i].patch, i)) {
                next[String(i)] = (next[String(i)] ?? 0) + 1;
              }
            });
            if (shouldUpdatePatch(newState.endPatch, "end")) {
              next["end"] = (next["end"] ?? 0) + 1;
            }
            return next;
          });
        }
      }

      const trigger = (
        <Flex
          align="center"
          gap="1"
          style={{ cursor: "pointer", userSelect: "none" }}
        >
          <PiCaretRightFill
            className="chevron"
            style={{ flexShrink: 0, color: "var(--color-text-low)" }}
          />
          <Text as="div" size="small" weight="medium" color="text-low" my="1">
            {effectsHeader} ({effectsCount} total)
          </Text>
        </Flex>
      );
      return (
        <Box pb="1" style={{ paddingLeft: subRowIndent }}>
          <Collapsible
            trigger={trigger}
            open={state.mode === "create"}
            transitionTime={100}
          >
            <Box pt="2">
              {activeFields.has("force") && (
                <Box mb="4">
                  <Text
                    as="div"
                    size="small"
                    weight="medium"
                    color="text-low"
                    my="1"
                  >
                    Feature value
                  </Text>
                  <FeatureValueField
                    id={`${currentStepIndex}-force`}
                    valueType={feature.valueType}
                    value={String(patch.force ?? "")}
                    setValue={(v) => setPatchFn("force", v)}
                    feature={feature}
                    useDropdown={feature.valueType === "boolean"}
                    hideCopyButton
                  />
                </Box>
              )}
              {activeFields.has("condition") && (
                <Box mb="4">
                  <ConditionInput
                    key={`${currentStepIndex}-condition-${conditionVersions[String(currentStepIndex)] ?? 0}`}
                    defaultValue={patch.condition ?? "{}"}
                    onChange={(v) => setPatchFn("condition", v)}
                    project={feature.project ?? ""}
                    slimMode
                    labelActions={
                      <CopyToDropdown
                        field="condition"
                        currentStepIndex={currentStepIndex}
                        state={state}
                        isPatchFieldEmpty={isPatchFieldEmpty}
                        onCopy={copyFieldValue}
                      />
                    }
                  />
                </Box>
              )}
              {activeFields.has("savedGroups") && (
                <Box mb="4">
                  <SavedGroupTargetingField
                    value={patch.savedGroups ?? []}
                    setValue={(v) => setPatchFn("savedGroups", v)}
                    project={feature.project ?? ""}
                    slimMode
                    labelActions={
                      <CopyToDropdown
                        field="savedGroups"
                        currentStepIndex={currentStepIndex}
                        state={state}
                        isPatchFieldEmpty={isPatchFieldEmpty}
                        onCopy={copyFieldValue}
                      />
                    }
                  />
                </Box>
              )}
              {activeFields.has("prerequisites") && (
                <Box mb="4">
                  <PrerequisiteInput
                    value={patch.prerequisites ?? []}
                    setValue={(v) => setPatchFn("prerequisites", v)}
                    feature={feature}
                    environments={environments}
                    setPrerequisiteTargetingSdkIssues={() => {}}
                    slimMode
                    labelActions={
                      <CopyToDropdown
                        field="prerequisites"
                        currentStepIndex={currentStepIndex}
                        state={state}
                        isPatchFieldEmpty={isPatchFieldEmpty}
                        onCopy={copyFieldValue}
                      />
                    }
                  />
                </Box>
              )}
            </Box>
          </Collapsible>
        </Box>
      );
    }

    // ── Start anchor row — always visible ────────────────────────────────────

    const START_OPTIONS = [
      {
        value: "immediately",
        label: "Auto start",
        tooltip: "Starts as soon as the draft is published",
      },
      {
        value: "manual",
        label: "Manual start",
        tooltip: "Starts after user confirmation",
      },
      {
        value: "specific-time",
        label: "Start date",
        tooltip: "Starts at a specific time after draft is published",
      },
    ];

    const startRow = (
      <div style={rowBorder}>
        <Flex align="center" gap="4" py="2">
          <Box style={{ width: COL.num, flexShrink: 0 }}>
            <Text size="small" weight="medium" color="text-low">
              start
            </Text>
          </Box>
          {activeFields.has("coverage") && (
            <Box style={{ width: COL.coverage, flexShrink: 0 }}>
              <div className={`position-relative ${styles.percentInputWrap}`}>
                <Field
                  style={{ width: COL.coverage, minHeight: 38 }}
                  type="number"
                  min="0"
                  max="100"
                  onFocus={(e) => e.target.select()}
                  value={String(state.startPatch.coverage ?? 0)}
                  onChange={(e) =>
                    patchState({
                      startPatch: {
                        ...state.startPatch,
                        coverage: Math.min(
                          100,
                          Math.max(0, parseInt(e.target.value) || 0),
                        ),
                      },
                    })
                  }
                />
                <span>%</span>
              </div>
            </Box>
          )}
          <Flex
            align="center"
            gap="2"
            style={{ width: COL.trigger + COL.duration, flexShrink: 0 }}
          >
            <Box style={{ width: COL.trigger, flexShrink: 0 }}>
              <SelectField
                value={state.startMode}
                options={START_OPTIONS}
                onChange={(v) => {
                  const mode = v as StartMode;
                  if (mode === "immediately" || mode === "manual") {
                    patchState({ startMode: mode, startTime: "" });
                  } else {
                    const d = new Date();
                    d.setSeconds(0, 0);
                    patchState({
                      startMode: mode,
                      startTime: d.toISOString().slice(0, 16),
                    });
                  }
                }}
                containerClassName="mb-0"
                containerStyle={{ minHeight: 38 }}
                useMultilineLabels
                formatOptionLabel={(option, meta) => {
                  if (meta.context === "value") return <>{option.label}</>;
                  return (
                    <div>
                      <div>{option.label}</div>
                      {option.tooltip && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-low)",
                            marginTop: 1,
                          }}
                        >
                          {option.tooltip}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
            </Box>
            {state.startMode === "specific-time" && (
              <Box style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <DatePicker
                  date={state.startTime || undefined}
                  setDate={(d) =>
                    patchState({ startTime: d ? d.toISOString() : "" })
                  }
                  precision="datetime"
                  containerClassName="mb-0"
                />
              </Box>
            )}
          </Flex>
        </Flex>
        {renderPatchSubRows(
          state.startPatch,
          (field, value) =>
            patchState({ startPatch: { ...state.startPatch, [field]: value } }),
          "start",
        )}
      </div>
    );

    // ── End anchor row — always visible ──────────────────────────────────────

    const endRow = (
      <div style={rowBorder}>
        <Flex align="center" gap="4" py="2">
          <Box style={{ width: COL.num, flexShrink: 0 }}>
            <Text size="small" weight="medium" color="text-low">
              end
            </Text>
          </Box>
          {activeFields.has("coverage") && (
            <Box style={{ width: COL.coverage, flexShrink: 0 }}>
              <div className={`position-relative ${styles.percentInputWrap}`}>
                <Field
                  style={{ width: COL.coverage, minHeight: 38 }}
                  type="number"
                  min="0"
                  max="100"
                  onFocus={(e) => e.target.select()}
                  value={String(state.endPatch.coverage ?? 100)}
                  onChange={(e) =>
                    patchState({
                      endPatch: {
                        ...state.endPatch,
                        coverage: Math.min(
                          100,
                          Math.max(0, parseInt(e.target.value) || 0),
                        ),
                      },
                    })
                  }
                />
                <span>%</span>
              </div>
            </Box>
          )}
          <Flex
            align="center"
            gap="2"
            style={{ width: COL.trigger + COL.duration, flexShrink: 0 }}
          >
            <Box style={{ width: COL.trigger, flexShrink: 0 }}>
              <SelectField
                value={endTriggerType}
                options={[
                  {
                    value: "automatic",
                    label: "Complete",
                    tooltip: "Ends after all steps complete",
                  },
                  {
                    value: "on",
                    label: "End date",
                    tooltip: "Ends at a specific time",
                  },
                  {
                    value: "on-or-before",
                    label: "On or before",
                    tooltip:
                      "Ends either when all steps finish or at a specific time",
                  },
                ]}
                onChange={(v) => {
                  if (v === "automatic") {
                    patchState({
                      endScheduleAt: "",
                      endEarlyWhenStepsComplete: false,
                    });
                  } else {
                    const d = new Date();
                    d.setSeconds(0, 0);
                    patchState({
                      endScheduleAt: d.toISOString().slice(0, 16),
                      endEarlyWhenStepsComplete: v === "on-or-before",
                    });
                  }
                }}
                containerClassName="mb-0"
                containerStyle={{ minHeight: 38 }}
                useMultilineLabels
                formatOptionLabel={(option, meta) => {
                  if (meta.context === "value") return <>{option.label}</>;
                  return (
                    <div>
                      <div>{option.label}</div>
                      {option.tooltip && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-low)",
                            marginTop: 1,
                          }}
                        >
                          {option.tooltip}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
            </Box>
            {(endTriggerType === "on" || endTriggerType === "on-or-before") && (
              <Box style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <DatePicker
                  date={state.endScheduleAt || undefined}
                  setDate={(d) =>
                    patchState({ endScheduleAt: d ? d.toISOString() : "" })
                  }
                  precision="datetime"
                  containerClassName="mb-0"
                />
              </Box>
            )}
          </Flex>
          <Box flexGrow="1" />
          <Link size="2" onClick={addStep}>
            <PiPlusBold style={{ marginRight: 3, verticalAlign: "middle" }} />
            Add step
          </Link>
        </Flex>
        {renderPatchSubRows(
          state.endPatch,
          (field, value) =>
            patchState({
              endPatch: { ...state.endPatch, [field]: value },
            }),
          "end",
        )}
      </div>
    );

    return (
      <Box>
        {/* Header row — no label for details column (datetime / interval / text) */}
        <Flex
          align="center"
          gap="4"
          pb="2"
          style={{ borderBottom: "1px solid var(--gray-a6)" }}
        >
          <ColHeader width={COL.num}>Step</ColHeader>
          {activeFields.has("coverage") && (
            <ColHeader width={COL.coverage}>Rollout %</ColHeader>
          )}
          <ColHeader width={COL.trigger}>Wait for</ColHeader>
        </Flex>

        {startRow}

        {state.steps.map((step, i) => {
          return (
            <div
              key={i}
              style={
                hasEffects ? { borderBottom: "1px solid var(--gray-a6)" } : {}
              }
            >
              {/* Main grid row */}
              <Flex align="center" gap="4" py="2">
                {/* Step number */}
                <Box
                  style={{
                    width: COL.num,
                    flexShrink: 0,
                  }}
                  pl="1"
                >
                  <Text size="small" color="text-low">
                    {i + 1}
                  </Text>
                </Box>

                {/* Coverage */}
                {activeFields.has("coverage") && (
                  <Box style={{ width: COL.coverage, flexShrink: 0 }}>
                    <div
                      className={`position-relative ${styles.percentInputWrap}`}
                    >
                      <Field
                        style={{ width: COL.coverage, minHeight: 38 }}
                        type="number"
                        min="0"
                        max="100"
                        onFocus={(e) => e.target.select()}
                        value={String(step.patch.coverage ?? 0)}
                        onChange={(e) =>
                          updateStepPatch(
                            i,
                            "coverage",
                            Math.min(
                              100,
                              Math.max(0, parseInt(e.target.value) || 0),
                            ),
                          )
                        }
                      />
                      <span>%</span>
                    </div>
                  </Box>
                )}
                {/* Hold for — select + detail inline */}
                <Flex
                  align="center"
                  gap="2"
                  style={
                    step.triggerType === "approval"
                      ? { flex: 1, minWidth: COL.trigger }
                      : { width: COL.trigger + COL.duration, flexShrink: 0 }
                  }
                >
                  <Box style={{ width: COL.trigger, flexShrink: 0 }}>
                    <SelectField
                      value={step.triggerType}
                      options={[
                        {
                          value: "interval",
                          label: "Hold",
                          tooltip:
                            "Apply this step's effects, then hold for the interval before advancing",
                        },
                        {
                          value: "approval",
                          label: "Approval",
                          tooltip:
                            "Apply this step's effects, then hold for manual approval before advancing",
                        },
                      ]}
                      onChange={(v) =>
                        updateStep(i, {
                          triggerType: v as "interval" | "approval",
                        })
                      }
                      containerClassName="mb-0"
                      containerStyle={{ minHeight: 38 }}
                      useMultilineLabels
                      formatOptionLabel={(option, meta) => {
                        if (meta.context === "value")
                          return <>{option.label}</>;
                        return (
                          <div>
                            <div>{option.label}</div>
                            {option.tooltip && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--color-text-low)",
                                  marginTop: 1,
                                }}
                              >
                                {option.tooltip}
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                  </Box>
                  {step.triggerType === "interval" && (
                    <>
                      <Field
                        style={{ minHeight: 38 }}
                        type="number"
                        min="1"
                        onFocus={(e) => e.target.select()}
                        value={String(step.intervalValue)}
                        onChange={(e) =>
                          updateStep(i, {
                            intervalValue: Math.max(
                              1,
                              parseInt(e.target.value) || 1,
                            ),
                          })
                        }
                        containerStyle={{ width: 75, flexShrink: 0 }}
                      />
                      <Box style={{ flex: 1 }}>
                        <SelectField
                          value={step.intervalUnit}
                          options={[
                            { value: "minutes", label: "minutes" },
                            { value: "hours", label: "hours" },
                            { value: "days", label: "days" },
                          ]}
                          onChange={(v) =>
                            updateStep(i, {
                              intervalUnit: v as IntervalUnit,
                            })
                          }
                          containerClassName="mb-0"
                          containerStyle={{ minHeight: 38 }}
                        />
                      </Box>
                    </>
                  )}
                  {step.triggerType === "approval" && (
                    <Flex
                      align="center"
                      gap="2"
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {!step.notesOpen ? (
                        <Link
                          size="1"
                          ml="1"
                          color="gray"
                          style={{ flexShrink: 0 }}
                          onClick={() =>
                            updateStep(i, {
                              notesOpen: true,
                              approvalNotes: "",
                            })
                          }
                        >
                          <PiPlusBold
                            style={{ marginRight: 3, verticalAlign: "middle" }}
                          />
                          Add approval notes
                        </Link>
                      ) : (
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Field
                            label=""
                            placeholder="ex: Check error rates"
                            value={step.approvalNotes}
                            onChange={(e) =>
                              updateStep(i, { approvalNotes: e.target.value })
                            }
                            containerClassName="mb-0"
                            style={{ minHeight: 38 }}
                          />
                        </Box>
                      )}
                    </Flex>
                  )}
                </Flex>

                {step.triggerType !== "approval" && <Box flexGrow="1" />}
                {/* Remove button — pushed to far right */}
                <Tooltip content="Remove step">
                  <IconButton
                    type="button"
                    color="gray"
                    variant="ghost"
                    radius="full"
                    size="1"
                    style={{ margin: 0, flexShrink: 0 }}
                    onClick={() => removeStep(i)}
                  >
                    <PiXBold size={16} />
                  </IconButton>
                </Tooltip>
              </Flex>

              {renderPatchSubRows(
                step.patch,
                (field, value) => updateStepPatch(i, field, value),
                i,
              )}
            </div>
          );
        })}

        {endRow}

        <Box mt="4" mb="2">
          <Collapsible
            open={moreOptionsOpen}
            transitionTime={100}
            trigger={
              <a
                className="link-purple"
                onClick={() => setMoreOptionsOpen(!moreOptionsOpen)}
              >
                <PiCaretRightFill className="chevron mr-1" />
                More options
              </a>
            }
          >
            <Box mt="3">
              <Box display="inline-block">
                <Flex direction="column" gap="2">
                  <Checkbox
                    value={state.disableRuleBefore ?? false}
                    setValue={(v) => patchState({ disableRuleBefore: v })}
                    label="Hide rule before start"
                  />
                  <Checkbox
                    value={state.disableRuleAfter ?? false}
                    setValue={(v) => patchState({ disableRuleAfter: v })}
                    label="Hide rule at end"
                  />
                </Flex>
              </Box>
            </Box>
          </Collapsible>
        </Box>
      </Box>
    );
  }

  // ── Create / Edit content ──────────────────────────────────────────────────

  const createContent = (
    <>
      {/* Presets + Duration */}
      <Flex gap="6" mb="4" align="start">
        {/* Left: preset selector */}
        <Box style={{ flex: "1 1 0", minWidth: 0 }}>
          <SelectField
            label="Preset"
            value={selectedPreset}
            placeholder="Choose a preset..."
            options={[
              ...RAMP_PRESETS.map((p) => ({
                value: p.label,
                label: p.label,
              })),
              { value: "custom", label: "Custom..." },
            ]}
            onChange={(v) => {
              if (v === "custom") {
                setSelectedPreset("custom");
                return;
              }

              const ramp = RAMP_PRESETS.find((p) => p.label === v);
              if (ramp) {
                if (ruleType === "force") {
                  onConvertToRollout?.();
                }
                setSelectedPreset(v);
                const effectiveDurationValue = durationDirty
                  ? Math.max(1, parseInt(durationValue) || 1)
                  : ramp.defaultDurationValue;
                const effectiveDurationUnit = durationDirty
                  ? durationUnit
                  : ramp.defaultDurationUnit;
                if (!durationDirty) {
                  setDurationValue(String(ramp.defaultDurationValue));
                  setDurationUnit(ramp.defaultDurationUnit);
                }
                patchState({
                  steps: buildPresetSteps(
                    ramp.coverages,
                    ramp.triggerType,
                    effectiveDurationValue,
                    effectiveDurationUnit,
                    activeFields,
                    ruleBaseline,
                  ),
                  name: ramp.name,
                  endScheduleAt: "",
                  endPatch: { coverage: 100 },
                  disableRuleBefore: false,
                  disableRuleAfter: false,
                  endEarlyWhenStepsComplete: true,
                  startMode: ramp.manualStart ? "manual" : "immediately",
                  startTime: "",
                });
                if ((state.startPatch.coverage ?? 0) === 0) {
                  onSetRuleCoverage?.(0);
                }
                return;
              }
            }}
            sort={false}
            containerClassName="mb-0"
          />
        </Box>

        {/* Right: Total duration field + Apply */}
        <Box style={{ flexShrink: 0 }}>
          <label>Total duration</label>
          <Flex align="center" gap="2">
            <Field
              type="number"
              min="1"
              value={durationValue}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setDurationValue(e.target.value);
                setDurationDirty(true);
              }}
              onBlur={(e) => {
                const v = Math.max(1, parseInt(e.target.value) || 1);
                setDurationValue(String(v));
                patchState({
                  steps: applyTotalDuration(state.steps, v, durationUnit),
                });
              }}
              containerStyle={{ width: 75, flexShrink: 0 }}
              containerClassName="mb-0"
              style={{ minHeight: 38 }}
            />
            <SelectField
              value={durationUnit}
              options={[
                { value: "minutes", label: "minutes" },
                { value: "hours", label: "hours" },
                { value: "days", label: "days" },
              ]}
              onChange={(v) => {
                const unit = v as IntervalUnit;
                setDurationUnit(unit);
                setDurationDirty(true);
                patchState({
                  steps: applyTotalDuration(
                    state.steps,
                    Math.max(1, parseInt(durationValue) || 1),
                    unit,
                  ),
                });
              }}
              containerClassName="mb-0"
              containerStyle={{ width: 100, minHeight: 38 }}
            />
          </Flex>
        </Box>
      </Flex>

      {activeFields.size === 0 && (
        <Callout status="error" mb="4">
          Select at least one property to ramp.
        </Callout>
      )}

      {boxStepGrid ? (
        <div className="appbox px-3 pt-3 pb-2 bg-light">
          {state.steps.some(
            (s) =>
              s.triggerType === "interval" &&
              s.intervalValue * UNIT_MULT[s.intervalUnit] < pollIntervalSeconds,
          ) && (
            <Callout status="warning" mb="3">
              One or more steps are shorter than the minimum check interval (1
              min). Short steps may be applied together rather than at their
              exact scheduled times.
            </Callout>
          )}
          {renderStepGrid()}
        </div>
      ) : (
        <>
          {/* Granularity warning */}
          {state.steps.some(
            (s) =>
              s.triggerType === "interval" &&
              s.intervalValue * UNIT_MULT[s.intervalUnit] < pollIntervalSeconds,
          ) && (
            <Callout status="warning" mb="3">
              One or more steps are shorter than the minimum check interval (1
              min). Short steps may be applied together rather than at their
              exact scheduled times.
            </Callout>
          )}
          {renderStepGrid()}
        </>
      )}
    </>
  );

  // ── Full content (all modes) ───────────────────────────────────────────────

  // "running" = blocked: Agenda is actively watching, edits would race with progression.
  // "ready" is not yet running, so edits are safe (like paused).
  // All other statuses (pending, ready, paused, completed, rolled-back) are safe to edit freely.
  const canEdit =
    !ruleRampSchedule ||
    !["running", "pending-approval", "conflict"].includes(
      ruleRampSchedule.status,
    );

  const content = (
    <>
      {/* Linked ramp header row — shown whenever a ramp is attached */}
      {ruleRampSchedule && !hideNameField && (
        <Box mb="3">
          <Flex align="center" gap="2" mb="2" wrap="nowrap">
            <Text size="medium" weight="medium">
              {state.name || ruleRampSchedule.name}
            </Text>
            <Badge
              label={
                pendingDetach
                  ? "pending removal – save to reinstate"
                  : getRampStatusLabel(ruleRampSchedule)
              }
              color={
                pendingDetach
                  ? "red"
                  : getRampBadgeColor(ruleRampSchedule.status)
              }
              radius="full"
            />
            {ruleRampSchedule.steps.length > 0 && (
              <span style={{ flexShrink: 0 }}>
                <Text size="small" color="text-low">
                  Step {getRampStepsCompleted(ruleRampSchedule)} of{" "}
                  {ruleRampSchedule.steps.length}
                </Text>
              </span>
            )}
            <Box flexGrow="1" />
          </Flex>
          {state.mode !== "create" && !canEdit && (
            <RampScheduleDisplay
              rs={ruleRampSchedule}
              targetId={
                ruleRampSchedule.targets.find((t) => t.status === "active")?.id
              }
            />
          )}
        </Box>
      )}

      {!ruleRampSchedule && state.mode === "create" && !hideNameField && (
        <Flex align="center" gap="1" mb="3">
          <Text weight="medium">
            {state.name || (
              <span style={{ color: "var(--color-text-low)" }}>ramp up</span>
            )}
          </Text>
        </Flex>
      )}

      {(state.mode === "create" ||
        state.mode === "link" ||
        (state.mode === "edit" && canEdit)) &&
        createContent}
    </>
  );

  if (hideOuterToggle) {
    return <Box>{content}</Box>;
  }

  return (
    <Box mt="4">
      <Separator size="4" mb="4" />
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="2">
          <Text size="large" weight="medium">
            Ramp Schedule
          </Text>
          <Text size="medium" color="text-low">
            (optional)
          </Text>
        </Flex>
        <Switch value={open} onChange={handleToggle} />
      </Flex>
      {open && content}
    </Box>
  );
}

// ─── Factory for a fresh default state ───────────────────────────────────────

// ─── Ramp → UI state reconstruction ─────────────────────────────────────────

// Converts a stored FeatureRulePatch (coverage 0–1) back to UIStepPatch (coverage 0–100).
export function reconstructUIPatch(
  patch?: FeatureRulePatch | null,
): UIStepPatch {
  if (!patch) return {};
  const p: UIStepPatch = {};
  if (patch.coverage != null) p.coverage = Math.round(patch.coverage * 100);
  if (patch.condition != null) p.condition = patch.condition;
  if (patch.savedGroups != null)
    p.savedGroups = patch.savedGroups as SavedGroupTargeting[];
  if (patch.prerequisites != null)
    p.prerequisites = patch.prerequisites as FeaturePrerequisite[];
  if (patch.force !== undefined) {
    p.force =
      typeof patch.force === "string"
        ? patch.force
        : JSON.stringify(patch.force);
  }
  return p;
}

// Converts a stored RampStep back to a UIStep.
export function reconstructUIStep(step: RampStep): UIStep {
  const patch = reconstructUIPatch(step.actions[0]?.patch);
  if (step.trigger.type === "approval" || step.trigger.type === "scheduled") {
    const approvalNotes = step.approvalNotes ?? "";
    return {
      patch,
      triggerType: "approval",
      intervalValue: 10,
      intervalUnit: "minutes",
      approvalNotes,
      notesOpen: approvalNotes.trim().length > 0,
    };
  }
  const seconds = step.trigger.seconds;
  const intervalUnit: IntervalUnit =
    seconds % 86400 === 0 && seconds >= 86400
      ? "days"
      : seconds % 3600 === 0 && seconds >= 3600
        ? "hours"
        : "minutes";
  return {
    patch,
    triggerType: "interval",
    intervalUnit,
    intervalValue:
      intervalUnit === "days"
        ? seconds / 86400
        : intervalUnit === "hours"
          ? seconds / 3600
          : seconds / 60,
    approvalNotes: "",
    notesOpen: false,
  };
}

// Builds a RampSectionState from an existing RampScheduleInterface for editing.
export function rampScheduleToSectionState(
  rs: RampScheduleInterface,
): RampSectionState {
  const trigger = rs.startCondition?.trigger;
  return {
    mode: "edit",
    name: rs.name,
    startMode:
      trigger?.type === "scheduled"
        ? "specific-time"
        : trigger?.type === "manual"
          ? "manual"
          : "immediately",
    startTime:
      trigger?.type === "scheduled" ? new Date(trigger.at).toISOString() : "",
    startPatch: reconstructUIPatch(rs.startCondition?.actions?.[0]?.patch),
    disableRuleBefore: rs.disableRuleBefore ?? false,
    disableRuleAfter: rs.disableRuleAfter ?? false,
    endEarlyWhenStepsComplete: rs.endEarlyWhenStepsComplete ?? true,
    steps: rs.steps.map(reconstructUIStep),
    endScheduleAt:
      rs.endCondition?.trigger?.type === "scheduled"
        ? new Date(rs.endCondition.trigger.at).toISOString()
        : "",
    endPatch: reconstructUIPatch(rs.endCondition?.actions?.[0]?.patch),
    linkedRampId: rs.id,
  };
}

export function defaultRampSectionState(
  ruleRampSchedule: RampScheduleInterface | undefined,
): RampSectionState {
  if (ruleRampSchedule) {
    return rampScheduleToSectionState(ruleRampSchedule);
  }
  // Pre-seed with the first preset so the step table is populated on first open.
  const preset = RAMP_PRESETS[0];
  return {
    mode: "off",
    name: preset.name,
    startMode: "immediately" as StartMode,
    startTime: "",
    startPatch: { coverage: 0 },
    disableRuleBefore: false,
    disableRuleAfter: false,
    endEarlyWhenStepsComplete: true,
    steps: buildPresetSteps(
      preset.coverages,
      preset.triggerType,
      preset.defaultDurationValue,
      preset.defaultDurationUnit,
      new Set<StepField>(["coverage"]),
      {},
    ),
    endScheduleAt: "",
    endPatch: { coverage: 100 },
    linkedRampId: "",
  };
}

/**
 * Converts a draft `RevisionRampCreateAction` (stored in draftRevision.rampActions)
 * into a RampSectionState so the rule modal can pre-populate when editing a rule that
 * has a pending-create ramp schedule (not yet in the DB).
 */
export function createActionToSectionState(
  action: RevisionRampCreateAction,
): RampSectionState {
  const trigger = action.startCondition?.trigger;
  const startMode: StartMode =
    trigger?.type === "scheduled"
      ? "specific-time"
      : trigger?.type === "manual"
        ? "manual"
        : "immediately";
  return {
    mode: "create",
    name: action.name,
    startMode,
    startTime:
      trigger?.type === "scheduled" ? new Date(trigger.at).toISOString() : "",
    startPatch: reconstructUIPatch(action.startCondition?.actions?.[0]?.patch),
    disableRuleBefore: action.disableRuleBefore ?? false,
    disableRuleAfter: action.disableRuleAfter ?? false,
    endEarlyWhenStepsComplete: action.endEarlyWhenStepsComplete ?? true,
    steps: action.steps.map(reconstructUIStep),
    endScheduleAt:
      action.endCondition?.trigger?.type === "scheduled"
        ? new Date(action.endCondition.trigger.at).toISOString()
        : "",
    endPatch: reconstructUIPatch(action.endCondition?.actions?.[0]?.patch),
    linkedRampId: "",
  };
}
