// Inline ramp schedule editor inside RuleModal.
// The "Changes" dropdown controls which fields appear on every step row; no per-row add/remove.

import { useMemo, useState, type ReactNode } from "react";
import { Box, Flex, Separator, IconButton } from "@radix-ui/themes";
import {
  PiPlusBold,
  PiLinkBold,
  PiXBold,
  PiHourglassMediumFill,
} from "react-icons/pi";
import Badge from "@/ui/Badge";
import {
  getRampBadgeColor,
  getRampStatusLabel,
  getRampStepsCompleted,
} from "@/components/RampSchedule/RampTimeline";
import RampScheduleDisplay from "@/components/RampSchedule/RampScheduleDisplay";
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
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import Switch from "@/ui/Switch";
import styles from "@/components/Features/VariationsInput.module.scss";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/ui/Tooltip";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import FeatureValueField from "@/components/Features/FeatureValueField";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";

// ─── Types ──────────────────────────────────────────────────────────────────

export type IntervalUnit = "minutes" | "hours";

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
};

export type RampMode = "off" | "create" | "edit" | "link" | "detach";
export type StartMode = "immediately" | "manual" | "specific-time";

export interface RampSectionState {
  mode: RampMode;
  name: string;
  startMode: StartMode; // "immediately" | "manual" | "specific-time"
  startTime: string; // ISO datetime, only used when startMode === "specific-time"
  startPatch: UIStepPatch; // patch applied when the ramp starts (e.g. coverage: 0)
  disableOutsideSchedule: boolean;
  steps: UIStep[];
  endScheduleAt: string; // "" = automatic end; non-empty = specific time
  endSchedulePatch: UIStepPatch;
  linkedRampId: string;
}

const UNIT_MULT: Record<IntervalUnit, number> = { minutes: 60, hours: 3600 };

// ─── Grid column widths ──────────────────────────────────────────────────────

