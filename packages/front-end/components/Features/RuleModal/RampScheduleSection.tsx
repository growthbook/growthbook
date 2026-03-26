// Inline ramp schedule editor inside RuleModal.
// The "Changes" dropdown controls which fields appear on every step row; no per-row add/remove.

import { useMemo, useState, type ReactNode } from "react";
import { Box, Flex, Separator, IconButton } from "@radix-ui/themes";
import {
  PiPlusBold,
  PiXBold,
  PiHourglassMediumFill,
  PiCaretRightFill,
  PiEye,
  PiEyeSlash,
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
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/ui/Tooltip";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import Text from "@/ui/Text";
import FeatureValueField from "@/components/Features/FeatureValueField";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import styles from "./RampScheduleSection.module.scss";

// ─── Types ──────────────────────────────────────────────────────────────────

export type IntervalUnit = "minutes" | "hours" | "days";

export type StepField =
  | "coverage"
  | "condition"
  | "savedGroups"
  | "prerequisites"
  | "force";

const ALL_STEP_FIELDS: StepField[] = [
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
  "force",
];

const STEP_FIELD_LABELS: Record<StepField, string> = {
  coverage: "Coverage",
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
  approvalNotes: string; // only shown when triggerType === "approval"
};

export type RampMode = "off" | "create" | "edit" | "link" | "detach";
export type StartMode = "immediately" | "manual" | "specific-time";

export interface RampSectionState {
  mode: RampMode;
  name: string;
  startMode: StartMode; // "immediately" | "manual" | "specific-time"
  startTime: string; // ISO datetime, only used when startMode === "specific-time"
  startPatch: UIStepPatch; // patch applied when the ramp starts (e.g. coverage: 0)
  disableRuleBefore: boolean;
  disableRuleAfter: boolean;
  steps: UIStep[];
  endScheduleAt: string; // "" = automatic end; non-empty = specific time
  endSchedulePatch: UIStepPatch;
  linkedRampId: string;
}

const UNIT_MULT: Record<IntervalUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

// ─── Grid column widths ──────────────────────────────────────────────────────

const COL = {
  num: 30, // "1" / "2" / "start" / "end"
  trigger: 130, // trigger type select
  duration: 200, // trigger details (interval inputs, datetime, "Awaiting approval")
  coverage: 80, // [number] %
} as const;

// ─── Build helpers ───────────────────────────────────────────────────────────

function buildPatch(
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
  return steps.map((s, i) => ({
    trigger:
      s.triggerType === "interval"
        ? {
            type: "interval" as const,
            seconds: s.intervalValue * UNIT_MULT[s.intervalUnit],
          }
        : { type: "approval" as const },
    actions: [{ targetId, patch: buildPatch(s.patch, ruleId) }],
    notifyOnEntry: i === 0,
    ...(s.triggerType === "approval" && s.approvalNotes
      ? { approvalNotes: s.approvalNotes }
      : {}),
  }));
}

export function buildStartActions(
  patch: UIStepPatch,
  targetId: string,
  ruleId: string,
): RampStepAction[] {
  const hasAny = Object.values(patch).some((v) => v !== undefined);
  if (!hasAny) return [];
  return [
    { targetId, patch: buildPatch(patch, ruleId) as RampStepAction["patch"] },
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
    { targetId, patch: buildPatch(patch, ruleId) as RampStepAction["patch"] },
  ];
}

// Returns a validation error message if any required date fields are missing, or null if valid.
export function validateRampSectionState(
  state: RampSectionState,
): string | null {
  if (state.mode === "off" || state.mode === "link" || state.mode === "detach")
    return null;
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

// Presets use hold-first semantics: each step's interval is the wait *before*
// that step fires. The initial 0% state is applied by startCondition.actions;
// steps start from the first non-zero coverage value.
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
    name: "standard rollout",
    defaultDurationValue: 1,
    defaultDurationUnit: "hours",
    coverages: [1, 5, 10, 25, 50, 100],
    triggerType: "interval",
  },
  {
    label: "Safe (Standard, with approval steps)",
    name: "safe standard rollout",
    defaultDurationValue: 1,
    defaultDurationUnit: "hours",
    coverages: [1, 5, 10, 25, 50, 100],
    triggerType: "approval",
    manualStart: true,
  },
  {
    label: "Quick (10, 50, 100)",
    name: "quick rollout",
    defaultDurationValue: 10,
    defaultDurationUnit: "minutes",
    coverages: [10, 50, 100],
    triggerType: "interval",
  },
  {
    label: "Quick safe (Quick, with approval steps)",
    name: "quick safe rollout",
    defaultDurationValue: 10,
    defaultDurationUnit: "minutes",
    coverages: [10, 50, 100],
    triggerType: "approval",
    manualStart: true,
  },
  {
    label: "Linear (5 steps)",
    name: "linear 5-step rollout",
    defaultDurationValue: 1,
    defaultDurationUnit: "hours",
    coverages: [20, 40, 60, 80, 100],
    triggerType: "interval",
  },
  {
    label: "Linear (10 steps)",
    name: "linear 10-step rollout",
    defaultDurationValue: 1,
    defaultDurationUnit: "hours",
    coverages: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    triggerType: "interval",
  },
];

