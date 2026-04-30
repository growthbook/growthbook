import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import pick from "lodash/pick";
import { Box, Flex, Separator, IconButton } from "@radix-ui/themes";
import {
  PiPlusBold,
  PiInfo,
  PiCaretDownBold,
  PiBookmarkSimple,
} from "react-icons/pi";
import type {
  FeatureInterface,
  SavedGroupTargeting,
  FeaturePrerequisite,
} from "shared/types/feature";
import {
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RampStepAction,
  TEMPLATE_PATCH_FIELDS,
  TEMPLATE_STRUCTURAL_KEYS,
  type RampStep,
  type FeatureRulePatch,
  type TemplateEndPatch,
  type RevisionRampCreateAction,
} from "shared/validators";
import { date as formatDate } from "shared/dates";
import { BsThreeDotsVertical } from "react-icons/bs";
import { HiBadgeCheck } from "react-icons/hi";
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
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { Popover } from "@/ui/Popover";
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

export interface RampSectionState {
  mode: RampMode;
  name: string;
  // ISO datetime string — "" means start immediately; non-empty means delayed start.
  startDate: string;
  steps: UIStep[];
  endScheduleAt: string; // "" = no end date; non-empty = specific end time (standard schedules only)
  endPatch: UIStepPatch;
  linkedRampId: string;
  // Per-row "additional effects" expansion state (force / condition / savedGroups / prerequisites).
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
    endPatch: scrub(state.endPatch),
    steps: state.steps.map((s) => ({ ...s, patch: scrub(s.patch) })),
  };
}

export function isRampSectionConfigured(state: RampSectionState): boolean {
  return (
    state.mode !== "create" ||
    state.steps.length > 0 ||
    !!state.startDate ||
    !!state.endScheduleAt
  );
}

export function formatRampStepSummary(
  steps: { trigger: { type: string } }[],
): string {
  const count = steps.length;
  const approvals = steps.filter((s) => s.trigger.type === "approval").length;
  const parts = [`${count} step${count !== 1 ? "s" : ""}`];
  if (approvals)
    parts.push(`${approvals} approval${approvals !== 1 ? "s" : ""}`);
  return parts.join(", ");
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

// Builds the endActions array for a single inline target using the "t1" placeholder.
export function buildEndActions(
  endPatch: UIStepPatch,
  ruleId: string,
): RampStepAction[] {
  const patch = buildPatch(endPatch, ruleId);
  const isEmpty = Object.keys(patch).length <= 1; // only ruleId
  if (isEmpty) return [];
  return [
    {
      targetType: "feature-rule",
      targetId: "t1",
      patch,
    },
  ];
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
              seconds: Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit],
            }
          : { type: "approval" as const },
      actions: [{ targetType: "feature-rule" as const, targetId, patch }],
      ...(s.triggerType === "approval" && s.approvalNotes
        ? { approvalNotes: s.approvalNotes }
        : {}),
    };
  });
}

// ── Template structural comparison helpers ────────────────────────────────────

function normalizeActionPatch(patch: Record<string, unknown>) {
  return pick(patch, [
    ...TEMPLATE_PATCH_FIELDS,
    "ruleId",
    "targetId",
    "targetType",
  ]);
}

function normalizeActions(
  actions:
    | { patch: Record<string, unknown>; [k: string]: unknown }[]
    | null
    | undefined,
) {
  if (!actions?.length) return undefined;
  return actions.map((a) => ({ ...a, patch: normalizeActionPatch(a.patch) }));
}

// Normalize structural fields so null/undefined/[] and legacy extra patch fields compare equally.
// Start and end node configuration is intentionally excluded — templates only define intermediate
// steps, and start/end timing or actions are always configured per-instance.
function normalizeStructural(p: Record<string, unknown>) {
  type StepShape = {
    actions: { patch: Record<string, unknown>; [k: string]: unknown }[];
  };
  const steps = ((p.steps as StepShape[]) ?? []).map((s) => ({
    ...s,
    actions: normalizeActions(s.actions) ?? [],
  }));
  return JSON.stringify({ steps });
}