const COL = {
  num: 30, // "1" / "2" / "start" / "end"
  trigger: 130, // trigger type select
  duration: 180, // trigger details (interval inputs, datetime, "Awaiting approval")
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

const PRESETS = [
  {
    label: "Linear / 30 min",
    name: "linear 30-min rollout",
    steps: () =>
      [0, 20, 40, 60, 80, 100].map((coverage) => ({
        patch: { coverage } as UIStepPatch,
        triggerType: "interval" as const,
        intervalValue: 6, // 6-min delta × 5 steps = 30 min total
        intervalUnit: "minutes" as IntervalUnit,
      })),
  },
  {
    label: "Linear / 1 hr",
    name: "linear 1-hour rollout",
    steps: () =>
      [0, 20, 40, 60, 80, 100].map((coverage) => ({
        patch: { coverage } as UIStepPatch,
        triggerType: "interval" as const,
        intervalValue: 12, // 12-min delta × 5 steps = 1 hr total
        intervalUnit: "minutes" as IntervalUnit,
      })),
  },
  {
    label: "Fast (3 steps)",
    name: "fast 3-step rollout",
    steps: () =>
      [0, 25, 75, 100].map((coverage) => ({
        patch: { coverage } as UIStepPatch,
        triggerType: "interval" as const,
        intervalValue: 5,
        intervalUnit: "minutes" as IntervalUnit,
      })),
  },
  {
    label: "With approvals",
    name: "approval-gated rollout",
    steps: () =>
      [0, 25, 75, 100].map((coverage) => ({
        patch: { coverage } as UIStepPatch,
        triggerType: "approval" as const,
        intervalValue: 10,
        intervalUnit: "minutes" as IntervalUnit,
      })),
  },
];

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
      endSchedulePatch: rebuildPatch(state.endSchedulePatch),
      steps: state.steps.map((s, i) => ({
        ...s,
        patch: rebuildPatch(s.patch, i),
      })),
    });
  }

  // ── Step mutations ──────────────────────────────────────────────────────────

  function updateStep(i: number, update: Partial<UIStep>) {
    patchState({
      steps: state.steps.map((s, idx) => (idx === i ? { ...s, ...update } : s)),
    });
  }

  function updateStepPatch(i: number, field: StepField, value: unknown) {
    patchState({
      steps: state.steps.map((s, idx) =>
        idx === i ? { ...s, patch: { ...s.patch, [field]: value } } : s,
      ),
    });
  }

  function removeStep(i: number) {
    patchState({ steps: state.steps.filter((_, idx) => idx !== i) });
  }

  function addStep() {
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
    // Targeting sub-rows exist when any of these fields are active.
    const hasTargeting = (
      ["condition", "savedGroups", "prerequisites"] as StepField[]
    ).some((f) => activeFields.has(f));
    const rowBorder: React.CSSProperties = hasTargeting
      ? { borderBottom: "1px solid var(--gray-a3)" }
      : {};
    // Sub-rows indent only to just past the step number column.
    const subRowIndent = COL.num + 8;

    // Renders a FeatureValueField constrained to a single text row for inline main-row use.
    function renderForceInline(
      patch: UIStepPatch,
      setPatchFn: (field: StepField, value: unknown) => void,
      rowKey: string,
    ) {
      if (!activeFields.has("force")) return null;
      return (
        <Box flexGrow="1" style={{ minWidth: 80 }}>
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
      );
    }

    // Shared sub-row renderer for targeting fields (condition, savedGroups, prerequisites).
    // Rendered outside the two-column Flex so it spans full container width.
    // force is rendered inline on the main row via renderForceInline.
    function renderPatchSubRows(
      patch: UIStepPatch,
      setPatchFn: (field: StepField, value: unknown) => void,
      rowKey: string,
    ) {
      if (!hasTargeting) return null;
      return (
        <Box pb="3" style={{ paddingLeft: subRowIndent }}>
          {activeFields.has("condition") && (
            <Box mb="2">
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
            <Box mb="2">
              <SavedGroupTargetingField
                value={patch.savedGroups ?? []}
                setValue={(v) => setPatchFn("savedGroups", v)}
                project={feature.project ?? ""}
                slimMode
              />
            </Box>
          )}
          {activeFields.has("prerequisites") && (
            <Box mb="2">
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
      );
    }

    // ── Start anchor row — always visible ────────────────────────────────────

    const START_OPTIONS = [
      {
        value: "immediately",
        label: "Immediately",
        tooltip: "Starts as soon as the rule is published",
      },
      {
        value: "manual",
        label: "Manual",
        tooltip: "Requires a manual trigger to begin",
      },
      {
        value: "specific-time",
        label: "Specific date",
        tooltip: "Auto-starts at the scheduled time",
      },
    ];

    const startRow = (
      <div style={rowBorder}>
        <Flex>
          <Box flexGrow="1">
            <Flex align="center" gap="2" py="2">
              <Box
                style={{ width: COL.num, flexShrink: 0, textAlign: "center" }}
              >
                <Text size="small" weight="medium" color="text-low">
                  start
                </Text>
              </Box>
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
              {state.startMode === "specific-time" ? (
                <Box style={{ width: COL.duration, flexShrink: 0 }}>
                  <DatePicker
                    date={state.startTime || undefined}
                    setDate={(d) =>
                      patchState({ startTime: d ? d.toISOString() : "" })
                    }
                    precision="datetime"
                    containerClassName="mb-0"
                  />
                </Box>
              ) : (
                <Box style={{ width: COL.duration, flexShrink: 0 }} />
              )}
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
              {renderForceInline(
                state.startPatch,
                (field, value) =>
                  patchState({
                    startPatch: { ...state.startPatch, [field]: value },
                  }),
                "start",
              )}
            </Flex>
          </Box>
          {/* Placeholder outside content box — mirrors step remove-button slot */}
          <Box
            flexShrink="0"
            mt="2"
            pt="3"
            px="1"
            style={{ visibility: "hidden" }}
          >
            <IconButton
              type="button"
              color="gray"
              variant="ghost"
              radius="full"
              size="1"
              disabled
              style={{ margin: 0 }}
            >
              <PiXBold size={16} />
            </IconButton>
          </Box>
        </Flex>
        {/* Sub-rows span full width, outside the two-column flex */}
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
        <Flex>
          <Box flexGrow="1">
            {/* Main end row */}
            <Flex align="center" gap="2" py="2">
              <Box
                style={{ width: COL.num, flexShrink: 0, textAlign: "center" }}
              >
                <Text size="small" weight="medium" color="text-low">
                  end
                </Text>
              </Box>
              <Box style={{ width: COL.trigger, flexShrink: 0 }}>
                <SelectField
                  value={endTriggerType}
                  options={[
                    { value: "automatic", label: "Automatic" },
                    { value: "specific-time", label: "Specific time" },
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
                />
              </Box>
              {endTriggerType === "specific-time" ? (
                <Box style={{ width: COL.duration, flexShrink: 0 }}>
                  <DatePicker
                    date={state.endScheduleAt || undefined}
                    setDate={(d) =>
                      patchState({ endScheduleAt: d ? d.toISOString() : "" })
                    }
                    precision="datetime"
                    containerClassName="mb-0"
                  />
                </Box>
              ) : (
                <Box style={{ width: COL.duration, flexShrink: 0 }} />
              )}
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
              {renderForceInline(
                state.endSchedulePatch,
                (field, value) =>
                  patchState({
                    endSchedulePatch: {
                      ...state.endSchedulePatch,
                      [field]: value,
                    },
                  }),
                "end",
              )}
            </Flex>
          </Box>
          {/* Placeholder outside content box — mirrors step remove-button slot */}
          <Box
            flexShrink="0"
            mt="2"
            pt="3"
            px="1"
            style={{ visibility: "hidden" }}
          >
            <IconButton
              type="button"
              color="gray"
              variant="ghost"
              radius="full"
              size="1"
              disabled
              style={{ margin: 0 }}
            >
              <PiXBold size={16} />
            </IconButton>
          </Box>
        </Flex>
        {/* Sub-rows span full width, outside the two-column flex */}
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
          gap="2"
          pb="2"
          style={{ borderBottom: "1px solid var(--gray-a3)" }}
        >
          <ColHeader width={COL.num}>Step</ColHeader>
          <ColHeader width={COL.trigger}>Trigger</ColHeader>
          <Box style={{ width: COL.duration, flexShrink: 0 }} />
          {activeFields.has("coverage") && (
            <ColHeader width={COL.coverage}>Coverage</ColHeader>
          )}
          {activeFields.has("force") && <ColHeader width={80}>Value</ColHeader>}
          <Box style={{ width: 28, flexShrink: 0 }} />
        </Flex>

        {startRow}

        {state.steps.map((step, i) => {
          return (
            <div
              key={i}
              style={
                hasTargeting ? { borderBottom: "1px solid var(--gray-a3)" } : {}
              }
            >
              {/*
                Outer Flex: two columns —
                  left (flexGrow): main grid row + sub-rows
                  right (flexShrink, pt="3"): remove slot, anchored top-right
              */}
              <Flex>
                <Box flexGrow="1">
                  {/* Main grid row */}
                  <Flex align="center" gap="2" py="2">
                    {/* Step number */}
                    <Box
                      style={{
                        width: COL.num,
                        flexShrink: 0,
                        textAlign: "center",
                      }}
                    >
                      <Text size="small" color="text-low">
                        {i + 1}
                      </Text>
                    </Box>

                    {/* Trigger */}
                    <Box style={{ width: COL.trigger, flexShrink: 0 }}>
                      <SelectField
                        value={step.triggerType}
                        options={[
                          { value: "interval", label: "Timed" },
                          { value: "approval", label: "Approval" },
                        ]}
                        onChange={(v) =>
                          updateStep(i, {
                            triggerType: v as "interval" | "approval",
                          })
                        }
                        containerClassName="mb-0"
                        containerStyle={{ minHeight: 38 }}
                      />
                    </Box>

                    {/* Duration */}
                    <Box style={{ width: COL.duration, flexShrink: 0 }}>
                      {step.triggerType === "interval" ? (
                        <Flex align="center" gap="1">
                          <Field
                            style={{ minHeight: 38 }}
                            type="number"
                            min="1"
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
                        </Flex>
                      ) : (
                        <Text size="medium" color="text-low">
                          Awaiting approval
                        </Text>
                      )}
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
                    {/* Feature value — inline with coverage */}
                    {renderForceInline(
                      step.patch,
                      (field, value) => updateStepPatch(i, field, value),
                      `step-${i}`,
                    )}
                  </Flex>
                </Box>

                {/* Remove slot — top-right, outside all rows */}
                <Box flexShrink="0" mt="2" pt="3" px="1">
                  <Tooltip content="Remove step">
                    <IconButton
                      type="button"
                      color="gray"
                      variant="ghost"
                      radius="full"
                      size="1"
                      style={{ margin: 0 }}
                      onClick={() => removeStep(i)}
                    >
                      <PiXBold size={16} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Flex>

              {/* Sub-rows span full width, outside the two-column flex */}
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
      {/* Presets */}
      <Box mb="4">
        <Text size="medium" weight="medium" mb="1" as="p">
          Preset
        </Text>
        <Flex gap="2" wrap="wrap">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              onClick={() => {
                patchState({ steps: p.steps(), name: p.name });
                onSetRuleCoverage?.(0);
              }}
            >
              {p.label}
            </Button>
          ))}
        </Flex>
      </Box>

      <Field
        label="Ramp schedule name"
        required={state.mode === "create"}
        value={state.name}
        onChange={(e) => patchState({ name: e.target.value })}
        placeholder="e.g. ramp up"
      />

      {/* Subtle lifecycle option — above the grid */}
      <Flex align="center" mb="3">
        <Checkbox
          size="sm"
          label="Disable rule outside of schedule"
          value={state.disableOutsideSchedule}
          setValue={(v) => patchState({ disableOutsideSchedule: v })}
        />
      </Flex>

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
            {["pending", "paused", "completed", "expired", "rolled-back"].includes(
              ruleRampSchedule.status,
            ) && (
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
          <RampScheduleDisplay
            rs={ruleRampSchedule}
            targetId={
              ruleRampSchedule.targets.find((t) => t.status === "active")?.id
            }
          />
        </Box>
      )}

      {/* Detach confirmation row */}
      {ruleRampSchedule && state.mode === "detach" && (
        <Flex align="center" gap="2" mb="3">
          <Text size="medium" color="text-low">
            This rule will be detached from &ldquo;
            <strong>{ruleRampSchedule.name}</strong>&rdquo; on save.
          </Text>
          <Link onClick={() => patchState({ mode: "edit", linkedRampId: ruleRampSchedule.id })}>
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
    };
  }
  const seconds = step.trigger.seconds;
  const useHours = seconds % 3600 === 0 && seconds >= 3600;
  return {
    patch,
    triggerType: "interval",
    intervalUnit: useHours ? "hours" : "minutes",
    intervalValue: useHours ? seconds / 3600 : seconds / 60,
  };
}

// Builds a RampSectionState from an existing RampScheduleInterface for editing.
export function rampScheduleToSectionState(
  rs: RampScheduleInterface,
): RampSectionState {
  return {
    mode: "edit",
    name: rs.name,
    startMode:
      rs.startTrigger?.type === "scheduled"
        ? "specific-time"
        : rs.startTrigger?.type === "manual"
          ? "manual"
          : "immediately",
    startTime:
      rs.startTrigger?.type === "scheduled"
        ? new Date(rs.startTrigger.at).toISOString()
        : "",
    startPatch: reconstructUIPatch(rs.startActions?.[0]?.patch),
    disableOutsideSchedule: rs.disableOutsideSchedule ?? false,
    steps: rs.steps.map(reconstructUIStep),
    endScheduleAt:
      rs.endSchedule?.trigger.type === "scheduled"
        ? new Date(rs.endSchedule.trigger.at).toISOString()
        : "",
    endSchedulePatch: reconstructUIPatch(rs.endSchedule?.actions?.[0]?.patch),
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
    disableOutsideSchedule: false,
    steps: DEFAULT_STEPS.map((s) => ({ ...s, patch: { ...s.patch } })),
    endScheduleAt: "",
    endSchedulePatch: {},
    linkedRampId: "",
  };
}