// Scheduled rule presets — no intermediate steps, rely on start/end triggers.
// disableRuleBefore/disableRuleAfter are auto-set to true so the rule is hidden outside the window.
const SCHEDULED_PRESETS: {
  label: string;
  name: string;
  startMode: StartMode;
  includeEnd: boolean;
  disableRuleBefore: boolean;
  disableRuleAfter: boolean;
}[] = [
  {
    label: "Enable rule on specific date",
    name: "enable on date",
    startMode: "specific-time",
    includeEnd: false,
    disableRuleBefore: true,
    disableRuleAfter: false,
  },
  {
    label: "Disable rule on specific date",
    name: "disable on date",
    startMode: "immediately",
    includeEnd: true,
    disableRuleBefore: false,
    disableRuleAfter: true,
  },
  {
    label: "Enable and disable rule on specific dates",
    name: "scheduled window",
    startMode: "specific-time",
    includeEnd: true,
    disableRuleBefore: true,
    disableRuleAfter: true,
  },
];

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
  const perStepSeconds = Math.max(1, Math.round(totalSeconds / intervalCount));
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
        : Math.round(perStepSeconds / 60);

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
    Math.round(totalSeconds / intervalSteps.length),
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
        : Math.round(perStepSeconds / 60);
  return steps.map((s) =>
    s.triggerType === "interval" ? { ...s, intervalValue, intervalUnit } : s,
  );
}

const DEFAULT_STEPS: UIStep[] = [];

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
}