export function findMatchingTemplate(
  state: RampSectionState,
  templates: RampScheduleTemplateInterface[],
): string {
  const payload = buildTemplatePayload(state);
  const current = normalizeStructural(pick(payload, TEMPLATE_STRUCTURAL_KEYS));
  return (
    templates.find(
      (t) => normalizeStructural(pick(t, TEMPLATE_STRUCTURAL_KEYS)) === current,
    )?.id ?? ""
  );
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
  state.steps.forEach((s) => scan(s.patch));
  scan(state.endPatch);
  return fields;
}

const POLL_INTERVAL_SECONDS = 60;

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  ruleRampSchedule: RampScheduleInterface | undefined;
  state: RampSectionState;
  setState: (s: RampSectionState) => void;
  // When true the component renders embedded (no outer separator/heading/switch wrapper).
  embedded?: boolean;
  feature: FeatureInterface;
  environments: string[];
  // When true, wraps the step grid + more options in an appbox card.
  // Used by the standalone modal.
  boxStepGrid?: boolean;
  // When true, hides the name field from the UI. Used in standalone modal to hide
  // the naming concept from the editor. Name is still stored/managed but not editable.
  hideNameField?: boolean;
  // When true, hides the "Save as template" link. Use when already inside a template edit modal.
  hideTemplateSave?: boolean;
  // When true, a draft detach action is pending for this rule. Shows a "pending removal"
  // badge in place of the normal status badge.
  pendingDetach?: boolean;
}

