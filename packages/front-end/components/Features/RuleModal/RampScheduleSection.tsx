// Inline ramp schedule editor inside RuleModal.

import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import pick from "lodash/pick";
import { Box, Flex, Separator, IconButton } from "@radix-ui/themes";
import { PiPlusBold, PiCaretRightFill, PiInfo } from "react-icons/pi";
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
import { BsThreeDotsVertical } from "react-icons/bs";
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
import Checkbox from "@/ui/Checkbox";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import FeatureValueField from "@/components/Features/FeatureValueField";
import Callout from "@/ui/Callout";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
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
  additionalEffectsOpen: boolean; // UI-only: whether the effects sub-rows are expanded
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
  // Per-row "additional effects" expansion state (force / condition / savedGroups / prerequisites).
  startAdditionalEffectsOpen: boolean;
  endAdditionalEffectsOpen: boolean;
  // Note: per-step open state lives on UIStep.additionalEffectsOpen
}

const UNIT_MULT: Record<IntervalUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

export const VALID_STEP_FIELDS: StepField[] = [
  "savedGroups",
  "condition",
  "prerequisites",
  "force",
];

// Empty sentinel values used when a user opts a field into a step for the first time.
// These represent "explicitly clear this field at this step" — distinct from absent (inherit).
export const FIELD_DEFAULTS: Partial<UIStepPatch> = {
  condition: "{}",
  savedGroups: [],
  prerequisites: [],
  force: "",
};