export default function RampScheduleSection({
  featureRampSchedules,
  ruleRampSchedule,
  state,
  setState,
  hideOuterToggle = false,
  feature,
  environments,
  onSetRuleCoverage,
  ruleBaseline = {},
}: Props) {
  const [open, setOpen] = useState(hideOuterToggle || state.mode !== "off");
  const [durationValue, setDurationValue] = useState(10);
  const [durationUnit, setDurationUnit] = useState<IntervalUnit>("minutes");
  const [durationDirty, setDurationDirty] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("custom");
  const { settings } = useUser();
  const pollIntervalMinutes = isCloud()
    ? 10
    : Math.min(
        10,
        Math.max(
          1,
          Math.round(settings?.rampSchedulePollIntervalMinutes ?? 10),
        ),
      );
  const pollIntervalSeconds = pollIntervalMinutes * 60;

  function patchState(partial: Partial<RampSectionState>) {
    setState({ ...state, ...partial });
  }

  // Active fields are derived from all patches (start, steps, end) so the global
  // "Schedule controls" dropdown governs all rows uniformly.
  const activeFields = useMemo<Set<StepField>>(() => {
    const fields = new Set<StepField>();
    state.steps.forEach((s) => {
      (Object.keys(s.patch) as StepField[]).forEach((k) => fields.add(k));
    });
    (Object.keys(state.startPatch) as StepField[]).forEach((k) =>
      fields.add(k),
    );
    (Object.keys(state.endSchedulePatch) as StepField[]).forEach((k) =>
      fields.add(k),
    );
    return fields;
  }, [state.steps, state.startPatch, state.endSchedulePatch]);

  // Sets the full desired active-field set atomically (used by MultiSelectField onChange).
  function setActiveFields(newFields: StepField[]) {
    const newSet = new Set(newFields);
    const n = state.steps.length;

    // For a newly-added field, seed from rule baseline so existing targeting isn't wiped.
    const baselineFor = (f: StepField): unknown => {
      if (ruleBaseline[f] !== undefined) return ruleBaseline[f];
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

    patchState({
      startPatch: rebuildPatch(state.startPatch),
      // Pre-seed coverage: 100 so newly-activated coverage on the end patch defaults to
      // 100% rather than 0. Explicitly set values from state are preserved by rebuildPatch.
      endSchedulePatch: rebuildPatch({
        coverage: 100,
        ...state.endSchedulePatch,
      }),
      steps: state.steps.map((s, i) => ({
        ...s,
        patch: rebuildPatch(s.patch, i),
      })),
    });
  }

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

  const linkableRamps = featureRampSchedules.filter(
    (rs) => !["completed", "expired", "rolled-back"].includes(rs.status),
  );
  const otherRamps = featureRampSchedules.filter(
    (rs) => rs.id !== ruleRampSchedule?.id,
  );

  // ── Step grid ─────────────────────────────────────────────────────────────

  function renderStepGrid() {
    const endTriggerType = state.endScheduleAt ? "specific-time" : "automatic";
    const hasTargeting = (
      ["condition", "savedGroups", "prerequisites"] as StepField[]
    ).some((f) => activeFields.has(f));
    const hasEffects = activeFields.has("force") || hasTargeting;
    const rowBorder: React.CSSProperties = hasEffects
      ? { borderBottom: "1px solid var(--gray-a3)" }
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
      rowKey: string,
    ) {
      if (!hasEffects) return null;
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
                    id={`${rowKey}-force`}
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
                    key={`${rowKey}-condition`}
                    defaultValue={patch.condition ?? "{}"}
                    onChange={(v) => setPatchFn("condition", v)}
                    project={feature.project ?? ""}
                    slimMode
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
        label: "Immediately",
        tooltip: "Starts as soon as the draft is published",
      },
      {
        value: "manual",
        label: "Manual",
        tooltip: "Starts after user confirmation",
      },
      {
        value: "specific-time",
        label: "Specific date",
        tooltip: "Starts at a scheduled time once the draft is published",
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
          <Tooltip
            content={
              state.disableRuleBefore
                ? "Rule hidden before schedule starts (click to show)"
                : "Rule visible before schedule starts (click to hide)"
            }
            side="top"
          >
            <IconButton
              variant="ghost"
              color={state.disableRuleBefore ? undefined : "gray"}
              size="2"
              style={{ flexShrink: 0 }}
              onClick={(e) => {
                e.stopPropagation();
                patchState({ disableRuleBefore: !state.disableRuleBefore });
              }}
            >
              {state.disableRuleBefore ? (
                <PiEyeSlash size={15} />
              ) : (
                <PiEye size={15} />
              )}
            </IconButton>
          </Tooltip>
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
                  value={String(state.endSchedulePatch.coverage ?? 100)}
                  onChange={(e) =>
                    patchState({
                      endSchedulePatch: {
                        ...state.endSchedulePatch,
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
                    label: "Automatic",
                    tooltip: "Ends after all steps have completed",
                  },
                  {
                    value: "specific-time",
                    label: "Specific time",
                    tooltip:
                      "Ends at a specific time irrespective of ramp step",
                  },
                ]}
                onChange={(v) => {
                  if (v === "automatic") {
                    patchState({ endScheduleAt: "" });
                  } else {
                    const d = new Date();
                    d.setSeconds(0, 0);
                    patchState({
                      endScheduleAt: d.toISOString().slice(0, 16),
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
            {endTriggerType === "specific-time" && (
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
          <Tooltip
            content={
              state.disableRuleAfter
                ? "Rule hidden after schedule ends (click to show)"
                : "Rule visible after schedule ends (click to hide)"
            }
            side="top"
          >
            <IconButton
              variant="ghost"
              color={state.disableRuleAfter ? undefined : "gray"}
              size="2"
              style={{ flexShrink: 0 }}
              onClick={(e) => {
                e.stopPropagation();
                patchState({ disableRuleAfter: !state.disableRuleAfter });
              }}
            >
              {state.disableRuleAfter ? (
                <PiEyeSlash size={15} />
              ) : (
                <PiEye size={15} />
              )}
            </IconButton>
          </Tooltip>
        </Flex>
        {renderPatchSubRows(
          state.endSchedulePatch,
          (field, value) =>
            patchState({
              endSchedulePatch: { ...state.endSchedulePatch, [field]: value },
            }),
          "end",
        )}
      </div>
    );

    return (
      <Box>
        {/* Schedule controls — MultiSelectField */}
        <MultiSelectField
          label="Controlled by ramp schedule"
          value={[...activeFields]}
          options={ALL_STEP_FIELDS.map((f) => ({
            value: f,
            label: STEP_FIELD_LABELS[f],
          }))}
          onChange={(newValues) => {
            const next = (
              newValues.length === 0 ? ["coverage"] : newValues
            ) as StepField[];
            setActiveFields(next);
          }}
          sort={false}
          showCopyButton={false}
          closeMenuOnSelect={false}
          containerClassName="mb-3"
        />

        {/* Header row — no label for details column (datetime / interval / text) */}
        <Flex
          align="center"
          gap="4"
          pb="2"
          style={{ borderBottom: "1px solid var(--gray-a3)" }}
        >
          <ColHeader width={COL.num}>Step</ColHeader>
          {activeFields.has("coverage") && (
            <ColHeader width={COL.coverage}>Coverage</ColHeader>
          )}
          <ColHeader width={COL.trigger}>Triggered by</ColHeader>
        </Flex>

        {startRow}

        {state.steps.map((step, i) => {
          return (
            <div
              key={i}
              style={
                hasEffects ? { borderBottom: "1px solid var(--gray-a3)" } : {}
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
                {/* Triggered by — select + detail inline */}
                <Flex
                  align="center"
                  gap="2"
                  style={{ width: COL.trigger + COL.duration, flexShrink: 0 }}
                >
                  <Box style={{ width: COL.trigger, flexShrink: 0 }}>
                    <SelectField
                      value={step.triggerType}
                      options={[
                        {
                          value: "interval",
                          label: "Wait",
                          tooltip:
                            "Wait the interval, then apply this step's effects",
                        },
                        {
                          value: "approval",
                          label: "Manual",
                          tooltip:
                            "Prompt for approval, then apply this step's effects",
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
                      {!step.approvalNotes ? (
                        <Link
                          size="1"
                          style={{ flexShrink: 0 }}
                          onClick={() => updateStep(i, { approvalNotes: " " })}
                        >
                          <PiPlusBold
                            style={{ marginRight: 3, verticalAlign: "middle" }}
                          />
                          Add prompt notes
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

                {/* Remove button — inline at end of row */}
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
                `step-${i}`,
              )}
            </div>
          );
        })}

        {/* Add step — between steps and end row */}
        <Flex align="center" justify="start" py="1">
          <Link size="1" onClick={addStep}>
            <PiPlusBold style={{ marginRight: 3, verticalAlign: "middle" }} />
            Add step
          </Link>
        </Flex>

        {endRow}
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
            options={[
              {
                label: "Ramp ups",
                options: RAMP_PRESETS.map((p) => ({
                  value: p.label,
                  label: p.label,
                })),
              },
              {
                label: "Scheduled rules",
                options: SCHEDULED_PRESETS.map((p) => ({
                  value: p.label,
                  label: p.label,
                })),
              },
              {
                label: "",
                options: [{ value: "custom", label: "Custom..." }],
              },
            ]}
            onChange={(v) => {
              if (v === "custom") {
                setSelectedPreset("custom");
                return;
              }

              const ramp = RAMP_PRESETS.find((p) => p.label === v);
              if (ramp) {
                setSelectedPreset(v);
                const effectiveDurationValue = durationDirty
                  ? durationValue
                  : ramp.defaultDurationValue;
                const effectiveDurationUnit = durationDirty
                  ? durationUnit
                  : ramp.defaultDurationUnit;
                if (!durationDirty) {
                  setDurationValue(ramp.defaultDurationValue);
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
                  endSchedulePatch: { coverage: 100 },
                  disableRuleBefore: false,
                  disableRuleAfter: false,
                  ...(ramp.manualStart
                    ? { startMode: "manual" as const, startTime: "" }
                    : {}),
                });
                onSetRuleCoverage?.(0);
                return;
              }

              const scheduled = SCHEDULED_PRESETS.find((p) => p.label === v);
              if (scheduled) {
                setSelectedPreset(v);
                // Use || instead of ?? so that 0% also falls back to 100%:
                // a scheduled rule that enables/disables at 0% coverage makes no sense.
                const defaultCoverage = ruleBaseline.coverage || 100;
                patchState({
                  steps: [],
                  name: scheduled.name,
                  startMode: scheduled.startMode,
                  startTime: "",
                  startPatch: { coverage: defaultCoverage },
                  disableRuleBefore: scheduled.disableRuleBefore,
                  disableRuleAfter: scheduled.disableRuleAfter,
                  endScheduleAt: "",
                  endSchedulePatch: { coverage: defaultCoverage },
                });
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
              value={String(durationValue)}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setDurationValue(Math.max(1, parseInt(e.target.value) || 1));
                setDurationDirty(true);
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
                setDurationUnit(v as IntervalUnit);
                setDurationDirty(true);
              }}
              containerClassName="mb-0"
              containerStyle={{ width: 100, minHeight: 38 }}
            />
            <Link
              size="1"
              onClick={() => {
                patchState({
                  steps: applyTotalDuration(
                    state.steps,
                    durationValue,
                    durationUnit,
                  ),
                });
              }}
            >
              Apply to schedule
            </Link>
          </Flex>
        </Box>
      </Flex>

      <Field
        label="Ramp schedule name"
        required={state.mode === "create"}
        value={state.name}
        onChange={(e) => patchState({ name: e.target.value })}
        placeholder="e.g. ramp up"
      />

      {/* Granularity warning — shown when any interval step is shorter than the agenda poll interval */}
      {state.steps.some(
        (s) =>
          s.triggerType === "interval" &&
          s.intervalValue * UNIT_MULT[s.intervalUnit] < pollIntervalSeconds,
      ) && (
        <Callout status="warning" mb="3">
          One or more steps are shorter than the {pollIntervalMinutes}-minute
          agenda poll interval. Steps may advance in batches rather than at
          exact times.
        </Callout>
      )}

      {renderStepGrid()}
    </>
  );

  // ── Full content (all modes) ───────────────────────────────────────────────

  // "pending" = awaiting draft publish (can still edit); "paused" = between steps (can edit).
  // "ready" = draft published, ramp not yet started — treat as non-editable (the rule change
  //  is already live; editing the ramp schedule requires a new revision cycle).
  const canEdit =
    !ruleRampSchedule ||
    ["pending", "paused"].includes(ruleRampSchedule.status);

  const content = (
    <>
      {/* Linked ramp header row — shown whenever a ramp is attached */}
      {ruleRampSchedule && state.mode !== "detach" && (
        <Box mb="3">
          <Flex align="center" gap="2" mb="2" wrap="nowrap">
            <PiHourglassMediumFill size={16} />
            <Text size="medium" weight="medium">
              {ruleRampSchedule.name}
            </Text>
            <Badge
              label={getRampStatusLabel(ruleRampSchedule)}
              color={getRampBadgeColor(ruleRampSchedule.status)}
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
            {/* Detach only allowed when ramp is in a non-active state */}
            {[
              "pending",
              "paused",
              "completed",
              "expired",
              "rolled-back",
            ].includes(ruleRampSchedule.status) && (
              <Tooltip content="Detach this rule from the ramp schedule">
                <Link
                  color="ruby"
                  onClick={() => patchState({ mode: "detach" })}
                >
                  Detach
                </Link>
              </Tooltip>
            )}
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

      {/* Detach confirmation row */}
      {ruleRampSchedule && state.mode === "detach" && (
        <Flex align="center" gap="2" mb="3">
          <Text size="medium" color="text-low">
            This rule will be detached from &ldquo;
            <strong>{ruleRampSchedule.name}</strong>&rdquo; on save.
          </Text>
          <Link
            onClick={() =>
              patchState({ mode: "edit", linkedRampId: ruleRampSchedule.id })
            }
          >
            Undo
          </Link>
        </Flex>
      )}

      {!ruleRampSchedule && linkableRamps.length > 0 && (
        <Flex gap="2" mb="3">
          <Button
            variant={state.mode === "create" ? "solid" : "outline"}
            size="sm"
            onClick={() => patchState({ mode: "create" })}
          >
            Create new ramp
          </Button>
          <Button
            variant={state.mode === "link" ? "solid" : "outline"}
            size="sm"
            onClick={() =>
              patchState({
                mode: "link",
                linkedRampId: linkableRamps[0]?.id ?? "",
              })
            }
          >
            Add to existing ramp
          </Button>
        </Flex>
      )}

      {state.mode === "link" && !ruleRampSchedule && (
        <SelectField
          label="Existing ramp schedule"
          value={state.linkedRampId}
          options={otherRamps.map((rs) => ({
            value: rs.id,
            label: `${rs.name} (${rs.status})`,
          }))}
          onChange={(v) => patchState({ linkedRampId: v })}
        />
      )}

      {(state.mode === "create" || (state.mode === "edit" && canEdit)) &&
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
    return {
      patch,
      triggerType: "approval",
      intervalValue: 10,
      intervalUnit: "minutes",
      approvalNotes: step.approvalNotes ?? "",
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
    steps: rs.steps.map(reconstructUIStep),
    endScheduleAt:
      rs.endCondition?.trigger?.type === "scheduled"
        ? new Date(rs.endCondition.trigger.at).toISOString()
        : "",
    endSchedulePatch: reconstructUIPatch(rs.endCondition?.actions?.[0]?.patch),
    linkedRampId: rs.id,
  };
}

export function defaultRampSectionState(
  ruleRampSchedule: RampScheduleInterface | undefined,
): RampSectionState {
  if (ruleRampSchedule) {
    return rampScheduleToSectionState(ruleRampSchedule);
  }
  return {
    mode: "off",
    name: "ramp up",
    startMode: "immediately" as StartMode,
    startTime: "",
    startPatch: { coverage: 0 },
    disableRuleBefore: false,
    disableRuleAfter: false,
    steps: DEFAULT_STEPS.map((s) => ({ ...s, patch: { ...s.patch } })),
    endScheduleAt: "",
    endSchedulePatch: { coverage: 100 },
    linkedRampId: "",
  };
}