export default function RampScheduleSection({
  ruleRampSchedule,
  state,
  setState,
  embedded = false,
  feature,
  environments,
  boxStepGrid = false,
  hideNameField = false,
  hideTemplateSave = false,
  pendingDetach = false,
}: Props) {
  const [open, setOpen] = useState(embedded || state.mode !== "off");

  const [openMenuIndex, setOpenMenuIndex] = useState<number | "end" | null>(
    null,
  );

  // Auto-switch to "create" mode when opening a ramp editor with no existing ramp
  useEffect(() => {
    if (!ruleRampSchedule && state.mode === "off") {
      patchState({ mode: "create" });
    }
    // patchState is stable (wrapped in useCallback) — omitting it avoids an infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleRampSchedule, state.mode]);

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const hasRampSchedulesFeature = hasCommercialFeature("ramp-schedules");
  const { data: templatesData, mutate: mutateTemplates } = useApi<{
    rampScheduleTemplates: RampScheduleTemplateInterface[];
  }>("/ramp-schedule-templates");
  const templates = templatesData?.rampScheduleTemplates ?? [];

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [presetOpen, setPresetOpen] = useState(false);
  const hasAutoSelected = useRef(false);

  // On first template load: match existing state to a template, or auto-apply
  // the first template (official-first) for fresh creates with no existing ramp.
  useEffect(() => {
    if (hasAutoSelected.current || templates.length === 0) return;
    hasAutoSelected.current = true;
    const matchId = findMatchingTemplate(state, templates);
    if (matchId) {
      setSelectedTemplateId(matchId);
      return;
    }
    if (!ruleRampSchedule && !hideTemplateSave) {
      const first = [...templates].sort(
        (a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0),
      )[0];
      if (first) applyTemplate(first);
    }
    // Intentionally not including `state` or `applyTemplate` — run once on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  function patchState(partial: Partial<RampSectionState>) {
    const newState = { ...state, ...partial };
    if (
      selectedTemplateId &&
      findMatchingTemplate(newState, templates) !== selectedTemplateId
    ) {
      setSelectedTemplateId("");
    }
    setState(newState);
  }

  // Active fields: coverage always + any field set in any step/start/end patch.
  const activeFields = useMemo<Set<StepField>>(
    () => activeFieldsFromState(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.steps, state.endPatch],
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

  // Walk backwards from `beforeIndex` to find the nearest interval step's hold duration.
  function nearestIntervalBefore(
    beforeIndex: number,
  ): Pick<UIStep, "intervalValue" | "intervalUnit"> {
    for (let i = beforeIndex - 1; i >= 0; i--) {
      if (state.steps[i].triggerType === "interval") {
        return {
          intervalValue: state.steps[i].intervalValue,
          intervalUnit: state.steps[i].intervalUnit,
        };
      }
    }
    return { intervalValue: 10, intervalUnit: "minutes" };
  }

  function addStepAfter(afterIndex: number) {
    const prev = state.steps[afterIndex];
    const prevCoverage = prev?.patch.coverage;
    const insertAt = afterIndex + 1;
    const interval =
      prev?.triggerType === "interval"
        ? { intervalValue: prev.intervalValue, intervalUnit: prev.intervalUnit }
        : nearestIntervalBefore(insertAt);
    const newStep: UIStep = {
      patch: {
        coverage:
          prevCoverage !== undefined ? Math.min(100, prevCoverage + 10) : 10,
      },
      triggerType: prev?.triggerType ?? "interval",
      ...interval,
      approvalNotes: "",
      notesOpen: false,
      additionalEffectsOpen: false,
    };
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
    const interval = nearestIntervalBefore(state.steps.length);
    patchState({
      steps: [
        ...state.steps,
        {
          patch: newPatch,
          triggerType: "interval",
          ...interval,
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
    const hasAdditionalEffects = activeFields.size > 1;
    const rowBorder: React.CSSProperties = hasAdditionalEffects
      ? { borderBottom: "1px solid var(--gray-a6)" }
      : {};
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

      // Exclude "force" in template mode — it is feature-type-specific and not portable.
      const templateSafeFields = hideTemplateSave
        ? VALID_STEP_FIELDS.filter((f) => f !== "force")
        : VALID_STEP_FIELDS;
      const fieldsNotInPatch = templateSafeFields.filter((f) => !(f in patch));

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

            {"force" in patch && !hideTemplateSave && (
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
                  emptyText="No targeting applied. Clears any existing targeting."
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
                  emptyText="No targeting applied. Clears any existing targeting."
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
                  emptyText="No targeting applied. Clears any existing targeting."
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
          <Box flexGrow="1" />
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

    const START_OPTIONS = [
      { value: "immediately", label: "Immediately" },
      { value: "on-date", label: "On date" },
    ];

    return (
      <Box>
        {/* Start ramp-up control — hidden for templates (no startDate on templates) */}
        {!hideTemplateSave && (
          <Flex align="center" gap="3" my="5">
            <Box style={{ width: 34 }}>
              <Text size="small" weight="medium" color="text-low">
                Start
              </Text>
            </Box>
            <SelectField
              value={state.startDate ? "on-date" : "immediately"}
              options={START_OPTIONS}
              onChange={(v) => {
                if (v === "immediately") {
                  patchState({ startDate: "" });
                } else {
                  const d = new Date();
                  d.setSeconds(0, 0);
                  patchState({ startDate: d.toISOString().slice(0, 16) });
                }
              }}
              containerClassName="mb-0"
              containerStyle={{ minHeight: 34, width: 150 }}
            />
            {state.startDate && (
              <DatePicker
                date={state.startDate || undefined}
                setDate={(d) =>
                  patchState({ startDate: d ? d.toISOString() : "" })
                }
                precision="datetime"
                containerClassName="mb-0"
              />
            )}
          </Flex>
        )}

        {/* Header row — no label for details column (datetime / interval / text) */}
        <Flex
          align="center"
          gap="4"
          pb="1"
          style={{ borderBottom: "1px solid var(--gray-a6)" }}
        >
          <ColHeader width={COL.num}>Step</ColHeader>
          {activeFields.has("coverage") && (
            <ColHeader width={COL.coverage}>Rollout %</ColHeader>
          )}
          <ColHeader width={COL.trigger}>Action</ColHeader>
          <Box flexGrow="1" />
          {saveTemplateButton}
        </Flex>

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
                            intervalValue: parseInt(e.target.value) || 0,
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
                  {state.steps.length > 1 ? (
                    <>
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
                    </>
                  ) : null}
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

        <Box py="1">
          <Link size="2" onClick={addStep}>
            <PiPlusBold style={{ marginRight: 3, verticalAlign: "middle" }} />
            Add step
          </Link>
        </Box>

        {endRow}
      </Box>
    );
  }

  // ── Create / Edit content ──────────────────────────────────────────────────

  const currentPayload = buildTemplatePayload(state);
  const currentStructural = normalizeStructural(
    pick(currentPayload, TEMPLATE_STRUCTURAL_KEYS),
  );
  const isIdenticalToExistingTemplate = templates.some(
    (t) =>
      normalizeStructural(pick(t, TEMPLATE_STRUCTURAL_KEYS)) ===
      currentStructural,
  );

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const applyTemplate = (tmpl: (typeof templates)[number]) => {
    setPresetOpen(false);
    if (!open) setOpen(true);
    // Switch to "create" mode when the section was collapsed (mode=off) with no live ramp.
    const resolvedMode =
      state.mode === "off" && !ruleRampSchedule ? "create" : state.mode;
    const newState = templateToSectionState(
      tmpl,
      resolvedMode === "edit" ? "edit" : "create",
    );
    // Preserve force values — templates never carry force values, so applying
    // one should not clear a rule's existing forced value.
    const mergeForce = (
      newPatch: UIStepPatch,
      oldPatch: UIStepPatch,
    ): UIStepPatch =>
      oldPatch.force !== undefined
        ? { ...newPatch, force: oldPatch.force }
        : newPatch;
    setState({
      ...newState,
      mode: resolvedMode,
      linkedRampId: state.linkedRampId,
      // Preserve start date — templates don't carry timing info
      startDate: state.startDate,
      endPatch: mergeForce(newState.endPatch, state.endPatch),
      steps: newState.steps.map((s, i) => ({
        ...s,
        patch: mergeForce(s.patch, state.steps[i]?.patch ?? {}),
      })),
    });
    setSelectedTemplateId(tmpl.id);
  };

  const clearTemplate = () => {
    setPresetOpen(false);
    const fresh = defaultRampSectionState(undefined);
    setState({
      ...fresh,
      mode: state.mode === "off" ? "create" : state.mode,
      linkedRampId: state.linkedRampId,
      name: state.name,
    });
    setSelectedTemplateId("");
  };

  const presetTrigger = (
    <Flex
      align="center"
      justify="between"
      gap="2"
      style={{ width: 420, overflow: "hidden" }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: selectedTemplate ? undefined : "var(--gray-a9)",
        }}
      >
        {selectedTemplate?.name ??
          (templates.length === 0 ? "No presets available" : "Custom...")}
      </span>
      <PiCaretDownBold style={{ flexShrink: 0 }} />
    </Flex>
  );

  const templateControls =
    templates.length > 0 && hasRampSchedulesFeature && !hideTemplateSave ? (
      <Flex direction="column" gap="1" mt="5" mb="5">
        <Text as="div" weight="semibold" mb="1">
          Use template
        </Text>
        <Text as="div" size="small" color="text-mid" mb="1">
          Select a premade ramp-up. Manage templates in Organization Settings.
        </Text>
        <DropdownMenu
          variant="soft"
          open={presetOpen}
          onOpenChange={setPresetOpen}
          trigger={presetTrigger}
          triggerClassName="dropdown-trigger-select-style dropdown-trigger-header"
          triggerStyle={{ paddingTop: 4, paddingBottom: 4 }}
          menuWidth="full"
          menuPlacement="end"
        >
          <DropdownMenuItem
            className={!selectedTemplateId ? "selected-item" : ""}
            onClick={clearTemplate}
          >
            Custom...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {[...templates]
            .sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0))
            .map((t) => (
              <React.Fragment key={t.id}>
                <DropdownMenuItem
                  className={`multiline-item${t.id === selectedTemplateId ? " selected-item" : ""}`}
                  onClick={() => applyTemplate(t)}
                >
                  <Flex
                    justify="between"
                    align="center"
                    gap="3"
                    style={{ width: "100%" }}
                  >
                    <Flex
                      align="center"
                      gap="1"
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {t.official && (
                        <HiBadgeCheck
                          style={{
                            fontSize: "1.2em",
                            lineHeight: "1em",
                            marginBottom: 2,
                            color: "var(--blue-11)",
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.name}
                      </span>
                    </Flex>
                    <Text as="span" size="small" color="text-low">
                      {formatRampStepSummary(t.steps)}
                    </Text>
                  </Flex>
                </DropdownMenuItem>
              </React.Fragment>
            ))}
        </DropdownMenu>
      </Flex>
    ) : null;

  const saveTemplateButton =
    hasRampSchedulesFeature && !hideTemplateSave ? (
      <Popover
        open={saveTemplateOpen}
        onOpenChange={(o) => {
          if (o) setTemplateName(state.name || "");
          setSaveTemplateOpen(o);
        }}
        align="end"
        side="bottom"
        showArrow={false}
        contentStyle={{ width: 280, padding: "16px 20px" }}
        trigger={
          <Button
            variant="ghost"
            size="xs"
            disabled={isIdenticalToExistingTemplate}
            title={
              isIdenticalToExistingTemplate
                ? "Identical to an existing template"
                : undefined
            }
            icon={<PiBookmarkSimple size={16} />}
          >
            Save as template
          </Button>
        }
        content={(() => {
          const doSave = async () => {
            if (!templateName.trim() || savingTemplate) return;
            setSavingTemplate(true);
            try {
              const res = await apiCall<{
                rampScheduleTemplate: { id: string };
              }>("/ramp-schedule-templates", {
                method: "POST",
                body: JSON.stringify({
                  ...buildTemplatePayload(state),
                  name: templateName.trim() || state.name || "template",
                }),
              });
              await mutateTemplates();
              setSelectedTemplateId(res.rampScheduleTemplate.id);
              setSaveTemplateOpen(false);
            } finally {
              setSavingTemplate(false);
            }
          };
          return (
            <Flex direction="column" gap="3">
              <Field
                label="Template name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                autoFocus
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  // Prevent Enter from bubbling up and submitting the outer modal.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    doSave();
                  }
                }}
              />
              <Flex justify="end" gap="2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSaveTemplateOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={savingTemplate}
                  disabled={!templateName.trim()}
                  onClick={doSave}
                >
                  Save
                </Button>
              </Flex>
            </Flex>
          );
        })()}
      />
    ) : null;

  const createContent = (
    <>
      {templateControls}

      {state.steps.some(
        (s) =>
          s.triggerType === "interval" &&
          Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit] <
            POLL_INTERVAL_SECONDS,
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

  if (embedded) {
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

// Reconstructs the endPatch UIStepPatch from stored endActions (first action of the list).
export function reconstructUIEndPatch(
  endActions: RampScheduleInterface["endActions"],
): UIStepPatch {
  if (!endActions?.length) return { coverage: 100 };
  return reconstructUIPatch(endActions[0]?.patch);
}

// Builds a RampSectionState from an existing RampScheduleInterface for editing.
export function rampScheduleToSectionState(
  rs: RampScheduleInterface,
): RampSectionState {
  const endPatch = reconstructUIEndPatch(rs.endActions);
  return {
    mode: "edit",
    name: rs.name,
    startDate: rs.startDate ? new Date(rs.startDate).toISOString() : "",
    steps: rs.steps.map(reconstructUIStep),
    endScheduleAt:
      rs.endCondition?.trigger?.type === "scheduled"
        ? new Date(rs.endCondition.trigger.at).toISOString()
        : "",
    endPatch,
    linkedRampId: rs.id,
    endAdditionalEffectsOpen:
      VALID_STEP_FIELDS.some((f) => endPatch[f] !== undefined) ||
      (endPatch.coverage !== undefined && endPatch.coverage !== 100),
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
    name: `ramp-up ${formatDate(new Date())}`,
    startDate: "",
    steps: [
      {
        patch: { coverage: 50 },
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
  const endPatch = reconstructUIEndPatch(action.endActions);
  return {
    mode: "create",
    name: action.name ?? "",
    startDate: action.startDate ? new Date(action.startDate).toISOString() : "",
    steps: action.steps.map(reconstructUIStep),
    endScheduleAt:
      action.endCondition?.trigger?.type === "scheduled"
        ? new Date(action.endCondition.trigger.at).toISOString()
        : "",
    endPatch,
    linkedRampId: "",
    endAdditionalEffectsOpen:
      VALID_STEP_FIELDS.some((f) => endPatch[f] !== undefined) ||
      (endPatch.coverage !== undefined && endPatch.coverage !== 100),
  };
}

/**
 * Converts a `RampScheduleTemplateInterface` into a `RampSectionState`.
 */
export function templateToSectionState(
  template: RampScheduleTemplateInterface,
  mode: "create" | "edit" = "create",
): RampSectionState {
  const rawEndPatch = template.endPatch;
  const endPatch: UIStepPatch = rawEndPatch
    ? reconstructUIPatch(rawEndPatch as RampStepAction["patch"])
    : { coverage: 100 };
  return {
    mode,
    name: template.name,
    startDate: "",
    steps: template.steps.map(reconstructUIStep),
    endScheduleAt: "",
    endPatch,
    linkedRampId: "",
    endAdditionalEffectsOpen:
      VALID_STEP_FIELDS.some((f) => endPatch[f] !== undefined) ||
      (endPatch.coverage !== undefined && endPatch.coverage !== 100),
  };
}

/**
 * Converts the current RampSectionState into a payload suitable for creating/updating a template.
 * Uses placeholder IDs since templates have no real targets.
 */
export function buildTemplatePayload(
  state: RampSectionState,
): Omit<
  RampScheduleTemplateInterface,
  "id" | "organization" | "dateCreated" | "dateUpdated"
> {
  const PLACEHOLDER_TARGET = "template-target";
  const PLACEHOLDER_RULE = "template-rule";

  function stripIds(actions: RampStepAction[]): RampStepAction[] {
    return actions.map((a) => ({
      ...a,
      targetId: PLACEHOLDER_TARGET,
      patch: {
        ...pick(a.patch, TEMPLATE_PATCH_FIELDS),
        ruleId: PLACEHOLDER_RULE,
      },
    }));
  }

  const steps = buildRampSteps(
    state.steps,
    PLACEHOLDER_TARGET,
    PLACEHOLDER_RULE,
  ).map((s) => ({
    ...s,
    actions: stripIds(s.actions),
  }));

  // Build end patch: convert UI scale (0-100) → stored scale (0-1), strip ruleId.
  const rawEndPatch = buildPatch(state.endPatch, PLACEHOLDER_RULE);
  const { ruleId: _ruleId, enabled: _enabled, ...endPatchFields } = rawEndPatch;
  const endPatch: TemplateEndPatch =
    Object.keys(endPatchFields).length > 0
      ? (endPatchFields as TemplateEndPatch)
      : undefined!;

  return {
    name: state.name || "template",
    steps,
    ...(endPatch ? { endPatch } : {}),
  };
}