export function scrubRampStateForRuleType(
  state: RampSectionState,
): RampSectionState {
  const scrub = (p: UIStepPatch): UIStepPatch =>
    pick(p, ["coverage", ...VALID_STEP_FIELDS]) as UIStepPatch; // coverage is always ramp-controlled
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

// Immutably sets or removes a field from a patch.
// value === undefined → delete key (step inherits from previous step).
// any other value → set key (step explicitly controls this field).
function setPatchField(
  patch: UIStepPatch,
  field: StepField,
  value: unknown,
): UIStepPatch {
  if (value === undefined) {
    const next = { ...(patch as Record<string, unknown>) };
    delete next[field];
    return next as UIStepPatch;
  }
  return { ...patch, [field]: value };
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

export const buildEndScheduleActions = buildStartActions;

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
  // which leaves endScheduleAt="". Block only when a specific-time end was expected:
  // if disableRuleAfter is true with no steps and no end date, there's nothing to trigger
  // the end action and an end date is required.
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

// ─── Active-field helpers (exported for use in parent forms) ─────────────────

// Returns the set of fields actively controlled by this ramp schedule.
// Coverage is always included. Other fields are inferred from whatever is set
// across all patches — if any step defines condition, condition is "controlled".
export function activeFieldsFromState(state: RampSectionState): Set<StepField> {
  const fields = new Set<StepField>(["coverage"]);
  const scan = (p: UIStepPatch) => {
    for (const f of VALID_STEP_FIELDS) {
      if (p[f] !== undefined) fields.add(f);
    }
  };
  scan(state.startPatch);
  state.steps.forEach((s) => scan(s.patch));
  scan(state.endPatch);
  return fields;
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
  // When true, wraps the step grid + more options in an appbox card.
  // Used by the standalone modal.
  boxStepGrid?: boolean;
  // When true, hides the name field from the UI. Used in standalone modal to hide
  // the naming concept from the editor. Name is still stored/managed but not editable.
  hideNameField?: boolean;
  // When true, a draft detach action is pending for this rule. Shows a "pending removal"
  // badge in place of the normal status badge.
  pendingDetach?: boolean;
}

export default function RampScheduleSection({
  featureRampSchedules: _featureRampSchedules,
  ruleRampSchedule,
  state,
  setState,
  hideOuterToggle = false,
  feature,
  environments,
  boxStepGrid = false,
  hideNameField = false,
  pendingDetach = false,
}: Props) {
  const [open, setOpen] = useState(hideOuterToggle || state.mode !== "off");

  const [openMenuIndex, setOpenMenuIndex] = useState<
    number | "start" | "end" | null
  >(null);

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
  const pollIntervalSeconds = 60;

  function patchState(partial: Partial<RampSectionState>) {
    setState({ ...state, ...partial });
  }

  // Active fields: coverage always + any field set in any step/start/end patch.
  const activeFields = useMemo<Set<StepField>>(
    () => activeFieldsFromState(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.steps, state.startPatch, state.endPatch],
  );

  // ── Step mutations ──────────────────────────────────────────────────────────

  function updateStep(i: number, update: Partial<UIStep>) {
    patchState({
      steps: state.steps.map((s, idx) => (idx === i ? { ...s, ...update } : s)),
    });
  }

  function updateStepPatch(i: number, field: StepField, value: unknown) {
    patchState({
      steps: state.steps.map((s, idx) =>
        idx === i ? { ...s, patch: setPatchField(s.patch, field, value) } : s,
      ),
    });
  }

  function removeStep(i: number) {
    patchState({ steps: state.steps.filter((_, idx) => idx !== i) });
  }

  function addStepAfter(afterIndex: number | "start") {
    const prev = afterIndex === "start" ? undefined : state.steps[afterIndex];
    const prevCoverage =
      afterIndex === "start" ? state.startPatch.coverage : prev?.patch.coverage;
    const newStep: UIStep = {
      patch: {
        coverage:
          prevCoverage !== undefined ? Math.min(100, prevCoverage + 10) : 10,
      },
      triggerType: prev?.triggerType ?? "interval",
      intervalValue: prev?.intervalValue ?? 10,
      intervalUnit: prev?.intervalUnit ?? "minutes",
      approvalNotes: "",
      notesOpen: false,
      additionalEffectsOpen: false,
    };
    const insertAt = afterIndex === "start" ? 0 : afterIndex + 1;
    const steps = [...state.steps];
    steps.splice(insertAt, 0, newStep);
    patchState({ steps });
  }

  function addStep() {
    const last = state.steps[state.steps.length - 1];
    // New steps only seed coverage (always-on); other controlled fields start empty
    // so each step only defines what actually changes at that point.
    const newPatch: UIStepPatch = {
      coverage:
        last?.patch.coverage !== undefined
          ? Math.min(100, last.patch.coverage + 10)
          : 10,
    };
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
          additionalEffectsOpen: false,
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
    const rowBorder: React.CSSProperties = {
      borderBottom: "1px solid var(--gray-a6)",
    };
    const subRowIndent = COL.num + 16;

    // Sub-row renderer for feature value + targeting fields.
    // Force value is shown as the first sub-row (above targeting).
    // A section header is shown when any effects are active.
    function renderPatchSubRows(
      patch: UIStepPatch,
      setPatchFn: (field: StepField, value: unknown) => void,
      currentStepIndex: number | "start" | "end",
      open: boolean,
    ) {
      if (!open) return null;

      const fieldsNotInPatch = VALID_STEP_FIELDS.filter((f) => !(f in patch));

      return (
        <Box pb="3" style={{ paddingLeft: subRowIndent }}>
          <Flex
            direction="column"
            gap="5"
            pt="2"
            pb="3"
            px="2"
            className="bg-highlight rounded"
          >
            <Flex wrap="wrap" gap="3" align="start" justify="between">
              <Flex as="div" align="center" gap="1">
                <Text weight="medium" color="text-mid">
                  Additional effects
                </Text>
                <Tooltip
                  tipPosition="top"
                  body="Effects are applied incrementally. Each change made in this step remains in effect until overridden in a future step."
                >
                  <PiInfo style={{ color: "var(--accent-11)" }} />
                </Tooltip>
              </Flex>

              <Flex wrap="wrap" gap="5" align="start">
                {fieldsNotInPatch.map((f) => (
                  <Link
                    key={f}
                    size="1"
                    onClick={() => setPatchFn(f, FIELD_DEFAULTS[f])}
                  >
                    <PiPlusBold
                      style={{ marginRight: 3, verticalAlign: "middle" }}
                    />
                    {STEP_FIELD_LABELS[f]}
                  </Link>
                ))}
              </Flex>
            </Flex>

            {"force" in patch && (
              <Box>
                <Flex align="center" justify="between" mb="1">
                  <Text
                    as="div"
                    size="small"
                    weight="semibold"
                    color="text-mid"
                  >
                    Feature value
                  </Text>
                  <Link
                    size="1"
                    color="red"
                    onClick={() => setPatchFn("force", undefined)}
                  >
                    Remove effect
                  </Link>
                </Flex>
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

            {"condition" in patch && (
              <Box>
                <ConditionInput
                  key={`${currentStepIndex}-condition`}
                  defaultValue={patch.condition ?? "{}"}
                  onChange={(v) => setPatchFn("condition", v)}
                  project={feature.project ?? ""}
                  slimMode
                  emptyText="No targeting applied"
                  labelActions={
                    <Link
                      size="1"
                      color="red"
                      onClick={() => setPatchFn("condition", undefined)}
                    >
                      Remove effect
                    </Link>
                  }
                />
              </Box>
            )}

            {"savedGroups" in patch && (
              <Box>
                <SavedGroupTargetingField
                  value={patch.savedGroups ?? []}
                  setValue={(v) => setPatchFn("savedGroups", v)}
                  project={feature.project ?? ""}
                  slimMode
                  emptyText="No targeting applied"
                  labelActions={
                    <Link
                      size="1"
                      color="red"
                      onClick={() => setPatchFn("savedGroups", undefined)}
                    >
                      Remove effect
                    </Link>
                  }
                />
              </Box>
            )}

            {"prerequisites" in patch && (
              <Box>
                <PrerequisiteInput
                  value={patch.prerequisites ?? []}
                  setValue={(v) => setPatchFn("prerequisites", v)}
                  feature={feature}
                  environments={environments}
                  setPrerequisiteTargetingSdkIssues={() => {}}
                  slimMode
                  emptyText="No targeting applied"
                  labelActions={
                    <Link
                      size="1"
                      color="red"
                      onClick={() => setPatchFn("prerequisites", undefined)}
                    >
                      Remove effect
                    </Link>
                  }
                />
              </Box>
            )}
          </Flex>
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
          <Box flexGrow="1" />
          <DropdownMenu
            open={openMenuIndex === "start"}
            onOpenChange={(o) => setOpenMenuIndex(o ? "start" : null)}
            trigger={
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
              >
                <BsThreeDotsVertical size={18} />
              </IconButton>
            }
            variant="soft"
            menuPlacement="end"
          >
            {!state.startAdditionalEffectsOpen ? (
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setOpenMenuIndex(null);
                    patchState({ startAdditionalEffectsOpen: true });
                  }}
                >
                  Add additional effects
                </DropdownMenuItem>
              </DropdownMenuGroup>
            ) : null}
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  setOpenMenuIndex(null);
                  addStepAfter("start");
                }}
              >
                Add step after
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenu>
        </Flex>
        {renderPatchSubRows(
          state.startPatch,
          (field, value) =>
            patchState({
              startPatch: setPatchField(state.startPatch, field, value),
            }),
          "start",
          state.startAdditionalEffectsOpen,
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
          <DropdownMenu
            open={openMenuIndex === "end"}
            onOpenChange={(o) => setOpenMenuIndex(o ? "end" : null)}
            disabled={state.endAdditionalEffectsOpen}
            trigger={
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
                disabled={state.endAdditionalEffectsOpen}
              >
                <BsThreeDotsVertical size={18} />
              </IconButton>
            }
            variant="soft"
            menuPlacement="end"
          >
            {!state.endAdditionalEffectsOpen ? (
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setOpenMenuIndex(null);
                    patchState({ endAdditionalEffectsOpen: true });
                  }}
                >
                  Add additional effects
                </DropdownMenuItem>
              </DropdownMenuGroup>
            ) : null}
          </DropdownMenu>
        </Flex>
        {renderPatchSubRows(
          state.endPatch,
          (field, value) =>
            patchState({
              endPatch: setPatchField(state.endPatch, field, value),
            }),
          "end",
          state.endAdditionalEffectsOpen,
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
            <div key={i} style={rowBorder}>
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
                            parseInt(e.target.value) || 0,
                          )
                        }
                        onBlur={(e) =>
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
                            intervalValue: parseInt(e.target.value) || 1,
                          })
                        }
                        onBlur={(e) =>
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
                {/* Three-dot menu — pushed to far right */}
                <DropdownMenu
                  open={openMenuIndex === i}
                  onOpenChange={(o) => setOpenMenuIndex(o ? i : null)}
                  trigger={
                    <IconButton
                      type="button"
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="2"
                      highContrast
                    >
                      <BsThreeDotsVertical size={18} />
                    </IconButton>
                  }
                  variant="soft"
                  menuPlacement="end"
                >
                  {!step.additionalEffectsOpen ? (
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={() => {
                          setOpenMenuIndex(null);
                          updateStep(i, { additionalEffectsOpen: true });
                        }}
                      >
                        Add additional effects
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  ) : null}
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setOpenMenuIndex(null);
                        addStepAfter(i);
                      }}
                    >
                      Add step after
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      color="red"
                      onClick={() => {
                        setOpenMenuIndex(null);
                        removeStep(i);
                      }}
                    >
                      Remove step
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenu>
              </Flex>

              {renderPatchSubRows(
                step.patch,
                (field, value) => updateStepPatch(i, field, value),
                i,
                step.additionalEffectsOpen,
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
      {state.steps.some(
        (s) =>
          s.triggerType === "interval" &&
          s.intervalValue * UNIT_MULT[s.intervalUnit] < pollIntervalSeconds,
      ) && (
        <Callout status="warning" mb="3">
          One or more steps are shorter than the minimum check interval (1 min).
          Short steps may be applied together rather than at their exact
          scheduled times.
        </Callout>
      )}

      {boxStepGrid ? (
        <div className="appbox px-3 pt-3 pb-2 bg-light">{renderStepGrid()}</div>
      ) : (
        renderStepGrid()
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
  // Open additional effects if the stored patch already has any effect fields set.
  const additionalEffectsOpen = VALID_STEP_FIELDS.some(
    (f) => patch[f] !== undefined,
  );
  if (step.trigger.type === "approval" || step.trigger.type === "scheduled") {
    const approvalNotes = step.approvalNotes ?? "";
    return {
      patch,
      triggerType: "approval",
      intervalValue: 10,
      intervalUnit: "minutes",
      approvalNotes,
      notesOpen: approvalNotes.trim().length > 0,
      additionalEffectsOpen,
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
    additionalEffectsOpen,
  };
}

// Builds a RampSectionState from an existing RampScheduleInterface for editing.
export function rampScheduleToSectionState(
  rs: RampScheduleInterface,
): RampSectionState {
  const trigger = rs.startCondition?.trigger;
  const startPatch = reconstructUIPatch(rs.startCondition?.actions?.[0]?.patch);
  const endPatch = reconstructUIPatch(rs.endCondition?.actions?.[0]?.patch);
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
    startPatch,
    disableRuleBefore: rs.disableRuleBefore ?? false,
    disableRuleAfter: rs.disableRuleAfter ?? false,
    endEarlyWhenStepsComplete: rs.endEarlyWhenStepsComplete ?? true,
    steps: rs.steps.map(reconstructUIStep),
    endScheduleAt:
      rs.endCondition?.trigger?.type === "scheduled"
        ? new Date(rs.endCondition.trigger.at).toISOString()
        : "",
    endPatch,
    linkedRampId: rs.id,
    startAdditionalEffectsOpen: VALID_STEP_FIELDS.some(
      (f) => startPatch[f] !== undefined,
    ),
    endAdditionalEffectsOpen: VALID_STEP_FIELDS.some(
      (f) => endPatch[f] !== undefined,
    ),
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
    name: "ramp-up",
    startMode: "immediately" as StartMode,
    startTime: "",
    startPatch: { coverage: 0 },
    disableRuleBefore: false,
    disableRuleAfter: false,
    endEarlyWhenStepsComplete: true,
    steps: [
      {
        patch: { coverage: 10 },
        triggerType: "interval",
        intervalValue: 1,
        intervalUnit: "hours",
        approvalNotes: "",
        notesOpen: false,
        additionalEffectsOpen: false,
      },
    ],
    endScheduleAt: "",
    endPatch: { coverage: 100 },
    linkedRampId: "",
    startAdditionalEffectsOpen: false,
    endAdditionalEffectsOpen: false,
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
  const startPatch = reconstructUIPatch(
    action.startCondition?.actions?.[0]?.patch,
  );
  const endPatch = reconstructUIPatch(action.endCondition?.actions?.[0]?.patch);
  return {
    mode: "create",
    name: action.name,
    startMode,
    startTime:
      trigger?.type === "scheduled" ? new Date(trigger.at).toISOString() : "",
    startPatch,
    disableRuleBefore: action.disableRuleBefore ?? false,
    disableRuleAfter: action.disableRuleAfter ?? false,
    endEarlyWhenStepsComplete: action.endEarlyWhenStepsComplete ?? true,
    steps: action.steps.map(reconstructUIStep),
    endScheduleAt:
      action.endCondition?.trigger?.type === "scheduled"
        ? new Date(action.endCondition.trigger.at).toISOString()
        : "",
    endPatch,
    linkedRampId: "",
    startAdditionalEffectsOpen: VALID_STEP_FIELDS.some(
      (f) => startPatch[f] !== undefined,
    ),
    endAdditionalEffectsOpen: VALID_STEP_FIELDS.some(
      (f) => endPatch[f] !== undefined,
    ),
  };
}
