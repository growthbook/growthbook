/**
 * ExperimentRampScheduleModal
 *
 * Single-page modal for configuring an experiment's launch schedule.
 *
 * Always visible  — Start / End dates, Decision Criteria
 * Progressive opt-in — Ramp-up schedule (steps, health signal, end strategy)
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertDialog,
  Box,
  Flex,
  IconButton,
  Separator,
} from "@radix-ui/themes";
import {
  PiArrowCounterClockwise,
  PiArrowSquareOutFill,
  PiBookmarkSimple,
  PiCalendarBlank,
  PiCaretDownBold,
  PiCheck,
  PiPlusBold,
  PiTrash,
  PiXBold,
} from "react-icons/pi";
import { HiBadgeCheck } from "react-icons/hi";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  type ExperimentInterfaceStringDates,
  type ExperimentPhaseStringDates,
} from "shared/types/experiment";
import {
  type RampScheduleInterface,
  type RampScheduleTemplateInterface,
} from "shared/validators";
import { DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS } from "shared/constants";
import {
  DecisionCriteriaData,
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
} from "shared/enterprise";
import {
  reconstructUIStep,
  formatRampStepSummary,
  type UIStep,
  type UIStepPatch,
  type IntervalUnit,
} from "@/components/Features/RuleModal/RampScheduleSection";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Callout from "@/ui/Callout";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import styles from "@/components/Features/RuleModal/RampScheduleSection.module.scss";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import HelperText from "@/ui/HelperText";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import {
  assessStepTargetingRisk,
  remediationToDescription,
  releasePlanToRemediation,
  remediationToReleasePlan,
  stepRiskToRecommendedRolloutData,
  type TargetingSnapshot,
  type StepRiskResult,
  type StepRemediation,
} from "@/services/experimentRampRisk";
import {
  ImpactTooltips,
  getReleasePlanOptions,
  TargetingChangeImpactPanel,
} from "@/components/Experiment/ReleaseChangesForm";
import type { ReleasePlan } from "@/components/Experiment/MakeChangesFlow";
// ─── Constants ────────────────────────────────────────────────────────────────

const UNIT_MULT: Record<IntervalUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

// Only days/hours for this modal; the per-step interval selector below (in
// the advanced grid) still supports minutes since steps can be much shorter.
function bestUnitFromSeconds(s: number): {
  value: number;
  unit: "days" | "hours";
} {
  const r = (v: number) => Math.round(v * 100) / 100;
  if (s >= 86400) return { value: r(s / 86400), unit: "days" };
  return { value: r(s / 3600), unit: "hours" };
}

// Experiment ramps go to 100% (full experiment exposure), unlike feature
// safe-rollout ramps which cap at 50% per monitored step.
// The 100% "complete" step is always the implicit end action; regular ramp
// steps only go up to 50% so each one is a meaningful hold point.
const EXPERIMENT_SIMPLE_COVERAGES = [1, 5, 10, 25, 50];
// First N-1 steps each receive this fraction of total duration; last step
// gets the remainder (so the experiment runs longest at full exposure).
const EXP_RAMP_FRACTION = 0.1;

function generateExperimentSimpleSteps(
  duration: number,
  unit: IntervalUnit,
): UIStep[] {
  const totalSeconds = duration * UNIT_MULT[unit];
  const count = EXPERIMENT_SIMPLE_COVERAGES.length;
  const rampCount = count - 1;
  const rampSeconds = Math.max(
    60,
    Math.round(totalSeconds * EXP_RAMP_FRACTION),
  );
  const holdSeconds = Math.max(60, totalSeconds - rampCount * rampSeconds);
  return EXPERIMENT_SIMPLE_COVERAGES.map((cov, i) => {
    const secs = i < rampCount ? rampSeconds : holdSeconds;
    const { value, unit: stepUnit } = bestUnitFromSeconds(secs);
    return {
      patch: { coverage: cov },
      triggerType: "interval" as const,
      intervalValue: value,
      intervalUnit: stepUnit,
      approvalNotes: "",
      notesOpen: false,
      additionalEffectsOpen: false,
      monitored: true,
    };
  });
}

function stepsMatchExperimentSimplePattern(steps: UIStep[]): boolean {
  if (steps.length !== EXPERIMENT_SIMPLE_COVERAGES.length) return false;
  if (steps.some((s) => s.triggerType !== "interval")) return false;
  return steps.every(
    (s, i) => (s.patch.coverage ?? 0) === EXPERIMENT_SIMPLE_COVERAGES[i],
  );
}

// True when the current steps differ from the canonical simple ramp that
// "Simple View" would regenerate for the current duration — i.e. switching
// would erase customizations (coverage ladder, intervals, or any per-step
// targeting / phase-control effects). Drives the Simple View warning dot.
function experimentStepsAreCustomized(
  steps: UIStep[],
  durationDays: number,
  unit: IntervalUnit,
): boolean {
  const expected = generateExperimentSimpleSteps(durationDays, unit);
  if (steps.length !== expected.length) return true;
  const hasEffects = steps.some((s) => {
    const p = s.patch as Record<string, unknown>;
    return Object.keys(p).some((k) => k !== "coverage" && p[k] !== undefined);
  });
  if (hasEffects) return true;
  const norm = (s: UIStep) =>
    JSON.stringify({
      coverage: s.patch.coverage ?? 0,
      intervalSeconds:
        s.triggerType === "interval"
          ? Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit]
          : null,
      monitored: !!s.monitored,
    });
  return !steps.every((s, i) => norm(s) === norm(expected[i]));
}

// ─── State ────────────────────────────────────────────────────────────────────

/** Per-step remediation choices confirmed by the user in the risk popover. */
interface StepRemediationState {
  confirmed: boolean;
  remediation: StepRemediation;
}

export interface ExperimentRampState {
  steps: UIStep[];
  endCoverage: number; // coverage % (0-100) applied when all ramp steps finish
  startDate: string; // ISO or "" = immediately
  endDate: string; // ISO or "" = manual end (used for "dates" schedule type)
  cutoffDate: string; // ISO or "" = no hard cutoff (used for ramp type)
  builderMode: "simple" | "advanced";
  simpleDurationDays: number;
  simpleDurationUnit: IntervalUnit;

  autoRollbackMode: string;
  rampProgressionMode: string;

  shippingCriteriaMode: "off" | "auto" | "auto-force";
  plannedVariationId: string;

  /** Per-step remediation state, keyed by step index. */
  remediations: Record<number, StepRemediationState>;
}

type OrgAutomationDefaults = {
  defaultAutoRollbackMode?: string;
  defaultRampProgressionMode?: string;
  defaultShippingCriteriaMode?: string;
};

function defaultState(
  schedule: RampScheduleInterface | null,
  experiment: ExperimentInterfaceStringDates,
  orgDefaults: OrgAutomationDefaults = {},
): ExperimentRampState {
  // Shipping criteria are sourced from the experiment — they apply
  // whether or not a ramp schedule exists.
  const sc = experiment.shippingCriteria ?? null;
  const es = experiment.endStrategy ?? null;
  const endDate = experiment.statusUpdateSchedule?.stopAt
    ? new Date(experiment.statusUpdateSchedule.stopAt).toISOString()
    : "";
  const baseShipping = {
    endDate,
    shippingCriteriaMode:
      sc?.mode ??
      (es?.type === "soft-edf"
        ? ("auto" as const)
        : es?.type === "hard-planned"
          ? ("auto-force" as const)
          : ((orgDefaults.defaultShippingCriteriaMode ?? "off") as
              | "off"
              | "auto"
              | "auto-force")),
    plannedVariationId:
      sc?.plannedVariationId ||
      es?.plannedVariationId ||
      experiment.variations[0]?.id ||
      "",
    autoRollbackMode:
      experiment.autoRollbackMode ??
      orgDefaults.defaultAutoRollbackMode ??
      "off",
    rampProgressionMode:
      experiment.rampProgressionMode ??
      orgDefaults.defaultRampProgressionMode ??
      "hold-for-health",
  };
  // Read end coverage from the schedule's endActions (0–1 stored, 0–100 in UI).
  function resolveEndCoverage(s: RampScheduleInterface): number {
    const action = s.endActions?.find((a) => a.targetType === "experiment");
    if (action?.targetType === "experiment" && action.patch.coverage != null) {
      return Math.round(action.patch.coverage * 100);
    }
    return 100;
  }

  if (schedule) {
    const steps = schedule.steps.map(reconstructUIStep);
    const isSimple = stepsMatchExperimentSimplePattern(steps);
    const totalSec = steps.reduce(
      (sum, s) =>
        sum +
        (s.triggerType === "interval"
          ? Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit]
          : 0),
      0,
    );
    const { value: dur, unit } = bestUnitFromSeconds(totalSec || 5 * 86400);
    return {
      steps,
      endCoverage: resolveEndCoverage(schedule),
      startDate: schedule.startDate
        ? new Date(schedule.startDate).toISOString()
        : "",
      cutoffDate: schedule.cutoffDate
        ? new Date(schedule.cutoffDate).toISOString()
        : "",
      builderMode: isSimple ? "simple" : "advanced",
      simpleDurationDays: dur,
      simpleDurationUnit: unit,
      remediations: {},
      ...baseShipping,
    };
  }
  return {
    steps: generateExperimentSimpleSteps(5, "days"),
    endCoverage: 100,
    startDate: "",
    cutoffDate: "",
    builderMode: "simple",
    simpleDurationDays: 5,
    simpleDurationUnit: "days",
    remediations: {},
    ...baseShipping,
  };
}

function buildExperimentSteps(
  steps: UIStep[],
  experimentId: string,
  remediations: Record<number, StepRemediationState>,
): RampScheduleInterface["steps"] {
  return steps.map((s, i) => {
    const p = s.patch;
    const rem = remediations[i];

    const patch: Record<string, unknown> = {
      coverage: (p.coverage ?? 100) / 100,
    };

    if ("condition" in p && p.condition !== undefined) {
      patch.condition = p.condition;
    }
    if ("savedGroups" in p && p.savedGroups !== undefined) {
      patch.savedGroups = p.savedGroups;
    }
    if ("prerequisites" in p && p.prerequisites !== undefined) {
      patch.prerequisites = p.prerequisites;
    }
    if ("variationWeights" in p && p.variationWeights !== undefined) {
      patch.variationWeights = (
        p as UIStepPatch & { variationWeights?: number[] }
      ).variationWeights;
    }

    // Intentional phase controls (set via the ⋯ menu, independent of risk)
    const ext = p as Record<string, unknown>;
    if (ext.newPhase) patch.newPhase = true;
    if (ext.reseed) patch.reseed = true;

    // Remediation-driven flags (from the risk popover) layer on top
    if (rem?.confirmed && rem.remediation) {
      const r = rem.remediation;
      if (r.newPhase) patch.newPhase = true;
      if (r.reseed) patch.reseed = true;
      if (r.bumpBucketVersion) patch.bumpBucketVersion = true;
      if (r.blockPriorBucketed) patch.blockPriorBucketed = true;
    }

    return {
      interval:
        s.triggerType === "interval"
          ? Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit]
          : null,
      actions: [
        {
          targetType: "experiment" as const,
          targetId: experimentId,
          patch:
            patch as RampScheduleInterface["steps"][number]["actions"][number] extends {
              patch: infer P;
            }
              ? P
              : never,
        },
      ],
      monitored: true,
      ...(s.holdConditions ? { holdConditions: s.holdConditions } : {}),
      ...(s.approvalNotes?.trim()
        ? { approvalNotes: s.approvalNotes.trim() }
        : {}),
    };
  });
}

// Placeholder target stored in a template; the real experiment id is injected
// when the template is applied to a specific experiment.
const TEMPLATE_EXPERIMENT_TARGET = "tmpl_experiment";

type ExperimentTemplatePayload = {
  name: string;
  entityType: "experiment";
  steps: RampScheduleInterface["steps"];
  endPatch: { coverage: number };
};

// Build the POST body for saving the current ramp config as an experiment
// template. Captures the ramp structure only (steps + end coverage); per-step
// risk remediations are experiment-instance specific (excluded), and automation
// (rollback / progression / shipping) stays on the experiment + org defaults.
function buildExperimentTemplatePayload(
  state: ExperimentRampState,
  name: string,
): ExperimentTemplatePayload {
  return {
    name,
    entityType: "experiment",
    steps: buildExperimentSteps(state.steps, TEMPLATE_EXPERIMENT_TARGET, {}),
    endPatch: { coverage: (state.endCoverage ?? 100) / 100 },
  };
}

// Structural identity = same steps + end coverage (the parts a template
// captures). Used to disable "Save as template" when nothing has changed and to
// highlight the matching template in the picker.
function experimentTemplateStructure(payload: {
  steps: RampScheduleInterface["steps"];
  endPatch: { coverage: number };
}): string {
  return JSON.stringify({ steps: payload.steps, endPatch: payload.endPatch });
}

// Read a saved experiment template back into modal state. A template captures
// only the ramp structure (steps + end coverage); automation and other
// instance-specific fields (dates, remediations) are preserved from the
// experiment's current state by the caller.
function experimentTemplateToState(
  tmpl: RampScheduleTemplateInterface,
): Partial<ExperimentRampState> {
  return {
    steps: (tmpl.steps ?? []).map(reconstructUIStep),
    endCoverage:
      tmpl.endPatch?.coverage != null
        ? Math.round(tmpl.endPatch.coverage * 100)
        : 100,
    builderMode: "advanced",
    remediations: {},
  };
}

// ─── Remediation dialog (inner form) ─────────────────────────────────────────
// Reuses the Make Changes release plan selector + ImpactTooltips instead of
// reinventing the UI.

function RemediationDialog({
  experiment,
  risk,
  stickyBucketing,
  onConfirm,
  onCancel,
  initialRemediation,
}: {
  experiment: ExperimentInterfaceStringDates;
  risk: StepRiskResult;
  stickyBucketing: boolean;
  onConfirm: (remediation: StepRemediation) => void;
  onCancel: () => void;
  initialRemediation?: StepRemediation;
}) {
  const recommendedRolloutData = useMemo(
    () => stepRiskToRecommendedRolloutData(risk, stickyBucketing),
    [risk, stickyBucketing],
  );

  const initialPlan =
    (initialRemediation
      ? remediationToReleasePlan(initialRemediation)
      : undefined) ?? recommendedRolloutData.actualReleasePlan;

  const [releasePlan, setReleasePlan] = useState<ReleasePlan | undefined>(
    initialPlan,
  );

  const remediation = useMemo(
    () =>
      releasePlan
        ? releasePlanToRemediation(releasePlan)
        : (risk.recommendedRemediation ?? {
            newPhase: false,
            reseed: false,
            bumpBucketVersion: false,
            blockPriorBucketed: false,
          }),
    [releasePlan, risk.recommendedRemediation],
  );

  const newPhase = remediation.newPhase;

  return (
    <AlertDialog.Root open>
      <AlertDialog.Content maxWidth="520px">
        <div className="mt-4 mb-2">
          <SelectField
            label="Release plan"
            value={releasePlan || ""}
            options={getReleasePlanOptions({
              experiment,
              changeType: "advanced",
              recommendedRolloutData,
            })}
            onChange={(v) => {
              const requiresStickyBucketing =
                v === "same-phase-sticky" || v === "new-phase-block-sticky";
              if (requiresStickyBucketing && !stickyBucketing) return;
              setReleasePlan(v as ReleasePlan);
            }}
            sort={false}
            isSearchable={false}
            formatOptionLabel={({ value, label }) => {
              const requiresStickyBucketing =
                value === "same-phase-sticky" ||
                value === "new-phase-block-sticky";
              const recommended =
                value === recommendedRolloutData.recommendedReleasePlan;
              const disabled = requiresStickyBucketing && !stickyBucketing;
              return (
                <div className={disabled ? "cursor-disabled" : undefined}>
                  <span style={{ opacity: disabled ? 0.5 : 1 }}>{label} </span>
                  {requiresStickyBucketing && (
                    <Tooltip
                      body={`${
                        stickyBucketing ? "Uses" : "Requires"
                      } Sticky Bucketing`}
                      className="mr-2"
                    >
                      <span className="text-info small ml-2">
                        (Sticky Bucketing)
                      </span>
                    </Tooltip>
                  )}
                  {recommended && (
                    <span
                      className="text-muted uppercase-title float-right position-relative"
                      style={{ top: 3 }}
                    >
                      recommended
                    </span>
                  )}
                </div>
              );
            }}
            className="select-unfixed"
          />

          <div className="mt-4 mb-3">
            <label className="mb-1">Impact</label>
            <div className="font-weight-semibold">
              {newPhase
                ? remediation.reseed
                  ? "New phase, new randomization seed."
                  : "New phase, same randomization seed."
                : "Same phase, same randomization seed."}{" "}
              {stickyBucketing
                ? remediation.bumpBucketVersion
                  ? remediation.blockPriorBucketed
                    ? "Sticky Bucketed users will be excluded from the experiment."
                    : "Sticky Bucketed users will be reassigned."
                  : "Sticky Bucketed users will keep their assigned bucket."
                : "No sticky bucketing."}
            </div>
          </div>

          <ImpactTooltips
            recommendedRolloutData={recommendedRolloutData}
            releasePlan={releasePlan}
            usingStickyBucketing={stickyBucketing}
            newPhase={newPhase}
            isBandit={experiment.type === "multi-armed-bandit"}
          />
        </div>
        <Flex gap="2" justify="end" mt="3">
          <AlertDialog.Cancel>
            <Button size="sm" variant="ghost" color="gray" onClick={onCancel}>
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button size="sm" onClick={() => onConfirm(remediation)}>
              Confirm
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

// ─── Min sample dialog (inner form) ──────────────────────────────────────────

function MinSampleInput({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue?: number;
  onSave: (value: number | undefined) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(
    (initialValue ?? null) !== null ? String(initialValue) : "",
  );
  const save = () => {
    const val = parseInt(draft);
    onSave(val && val > 0 ? val : undefined);
  };
  return (
    <>
      <Field
        type="number"
        min="0"
        step="1"
        placeholder="none"
        autoFocus
        onFocus={(e) => e.target.select()}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
      />
      <Flex justify="end" gap="2">
        <AlertDialog.Cancel>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action>
          <Button size="sm" onClick={save}>
            Done
          </Button>
        </AlertDialog.Action>
      </Flex>
    </>
  );
}

// ─── Step grid column widths (mirrors RampScheduleSection) ───────────────────

const COL = {
  num: 30,
  coverage: 80,
  trigger: 175,
  duration: 200,
} as const;

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  experiment: ExperimentInterfaceStringDates;
  existingSchedule: RampScheduleInterface | null;
  close: () => void;
  mutate: () => void;
}

export default function ExperimentRampScheduleModal({
  experiment,
  existingSchedule,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature, organization } = useUser();
  const orgSettings = useOrgSettings();
  const experimentMinLengthDays =
    orgSettings?.experimentMinLengthDays ?? DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS;

  const hasRampSchedulesFeature = hasCommercialFeature("ramp-schedules");
  const hasDecisionFramework =
    !!organization?.settings?.decisionFrameworkEnabled &&
    hasCommercialFeature("decision-framework");

  const [hasRamp, setHasRamp] = useState(!!existingSchedule);
  const [state, _setState] = useState<ExperimentRampState>(() =>
    defaultState(existingSchedule, experiment, {
      defaultAutoRollbackMode: organization?.settings?.defaultAutoRollbackMode,
      defaultRampProgressionMode:
        organization?.settings?.defaultRampProgressionMode,
      defaultShippingCriteriaMode:
        organization?.settings?.defaultShippingCriteriaMode,
    }),
  );

  // Experiment ramp templates (feature templates are filtered out — they carry
  // feature-rule actions that don't apply to an experiment).
  const { data: templatesData, mutate: mutateTemplates } = useApi<{
    rampScheduleTemplates: RampScheduleTemplateInterface[];
  }>("/ramp-schedule-templates");
  const experimentTemplates = useMemo(
    () =>
      (templatesData?.rampScheduleTemplates ?? [])
        .filter((t) => t.entityType === "experiment")
        .sort((a, b) => a.order - b.order),
    [templatesData],
  );
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [presetOpen, setPresetOpen] = useState(false);

  // EDF: managed independently of ramp state since it applies whether or not
  // a ramp is configured. Saved to the experiment, not the schedule.
  const [decisionCriteriaId, setDecisionCriteriaId] = useState(
    experiment.decisionFrameworkSettings?.decisionCriteriaId ||
      (organization?.settings?.defaultDecisionCriteriaId ??
        PRESET_DECISION_CRITERIA.id),
  );
  const [showDcDetailsModal, setShowDcDetailsModal] = useState(false);

  // End date UI mode. "after-days" is purely a UI affordance — it still writes
  // a concrete ISO timestamp into state.endDate, computed from startDate + N.
  const [endMode, setEndMode] = useState<"manual" | "on-date" | "after-days">(
    state.endDate ? "on-date" : "manual",
  );
  const [endAfterValue, setEndAfterValue] = useState<number>(
    Math.max(30, experimentMinLengthDays),
  );
  const [endAfterUnit, setEndAfterUnit] = useState<"days" | "hours">("days");

  // Translate "after N <unit>" into a concrete ISO end date based on the
  // current start date (or now() if start is "immediately").
  const computeEndAfter = useCallback(
    (value: number, unit: "days" | "hours"): string => {
      const base = state.startDate ? new Date(state.startDate) : new Date();
      const ms = value * (unit === "days" ? 86400 : 3600) * 1000;
      const d = new Date(base.getTime() + ms);
      d.setSeconds(0, 0);
      return d.toISOString();
    },
    [state.startDate],
  );
  const patch = useCallback(
    (partial: Partial<ExperimentRampState>) =>
      _setState((s) => ({ ...s, ...partial })),
    [],
  );

  // Decision Criteria list — same data as AnalysisForm, kept in sync via the
  // same /decision-criteria endpoint.
  const { data: dcData } = useApi<{ decisionCriteria: DecisionCriteriaData[] }>(
    hasDecisionFramework ? "/decision-criteria" : "/noop",
  );
  const allDecisionCriteria: DecisionCriteriaData[] = [
    ...PRESET_DECISION_CRITERIAS,
    ...(dcData?.decisionCriteria ?? []),
  ];
  const orgDefaultCriteriaId =
    organization?.settings?.defaultDecisionCriteriaId ?? "";
  const orgDefaultCriteria =
    allDecisionCriteria.find((c) => c.id === orgDefaultCriteriaId) ??
    PRESET_DECISION_CRITERIA;

  async function submit() {
    // Persist start/end dates, EDF, and end strategy on the experiment. The
    // end strategy applies whether or not a ramp is configured — it's a
    // refinement of the experiment's scheduled end, not a ramp concept.
    const experimentPatch: Record<string, unknown> = {
      statusUpdateSchedule:
        state.startDate || state.endDate
          ? {
              ...(state.startDate ? { startAt: state.startDate } : {}),
              ...(state.endDate ? { stopAt: state.endDate } : {}),
            }
          : null,
    };
    if (hasDecisionFramework) {
      experimentPatch.decisionFrameworkSettings = {
        ...experiment.decisionFrameworkSettings,
        decisionCriteriaId: decisionCriteriaId || undefined,
      };
    }
    // Shipping criteria — always save the concrete mode chosen
    experimentPatch.shippingCriteria = {
      mode: state.shippingCriteriaMode,
      plannedVariationId:
        state.shippingCriteriaMode === "auto-force"
          ? state.plannedVariationId
          : undefined,
    };
    experimentPatch.endStrategy = null;

    // Automation toggles — always save concrete values so the experiment
    // is not affected if org defaults change later
    experimentPatch.autoRollbackMode = state.autoRollbackMode;
    experimentPatch.rampProgressionMode = state.rampProgressionMode;

    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify(experimentPatch),
    });

    if (!hasRamp) {
      // Remove any existing ramp schedule
      if (existingSchedule) {
        await apiCall(`/experiment/${experiment.id}/ramp-schedule`, {
          method: "DELETE",
        }).catch(() => {});
      }
    } else {
      const steps = buildExperimentSteps(
        state.steps,
        experiment.id,
        state.remediations,
      );
      // The end step fires immediately when all regular ramp steps complete
      // (no interval gate), applying the final coverage to the experiment.
      // Capture the pre-ramp experiment state: coverage=0 (no traffic until
      // step 1) plus targeting from the last phase. On rollback, the engine
      // restores from startActions — mirroring the feature ramp pattern.
      const lastPhase = experiment.phases[experiment.phases.length - 1];
      const startActions = [
        {
          targetType: "experiment" as const,
          targetId: experiment.id,
          patch: {
            coverage: 0,
            variationWeights: lastPhase?.variationWeights ?? [],
            condition: lastPhase?.condition || "{}",
            savedGroups: lastPhase?.savedGroups ?? [],
            prerequisites: lastPhase?.prerequisites ?? [],
          },
        },
      ];
      const endActions = [
        {
          targetType: "experiment" as const,
          targetId: experiment.id,
          patch: { coverage: (state.endCoverage ?? 100) / 100 },
        },
      ];
      const body = {
        steps,
        startActions,
        endActions,
        startDate: state.startDate || null,
        cutoffDate: state.cutoffDate || null,
      };
      if (!existingSchedule) {
        await apiCall(`/experiment/${experiment.id}/ramp-schedule`, {
          method: "POST",
          body: JSON.stringify({ name: `${experiment.name} Ramp`, ...body }),
        });
      } else {
        await apiCall(`/experiment/${experiment.id}/ramp-schedule`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      }
    }

    mutate();
  }

  const isSimpleMode = state.builderMode === "simple";

  const durationSummary = useMemo(() => {
    let totalSec = 0;
    let approvals = 0;
    for (const s of state.steps) {
      if (s.triggerType === "interval") {
        totalSec += Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit];
      } else {
        approvals++;
      }
    }
    const parts: string[] = [];
    if (totalSec > 0) {
      const { value, unit } = bestUnitFromSeconds(totalSec);
      parts.push(`${value} ${unit}`);
    }
    if (approvals > 0) {
      parts.push(`${approvals} approval step${approvals > 1 ? "s" : ""}`);
    }
    const isPure = approvals === 0;
    return { isPure, label: parts.join(" + ") || "0" };
  }, [state.steps]);

  // ── Step grid ─────────────────────────────────────────────────────────────

  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [minSamplePopoverIndex, setMinSamplePopoverIndex] = useState<
    number | null
  >(null);

  function updateStep(i: number, update: Partial<UIStep>) {
    const steps = [...state.steps];
    steps[i] = { ...steps[i], ...update };
    patch({ steps });
  }

  function updateStepPatch(
    i: number,
    field: keyof UIStepPatch | "variationWeights",
    value: unknown,
  ) {
    const steps = [...state.steps];
    steps[i] = {
      ...steps[i],
      patch: { ...steps[i].patch, [field]: value },
      additionalEffectsOpen: true,
    };
    patch({ steps });
  }

  function removeStepPatchField(
    i: number,
    field: keyof UIStepPatch | "variationWeights",
  ) {
    const nextPatch = { ...state.steps[i].patch };
    delete (nextPatch as Record<string, unknown>)[field];
    const hasEffects =
      (["condition", "savedGroups", "prerequisites"] as const).some(
        (f) => f in nextPatch,
      ) || "variationWeights" in nextPatch;
    const steps = [...state.steps];
    steps[i] = {
      ...steps[i],
      patch: nextPatch,
      additionalEffectsOpen: hasEffects,
    };
    patch({ steps });
  }

  const stickyBucketing = !!orgSettings?.useStickyBucketing;

  const baselineTargeting: TargetingSnapshot = useMemo(() => {
    const lastPhase: ExperimentPhaseStringDates | undefined =
      experiment.phases[experiment.phases.length - 1];
    return {
      condition: lastPhase?.condition || "{}",
      savedGroups: lastPhase?.savedGroups || [],
      prerequisites: lastPhase?.prerequisites || [],
      // Pre-ramp coverage is 0 — the experiment isn't exposed to anyone
      // until the first ramp step runs. This matches the feature ramp model
      // where startActions capture the initial (zero-traffic) state.
      coverage: 0,
      variationWeights: lastPhase?.variationWeights || [],
    };
  }, [experiment.phases]);

  const stepRiskResults: StepRiskResult[] = useMemo(() => {
    const results: StepRiskResult[] = [];
    let prior = baselineTargeting;
    for (const step of state.steps) {
      const p = step.patch;
      const next: TargetingSnapshot = {
        condition:
          "condition" in p && p.condition !== undefined
            ? (p.condition ?? "{}")
            : prior.condition,
        savedGroups:
          "savedGroups" in p && p.savedGroups !== undefined
            ? (p.savedGroups ?? [])
            : prior.savedGroups,
        prerequisites:
          "prerequisites" in p && p.prerequisites !== undefined
            ? (p.prerequisites ?? [])
            : prior.prerequisites,
        coverage: (p.coverage ?? 100) / 100,
        variationWeights:
          "variationWeights" in p &&
          (p as UIStepPatch & { variationWeights?: number[] })
            .variationWeights !== undefined
            ? (p as UIStepPatch & { variationWeights?: number[] })
                .variationWeights!
            : prior.variationWeights,
      };
      results.push(assessStepTargetingRisk(prior, next, stickyBucketing));
      prior = next;
    }
    return results;
  }, [state.steps, baselineTargeting, stickyBucketing]);

  const hasUnresolvedRisk = useMemo(() => {
    return stepRiskResults.some(
      (r, i) => !r.safe && !state.remediations[i]?.confirmed,
    );
  }, [stepRiskResults, state.remediations]);

  // Auto-flush stale remediations when step content changes materially.
  // We track a JSON fingerprint of each step's risk-relevant fields; when
  // the fingerprint changes for a step that had a confirmed remediation,
  // we clear it so the user must re-confirm.
  const stepFingerprints = useMemo(
    () =>
      state.steps.map((s) =>
        JSON.stringify({
          coverage: s.patch.coverage,
          condition: "condition" in s.patch ? s.patch.condition : undefined,
          savedGroups:
            "savedGroups" in s.patch ? s.patch.savedGroups : undefined,
          prerequisites:
            "prerequisites" in s.patch ? s.patch.prerequisites : undefined,
          variationWeights:
            "variationWeights" in s.patch
              ? (s.patch as UIStepPatch & { variationWeights?: number[] })
                  .variationWeights
              : undefined,
        }),
      ),
    [state.steps],
  );
  const prevFingerprints = useRef(stepFingerprints);
  useEffect(() => {
    const prev = prevFingerprints.current;
    prevFingerprints.current = stepFingerprints;
    if (prev === stepFingerprints) return;
    const stale: number[] = [];
    for (let i = 0; i < stepFingerprints.length; i++) {
      if (state.remediations[i]?.confirmed && prev[i] !== stepFingerprints[i]) {
        stale.push(i);
      }
    }
    if (stale.length > 0) {
      const next = { ...state.remediations };
      for (const idx of stale) delete next[idx];
      patch({ remediations: next });
    }
  }, [stepFingerprints, state.remediations, patch]);

  const [remediationPopoverIndex, setRemediationPopoverIndex] = useState<
    number | null
  >(null);
  const [riskDetailIndex, setRiskDetailIndex] = useState<number | null>(null);

  const experimentTargetingFields: {
    field: "condition" | "savedGroups" | "prerequisites" | "variationWeights";
    label: string;
  }[] = [
    { field: "condition", label: "Attribute targeting" },
    { field: "savedGroups", label: "Saved group targeting" },
    { field: "prerequisites", label: "Prerequisite targeting" },
    { field: "variationWeights", label: "Variation weights" },
  ];

  function renderStepGrid() {
    return (
      <Box>
        {/* Header */}
        <Flex
          align="center"
          gap="4"
          pb="1"
          pl="2"
          style={{ borderBottom: "1px solid var(--gray-a6)" }}
        >
          <Box style={{ width: COL.num, flexShrink: 0 }}>
            <Text size="small" weight="medium" color="text-low">
              Step
            </Text>
          </Box>
          <Box style={{ width: COL.coverage, flexShrink: 0 }}>
            <Tooltip body="% of eligible users assigned to a variant in this experiment (both control and treatment combined)">
              <Text size="small" weight="medium" color="text-low">
                Coverage
              </Text>
            </Tooltip>
          </Box>
          <Box style={{ width: COL.trigger, flexShrink: 0 }}>
            <Text size="small" weight="medium" color="text-low">
              Action
            </Text>
          </Box>
          <Box flexGrow="1" />
        </Flex>

        {/* Step cards */}
        {state.steps.map((step, i) => {
          const isRisky =
            !stepRiskResults[i]?.safe && !state.remediations[i]?.confirmed;
          return (
            <Box
              key={i}
              my="4"
              style={{
                position: "relative",
                border: isRisky
                  ? "1px solid var(--amber-a8)"
                  : "1px solid var(--gray-a5)",
                borderRadius: "var(--radius-2)",
                paddingBlock: "var(--space-2)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 4,
                  borderRadius: "var(--radius-2) 0 0 var(--radius-2)",
                  backgroundColor: isRisky
                    ? "var(--amber-9)"
                    : "var(--gray-a5)",
                }}
              />
              <Flex direction="column" pl="2">
                {/* Main row */}
                <Flex align="center" gap="4">
                  {/* Step number */}
                  <Box style={{ width: COL.num, flexShrink: 0 }} pl="3">
                    <Text size="small" color="text-low">
                      {i + 1}
                    </Text>
                  </Box>

                  {/* Coverage */}
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
                          updateStep(i, {
                            patch: {
                              ...step.patch,
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

                  {/* Trigger type + interval or approval notes */}
                  <Flex
                    align="center"
                    gap="2"
                    style={
                      step.triggerType === "approval"
                        ? { flex: 1, minWidth: COL.trigger }
                        : {
                            width: COL.trigger + COL.duration + 80,
                            flexShrink: 0,
                          }
                    }
                  >
                    <Box style={{ width: COL.trigger, flexShrink: 0 }}>
                      <SelectField
                        value={step.triggerType}
                        options={[
                          { value: "interval", label: "Hold for" },
                          { value: "approval", label: "Hold for approval" },
                        ]}
                        onChange={(v) => {
                          const next = v as "interval" | "approval";
                          if (next === "approval") {
                            updateStep(i, {
                              triggerType: next,
                              holdConditions: {
                                ...step.holdConditions,
                                requiresApproval: undefined,
                              },
                              notesOpen: !!step.approvalNotes?.trim(),
                            });
                          } else {
                            updateStep(i, {
                              triggerType: next,
                              intervalValue: step.intervalValue || 7,
                              intervalUnit: step.intervalUnit || "days",
                              holdConditions: {
                                ...step.holdConditions,
                                requiresApproval: true,
                              },
                            });
                          }
                        }}
                        containerStyle={{ minHeight: 38 }}
                      />
                    </Box>

                    {step.triggerType === "interval" && (
                      <>
                        <Field
                          style={{ minHeight: 38 }}
                          type="number"
                          min="0"
                          step="any"
                          onFocus={(e) => e.target.select()}
                          value={String(step.intervalValue)}
                          onChange={(e) =>
                            updateStep(i, {
                              intervalValue: parseFloat(e.target.value) || 0,
                            })
                          }
                          onBlur={(e) =>
                            updateStep(i, {
                              intervalValue: Math.max(
                                0.01,
                                parseFloat(e.target.value) || 0.01,
                              ),
                            })
                          }
                          containerStyle={{ width: 75, flexShrink: 0 }}
                        />
                        <Box style={{ width: 95, flexShrink: 0 }}>
                          <SelectField
                            value={step.intervalUnit}
                            options={[
                              { value: "minutes", label: "minutes" },
                              { value: "hours", label: "hours" },
                              { value: "days", label: "days" },
                            ]}
                            onChange={(v) =>
                              updateStep(i, { intervalUnit: v as IntervalUnit })
                            }
                            containerStyle={{ minHeight: 38 }}
                          />
                        </Box>
                        {!step.holdConditions?.requiresApproval && (
                          <Link
                            size="1"
                            color="gray"
                            style={{ flexShrink: 0, whiteSpace: "nowrap" }}
                            onClick={() =>
                              updateStep(i, {
                                holdConditions: {
                                  ...step.holdConditions,
                                  requiresApproval: true,
                                },
                                notesOpen: false,
                              })
                            }
                          >
                            <PiPlusBold
                              style={{
                                marginRight: 3,
                                verticalAlign: "middle",
                              }}
                            />
                            Approval
                          </Link>
                        )}
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
                              style={{
                                marginRight: 3,
                                verticalAlign: "middle",
                              }}
                            />
                            Add approval notes
                          </Link>
                        ) : (
                          <Box style={{ flex: 1, minWidth: 192 }}>
                            <Field
                              label=""
                              placeholder="ex: Check error rates"
                              value={step.approvalNotes}
                              onChange={(e) =>
                                updateStep(i, { approvalNotes: e.target.value })
                              }
                              style={{ minHeight: 38 }}
                            />
                          </Box>
                        )}
                      </Flex>
                    )}
                  </Flex>

                  <Box flexGrow="1" />

                  {/* ⋯ dropdown */}
                  <Flex align="center" gap="2" pr="3" style={{ flexShrink: 0 }}>
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
                      <DropdownMenuGroup label="Hold conditions">
                        <DropdownMenuItem
                          onClick={() => {
                            setOpenMenuIndex(null);
                            setMinSamplePopoverIndex(i);
                          }}
                        >
                          <Flex align="center" gap="1">
                            {(step.holdConditions?.minSampleSize ?? null) !==
                              null && <PiCheck size={16} />}
                            Minimum sample size
                          </Flex>
                        </DropdownMenuItem>
                        {step.triggerType === "interval" && (
                          <DropdownMenuItem
                            onClick={() => {
                              const turningOn =
                                !step.holdConditions?.requiresApproval;
                              setOpenMenuIndex(null);
                              updateStep(i, {
                                holdConditions: {
                                  ...step.holdConditions,
                                  requiresApproval: turningOn,
                                },
                                notesOpen: false,
                                approvalNotes: turningOn
                                  ? step.approvalNotes
                                  : "",
                              });
                            }}
                          >
                            <Flex align="center" gap="1">
                              {step.holdConditions?.requiresApproval && (
                                <PiCheck size={16} />
                              )}
                              Require approval
                            </Flex>
                          </DropdownMenuItem>
                        )}
                        {step.triggerType === "approval" && (
                          <DropdownMenuItem
                            onClick={() => {
                              setOpenMenuIndex(null);
                              updateStep(i, {
                                triggerType: "interval",
                                intervalValue: step.intervalValue || 7,
                                intervalUnit: step.intervalUnit || "days",
                                holdConditions: {
                                  ...step.holdConditions,
                                  requiresApproval: true,
                                },
                              });
                            }}
                          >
                            Add hold duration
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      {(() => {
                        const available = experimentTargetingFields.filter(
                          (f) => !(f.field in step.patch),
                        );
                        if (!available.length) return null;
                        return (
                          <>
                            <DropdownMenuGroup label="Targeting and traffic changes">
                              {available.map((item) => (
                                <DropdownMenuItem
                                  key={item.field}
                                  onClick={() => {
                                    setOpenMenuIndex(null);
                                    const defaultVal =
                                      item.field === "condition"
                                        ? "{}"
                                        : item.field === "variationWeights"
                                          ? baselineTargeting.variationWeights
                                          : [];
                                    updateStepPatch(i, item.field, defaultVal);
                                  }}
                                >
                                  {item.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                          </>
                        );
                      })()}
                      {(() => {
                        const ext = step.patch as Record<string, unknown>;
                        const hasNewPhase = !!ext.newPhase;
                        const hasReseed = !!ext.reseed;
                        return (
                          <DropdownMenuGroup label="Phase controls">
                            <DropdownMenuItem
                              onClick={() => {
                                setOpenMenuIndex(null);
                                updateStepPatch(
                                  i,
                                  "newPhase" as keyof UIStepPatch,
                                  !hasNewPhase || undefined,
                                );
                                if (hasNewPhase) {
                                  updateStepPatch(
                                    i,
                                    "reseed" as keyof UIStepPatch,
                                    undefined,
                                  );
                                }
                              }}
                            >
                              <Flex align="center" gap="1">
                                {hasNewPhase && <PiCheck size={16} />}
                                Start new phase
                              </Flex>
                            </DropdownMenuItem>
                            {hasNewPhase && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setOpenMenuIndex(null);
                                  updateStepPatch(
                                    i,
                                    "reseed" as keyof UIStepPatch,
                                    !hasReseed || undefined,
                                  );
                                }}
                              >
                                <Flex align="center" gap="1">
                                  {hasReseed && <PiCheck size={16} />}
                                  Re-randomize traffic
                                </Flex>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuGroup>
                        );
                      })()}
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() => {
                            setOpenMenuIndex(null);
                            const last = state.steps[i];
                            const newStep: UIStep = {
                              patch: {
                                coverage: Math.min(
                                  100,
                                  (last?.patch?.coverage ?? 50) + 10,
                                ),
                              },
                              triggerType: "interval",
                              intervalValue: last?.intervalValue ?? 7,
                              intervalUnit: last?.intervalUnit ?? "days",
                              approvalNotes: "",
                              notesOpen: false,
                              additionalEffectsOpen: false,
                              monitored: true,
                            };
                            const steps = [...state.steps];
                            steps.splice(i + 1, 0, newStep);
                            patch({ steps });
                          }}
                        >
                          Add step after
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      {state.steps.length > 1 && (
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            color="red"
                            onClick={() => {
                              setOpenMenuIndex(null);
                              patch({
                                steps: state.steps.filter((_, j) => j !== i),
                              });
                            }}
                          >
                            Remove step
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      )}
                    </DropdownMenu>
                  </Flex>
                </Flex>

                {/* "Then:"/"Also:" hold condition sub-rows */}
                {((step.triggerType === "interval" &&
                  step.holdConditions?.requiresApproval) ||
                  (step.holdConditions?.minSampleSize ?? null) !== null) && (
                  <Flex
                    direction="column"
                    gap="1"
                    mt="2"
                    style={{ paddingLeft: COL.num + 16 + COL.coverage + 16 }}
                  >
                    <Text color="text-low" weight="medium">
                      {step.triggerType === "approval" ? "Also:" : "Then:"}
                    </Text>

                    {step.triggerType === "interval" &&
                      step.holdConditions?.requiresApproval && (
                        <Flex
                          align="center"
                          gap="4"
                          style={{ paddingLeft: 16, minHeight: 32 }}
                        >
                          <Flex align="center" gap="3" flexGrow="1">
                            <Box style={{ flexShrink: 0 }}>
                              <Text weight="medium">Hold for approval</Text>
                            </Box>
                            {!step.notesOpen ? (
                              <Link
                                size="1"
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
                                  style={{
                                    marginRight: 3,
                                    verticalAlign: "middle",
                                  }}
                                />
                                Add notes
                              </Link>
                            ) : (
                              <Box style={{ flex: 1, minWidth: 120 }}>
                                <Field
                                  label=""
                                  placeholder="ex: Check error rates"
                                  value={step.approvalNotes}
                                  onChange={(e) =>
                                    updateStep(i, {
                                      approvalNotes: e.target.value,
                                    })
                                  }
                                  style={{ height: 32 }}
                                />
                              </Box>
                            )}
                          </Flex>
                          <Tooltip body="Remove condition" tipMinWidth="50px">
                            <IconButton
                              type="button"
                              variant="ghost"
                              color="red"
                              size="2"
                              radius="full"
                              style={{ marginRight: 11, marginTop: -2 }}
                              onClick={() =>
                                updateStep(i, {
                                  holdConditions: {
                                    ...step.holdConditions,
                                    requiresApproval: false,
                                  },
                                  notesOpen: false,
                                  approvalNotes: "",
                                })
                              }
                            >
                              <PiTrash />
                            </IconButton>
                          </Tooltip>
                        </Flex>
                      )}

                    {(step.holdConditions?.minSampleSize ?? null) !== null && (
                      <Flex
                        align="center"
                        gap="3"
                        style={{ paddingLeft: 16, minHeight: 32 }}
                      >
                        <Box style={{ flexShrink: 0 }}>
                          <Text weight="medium">Hold for min. sample</Text>
                        </Box>
                        <Link
                          size="2"
                          color="gray"
                          style={{ flexShrink: 0 }}
                          onClick={() => setMinSamplePopoverIndex(i)}
                        >
                          {step.holdConditions!.minSampleSize!.toLocaleString()}
                        </Link>
                        <Box flexGrow="1" />
                        <Tooltip body="Remove condition" tipMinWidth="50px">
                          <IconButton
                            type="button"
                            variant="ghost"
                            color="red"
                            size="2"
                            radius="full"
                            style={{ marginRight: 4 }}
                            onClick={() =>
                              updateStep(i, {
                                holdConditions: {
                                  ...step.holdConditions,
                                  minSampleSize: undefined,
                                },
                              })
                            }
                          >
                            <PiTrash />
                          </IconButton>
                        </Tooltip>
                      </Flex>
                    )}
                  </Flex>
                )}

                {/* Targeting / variation weight / phase sub-rows */}
                {(step.additionalEffectsOpen ||
                  !!(step.patch as Record<string, unknown>).newPhase) && (
                  <Box mt="2" pr="2" style={{ paddingLeft: COL.num + 16 }}>
                    <Flex direction="column" gap="2">
                      {"condition" in step.patch && (
                        <Box
                          px="2"
                          py="2"
                          style={{
                            border: "1px solid var(--gray-a5)",
                            borderRadius: "var(--radius-2)",
                          }}
                        >
                          <Box mb="3">
                            <ConditionInput
                              key={`${i}-condition`}
                              defaultValue={step.patch.condition ?? "{}"}
                              onChange={(v) =>
                                updateStepPatch(i, "condition", v)
                              }
                              project={experiment.project ?? ""}
                              slimMode
                              emptyText=""
                              addRemoveMode
                              addRemoveValue={
                                step.patch.condition === null ? "remove" : "set"
                              }
                              onAddRemoveValueChange={(mode) =>
                                updateStepPatch(
                                  i,
                                  "condition",
                                  mode === "remove" ? null : "{}",
                                )
                              }
                              onRemoveEffect={() =>
                                removeStepPatchField(i, "condition")
                              }
                              setModeLabel="Set attribute targeting"
                              removeModeLabel="Remove attribute targeting"
                              labelActions={
                                <Tooltip
                                  body="Remove effect"
                                  tipMinWidth="50px"
                                >
                                  <IconButton
                                    variant="ghost"
                                    color="red"
                                    size="2"
                                    radius="full"
                                    onClick={() =>
                                      removeStepPatchField(i, "condition")
                                    }
                                  >
                                    <PiTrash />
                                  </IconButton>
                                </Tooltip>
                              }
                            />
                          </Box>
                        </Box>
                      )}
                      {"savedGroups" in step.patch && (
                        <Box
                          px="2"
                          py="2"
                          style={{
                            border: "1px solid var(--gray-a5)",
                            borderRadius: "var(--radius-2)",
                          }}
                        >
                          <Box mb="3">
                            <SavedGroupTargetingField
                              value={step.patch.savedGroups ?? []}
                              setValue={(v) =>
                                updateStepPatch(i, "savedGroups", v)
                              }
                              project={experiment.project ?? ""}
                              slimMode
                              addRemoveMode
                              addRemoveValue={
                                step.patch.savedGroups === null
                                  ? "remove"
                                  : "set"
                              }
                              onAddRemoveValueChange={(mode) =>
                                updateStepPatch(
                                  i,
                                  "savedGroups",
                                  mode === "remove" ? null : [],
                                )
                              }
                              onRemoveEffect={() =>
                                removeStepPatchField(i, "savedGroups")
                              }
                              setModeLabel="Set saved group targeting"
                              removeModeLabel="Remove saved group targeting"
                              labelActions={
                                <Tooltip
                                  body="Remove effect"
                                  tipMinWidth="50px"
                                >
                                  <IconButton
                                    variant="ghost"
                                    color="red"
                                    size="2"
                                    radius="full"
                                    onClick={() =>
                                      removeStepPatchField(i, "savedGroups")
                                    }
                                  >
                                    <PiTrash />
                                  </IconButton>
                                </Tooltip>
                              }
                            />
                          </Box>
                        </Box>
                      )}
                      {"prerequisites" in step.patch && (
                        <Box
                          px="2"
                          py="2"
                          style={{
                            border: "1px solid var(--gray-a5)",
                            borderRadius: "var(--radius-2)",
                          }}
                        >
                          <Box mb="3">
                            <PrerequisiteInput
                              value={step.patch.prerequisites ?? []}
                              setValue={(v) =>
                                updateStepPatch(i, "prerequisites", v)
                              }
                              project={experiment.project ?? ""}
                              environments={[]}
                              setPrerequisiteTargetingSdkIssues={() => {}}
                              slimMode
                              addRemoveMode
                              addRemoveValue={
                                step.patch.prerequisites === null
                                  ? "remove"
                                  : "set"
                              }
                              onAddRemoveValueChange={(mode) =>
                                updateStepPatch(
                                  i,
                                  "prerequisites",
                                  mode === "remove" ? null : [],
                                )
                              }
                              onRemoveEffect={() =>
                                removeStepPatchField(i, "prerequisites")
                              }
                              setModeLabel="Set prerequisite targeting"
                              removeModeLabel="Remove prerequisite targeting"
                              labelActions={
                                <Tooltip
                                  body="Remove effect"
                                  tipMinWidth="50px"
                                >
                                  <IconButton
                                    variant="ghost"
                                    color="red"
                                    size="2"
                                    radius="full"
                                    onClick={() =>
                                      removeStepPatchField(i, "prerequisites")
                                    }
                                  >
                                    <PiTrash />
                                  </IconButton>
                                </Tooltip>
                              }
                            />
                          </Box>
                        </Box>
                      )}
                      {"variationWeights" in step.patch && (
                        <Box
                          px="2"
                          py="2"
                          style={{
                            border: "1px solid var(--gray-a5)",
                            borderRadius: "var(--radius-2)",
                            position: "relative",
                          }}
                        >
                          <Box
                            style={{
                              position: "absolute",
                              top: 8,
                              right: 8,
                            }}
                          >
                            <Tooltip body="Remove effect" tipMinWidth="50px">
                              <IconButton
                                variant="ghost"
                                color="red"
                                size="2"
                                radius="full"
                                onClick={() =>
                                  removeStepPatchField(i, "variationWeights")
                                }
                              >
                                <PiTrash />
                              </IconButton>
                            </Tooltip>
                          </Box>
                          <FeatureVariationsInput
                            valueType="string"
                            hideCoverage
                            showPreview={false}
                            label="Variation Weights"
                            startEditingSplits
                            className="mb-0"
                            setWeight={(vi, weight) => {
                              const weights = [
                                ...((
                                  step.patch as UIStepPatch & {
                                    variationWeights?: number[];
                                  }
                                ).variationWeights ??
                                  baselineTargeting.variationWeights),
                              ];
                              weights[vi] = weight;
                              updateStepPatch(i, "variationWeights", weights);
                            }}
                            variations={experiment.variations.map((v, vi) => ({
                              value: v.key || String(vi),
                              name: v.name,
                              weight:
                                (
                                  step.patch as UIStepPatch & {
                                    variationWeights?: number[];
                                  }
                                ).variationWeights?.[vi] ??
                                baselineTargeting.variationWeights[vi] ??
                                0,
                              id: v.id,
                            }))}
                          />
                        </Box>
                      )}

                      {/* Phase control indicator */}
                      {!!(step.patch as Record<string, unknown>).newPhase && (
                        <Box
                          px="2"
                          py="2"
                          style={{
                            border: "1px solid var(--gray-a5)",
                            borderRadius: "var(--radius-2)",
                          }}
                        >
                          <Flex align="center" justify="between">
                            <Flex align="center" gap="1">
                              <Text size="small" weight="medium">
                                Start new phase —
                              </Text>
                              <Popover
                                trigger={
                                  <Link size="1">
                                    {(step.patch as Record<string, unknown>)
                                      .reseed
                                      ? "re-randomize traffic"
                                      : "same randomization seed"}
                                  </Link>
                                }
                                content={
                                  <Flex
                                    direction="column"
                                    gap="2"
                                    style={{ width: 240, padding: 4 }}
                                  >
                                    <Text weight="medium" size="small">
                                      Randomization
                                    </Text>
                                    <SelectField
                                      className="select-unfixed"
                                      value={
                                        (step.patch as Record<string, unknown>)
                                          .reseed
                                          ? "reseed"
                                          : "keep"
                                      }
                                      options={[
                                        {
                                          value: "reseed",
                                          label: "Re-randomize traffic",
                                        },
                                        {
                                          value: "keep",
                                          label: "Same randomization seed",
                                        },
                                      ]}
                                      sort={false}
                                      isSearchable={false}
                                      onChange={(v) =>
                                        updateStepPatch(
                                          i,
                                          "reseed" as keyof UIStepPatch,
                                          v === "reseed" || undefined,
                                        )
                                      }
                                    />
                                  </Flex>
                                }
                              />
                            </Flex>
                            <Tooltip body="Remove effect" tipMinWidth="50px">
                              <IconButton
                                variant="ghost"
                                color="red"
                                size="2"
                                radius="full"
                                onClick={() => {
                                  const nextPatch = { ...step.patch };
                                  delete (nextPatch as Record<string, unknown>)
                                    .newPhase;
                                  delete (nextPatch as Record<string, unknown>)
                                    .reseed;
                                  const steps = [...state.steps];
                                  steps[i] = { ...steps[i], patch: nextPatch };
                                  patch({ steps });
                                }}
                              >
                                <PiTrash />
                              </IconButton>
                            </Tooltip>
                          </Flex>
                        </Box>
                      )}
                    </Flex>
                  </Box>
                )}

                {/* Risk warning + remediation */}
                {!stepRiskResults[i]?.safe && (
                  <Box mt="2" pr="2" style={{ paddingLeft: COL.num + 16 }}>
                    <Callout
                      status={
                        state.remediations[i]?.confirmed ? "success" : "warning"
                      }
                      size="sm"
                    >
                      <Flex direction="column" gap="1" width="100%">
                        <Flex align="center" justify="between">
                          <Text size="small" weight="semibold">
                            {state.remediations[i]?.confirmed
                              ? "Changes resolved"
                              : "The changes in this step may bias experiment results"}
                          </Text>
                          <Link
                            size="1"
                            style={{ flexShrink: 0 }}
                            onClick={() => setRiskDetailIndex(i)}
                          >
                            Learn more
                          </Link>
                        </Flex>
                        {state.remediations[i]?.confirmed ? (
                          <Flex align="center" gap="2" mt="1">
                            <Text size="small" color="text-mid">
                              {remediationToDescription(
                                state.remediations[i].remediation,
                              )}
                            </Text>
                            <Link
                              size="1"
                              onClick={() => setRemediationPopoverIndex(i)}
                            >
                              Change
                            </Link>
                          </Flex>
                        ) : (
                          <Box mt="1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRemediationPopoverIndex(i)}
                            >
                              Choose release plan
                            </Button>
                          </Box>
                        )}
                      </Flex>
                    </Callout>
                  </Box>
                )}
              </Flex>
            </Box>
          );
        })}

        {/* Add step */}
        <Box py="1">
          <Link
            size="2"
            onClick={() => {
              const last = state.steps[state.steps.length - 1];
              patch({
                steps: [
                  ...state.steps,
                  {
                    patch: {
                      coverage: Math.min(99, (last?.patch?.coverage ?? 0) + 10),
                    },
                    triggerType: "interval",
                    intervalValue: last?.intervalValue ?? 7,
                    intervalUnit: last?.intervalUnit ?? "days",
                    approvalNotes: "",
                    notesOpen: false,
                    additionalEffectsOpen: false,
                    monitored: true,
                  },
                ],
              });
            }}
          >
            <PiPlusBold style={{ marginRight: 3, verticalAlign: "middle" }} />
            Add step
          </Link>
        </Box>

        {/* End step — fires immediately once all regular steps finish */}
        <Box
          my="4"
          style={{
            position: "relative",
            border: "1px solid var(--gray-a5)",
            borderRadius: "var(--radius-2)",
            paddingBlock: "var(--space-2)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              borderRadius: "var(--radius-2) 0 0 var(--radius-2)",
              backgroundColor: "var(--gray-a5)",
            }}
          />
          <Flex align="center" gap="4" pl="2">
            <Box style={{ width: COL.num, flexShrink: 0, textAlign: "center" }}>
              <Text size="small" weight="medium" color="text-low">
                end
              </Text>
            </Box>
            <Box style={{ width: COL.coverage, flexShrink: 0 }}>
              <div className={`position-relative ${styles.percentInputWrap}`}>
                <Field
                  style={{ width: COL.coverage, minHeight: 38 }}
                  type="number"
                  min="0"
                  max="100"
                  onFocus={(e) => e.target.select()}
                  value={String(state.endCoverage ?? 100)}
                  onChange={(e) =>
                    patch({
                      endCoverage: Math.min(
                        100,
                        Math.max(0, parseInt(e.target.value) || 0),
                      ),
                    })
                  }
                />
                <span>%</span>
              </div>
            </Box>
            <Box flexGrow="1">
              <Text size="small" color="text-low">
                Ramp-up complete. Experiment continues normally.
              </Text>
            </Box>
          </Flex>
        </Box>

        {/* Min sample dialog */}
        {minSamplePopoverIndex !== null &&
          state.steps[minSamplePopoverIndex] && (
            <AlertDialog.Root open>
              <AlertDialog.Content maxWidth="320px">
                <Flex direction="column" gap="3">
                  <AlertDialog.Title>
                    <Text weight="medium" size="medium">
                      Minimum sample size
                    </Text>
                  </AlertDialog.Title>
                  <AlertDialog.Description>
                    <Text as="span" size="small" color="text-mid">
                      Hold this step until total users reaches this threshold
                    </Text>
                  </AlertDialog.Description>
                  {(() => {
                    const idx = minSamplePopoverIndex;
                    const currentVal =
                      state.steps[idx]?.holdConditions?.minSampleSize;
                    return (
                      <MinSampleInput
                        initialValue={currentVal}
                        onSave={(val) => {
                          updateStep(idx, {
                            holdConditions: {
                              ...state.steps[idx].holdConditions,
                              minSampleSize: val,
                            },
                          });
                          setMinSamplePopoverIndex(null);
                        }}
                        onCancel={() => setMinSamplePopoverIndex(null)}
                      />
                    );
                  })()}
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          )}

        {/* Risk detail modal — reuses the Make Changes impact panel */}
        {riskDetailIndex !== null && stepRiskResults[riskDetailIndex] && (
          <AlertDialog.Root open>
            <AlertDialog.Content maxWidth="520px">
              <Flex direction="column" gap="3">
                <AlertDialog.Title>
                  <Text weight="medium" size="medium">
                    Targeting change impact — Step {riskDetailIndex + 1}
                  </Text>
                </AlertDialog.Title>
                <TargetingChangeImpactPanel
                  reasons={stepRiskResults[riskDetailIndex].reasons}
                  stickyBucketing={stickyBucketing}
                />
                <Flex justify="end">
                  <AlertDialog.Action>
                    <Button size="sm" onClick={() => setRiskDetailIndex(null)}>
                      Close
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        )}

        {/* Remediation dialog */}
        {remediationPopoverIndex !== null &&
          stepRiskResults[remediationPopoverIndex] && (
            <RemediationDialog
              experiment={experiment}
              risk={stepRiskResults[remediationPopoverIndex]}
              stickyBucketing={stickyBucketing}
              initialRemediation={
                state.remediations[remediationPopoverIndex]?.remediation
              }
              onConfirm={(rem) => {
                const idx = remediationPopoverIndex;
                setRemediationPopoverIndex(null);
                patch({
                  remediations: {
                    ...state.remediations,
                    [idx]: { confirmed: true, remediation: rem },
                  },
                });
              }}
              onCancel={() => setRemediationPopoverIndex(null)}
            />
          )}
      </Box>
    );
  }

  function handleDurationChange(dur: number, unit?: IntervalUnit) {
    const d = Math.max(0.01, dur);
    const u = unit ?? state.simpleDurationUnit ?? "days";
    patch({
      simpleDurationDays: d,
      simpleDurationUnit: u,
      steps: generateExperimentSimpleSteps(d, u),
    });
  }

  // ── Health signals ───────────────────────────────────────────────────────
  // Per-signal action resolution follows a 2-tier precedence at evaluation
  // time: experiment override → org default → "warn". This UI surfaces the
  // resolved values as readonly defaults; the "Override" checkbox unlocks them
  // for per-experiment editing.

  const effectiveDecisionCriteria =
    allDecisionCriteria.find((c) => c.id === decisionCriteriaId) ??
    orgDefaultCriteria;

  // ── Date rows (always visible) ─────────────────────────────────────────────

  // Shared width for the label column across Start / End / Ramp-up rows.
  const labelColWidth = 110;

  // Ramp-up row, declared before dateRows so dateRows can inline it. When
  // hasRamp is false, this isn't rendered.
  const rampUpRow = (
    <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
      <Box style={{ width: labelColWidth }}>
        <Text as="label" weight="medium" mb="0">
          Ramp-up over
        </Text>
      </Box>
      {isSimpleMode ? (
        <Flex align="center" gap="3">
          <Field
            type="number"
            min="0"
            step="0.01"
            value={state.simpleDurationDays}
            onFocus={(e) => e.target.select()}
            onChange={(e) =>
              handleDurationChange(parseFloat(e.target.value) || 0)
            }
            onBlur={() =>
              handleDurationChange(
                Math.max(
                  0.01,
                  Math.round(state.simpleDurationDays * 100) / 100,
                ),
              )
            }
            style={{ width: 70, minHeight: 38 }}
          />
          <SelectField
            value={state.simpleDurationUnit ?? "days"}
            options={[
              { value: "minutes", label: "minutes" },
              { value: "hours", label: "hours" },
              { value: "days", label: "days" },
            ]}
            onChange={(v) => {
              const u = v as IntervalUnit;
              patch({ simpleDurationUnit: u });
              handleDurationChange(state.simpleDurationDays, u);
            }}
            containerStyle={{ width: 110 }}
          />
        </Flex>
      ) : (
        <Text color="text-mid">
          {durationSummary.isPure
            ? durationSummary.label
            : `~${durationSummary.label}`}
        </Text>
      )}
      <Tooltip body="Remove ramp-up schedule">
        <IconButton
          variant="ghost"
          color="gray"
          size="2"
          radius="full"
          onClick={() => setHasRamp(false)}
          style={{ marginTop: 0, marginBottom: 0, marginLeft: 0 }}
        >
          <PiXBold />
        </IconButton>
      </Tooltip>
    </Flex>
  );

  // ── Add ramp-up link (only shown when no ramp) ────────────────────────────

  const addRampLink = (
    <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
      <Box style={{ width: labelColWidth }}>
        <Text as="label" weight="medium" mb="0">
          Ramp up
        </Text>
      </Box>
      <Tooltip
        body="Requires the ramp schedules commercial feature"
        shouldDisplay={!hasRampSchedulesFeature}
      >
        <Button
          onClick={() => {
            if (hasRampSchedulesFeature) setHasRamp(true);
          }}
          color={hasRampSchedulesFeature ? undefined : "gray"}
          disabled={!hasRampSchedulesFeature}
        >
          <PiPlusBold style={{ marginRight: 4, verticalAlign: "middle" }} />
          Add ramp-up schedule
        </Button>
      </Tooltip>
    </Flex>
  );

  const dateRows = (
    <Flex direction="column" gap="1" mb="4">
      {/* Start row */}
      <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
        <Box style={{ width: labelColWidth }}>
          <Text as="label" weight="medium" mb="0">
            Start
          </Text>
        </Box>
        <SelectField
          value={state.startDate ? "on-date" : "immediately"}
          options={[
            { value: "immediately", label: "Immediately" },
            { value: "on-date", label: "On date" },
          ]}
          onChange={(v) => {
            if (v === "immediately") {
              patch({ startDate: "" });
            } else {
              const d = new Date();
              d.setSeconds(0, 0);
              patch({ startDate: d.toISOString() });
            }
          }}
          containerStyle={{ minHeight: 38, width: 150 }}
        />
        {state.startDate && (
          <DatePicker
            date={state.startDate || undefined}
            setDate={(d) => patch({ startDate: d ? d.toISOString() : "" })}
            precision="datetime"
            scheduleEndDate={state.endDate || undefined}
          />
        )}
      </Flex>

      {/* End row */}
      <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
        <Box style={{ width: labelColWidth }}>
          <Text as="label" weight="medium" mb="0">
            End
          </Text>
        </Box>
        <SelectField
          value={endMode}
          sort={false}
          options={[
            { value: "manual", label: "Manual end" },
            { value: "after-days", label: "After" },
            { value: "on-date", label: "On date" },
          ]}
          onChange={(v) => {
            const next = v as "manual" | "on-date" | "after-days";
            setEndMode(next);
            if (next === "manual") {
              patch({ endDate: "" });
            } else if (next === "on-date") {
              // Pre-select 30 days out (or the org's minimum runtime if
              // longer) so the user doesn't immediately see a "shorter than
              // minimum" warning.
              const defaultSpanDays = Math.max(30, experimentMinLengthDays);
              const d = new Date();
              d.setDate(d.getDate() + defaultSpanDays);
              d.setSeconds(0, 0);
              patch({ endDate: d.toISOString() });
            } else {
              patch({ endDate: computeEndAfter(endAfterValue, endAfterUnit) });
            }
          }}
          containerStyle={{ minHeight: 38, width: 150 }}
        />
        {endMode === "on-date" && (
          <DatePicker
            date={state.endDate || undefined}
            setDate={(d) => patch({ endDate: d ? d.toISOString() : "" })}
            precision="datetime"
            scheduleStartDate={state.startDate || undefined}
            disableBefore={
              state.startDate ? new Date(state.startDate) : new Date()
            }
          />
        )}
        {endMode === "after-days" && (
          <Flex align="center" gap="3">
            <Field
              type="number"
              min="0.01"
              step="0.01"
              value={endAfterValue}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const n = Math.max(0.01, parseFloat(e.target.value) || 0.01);
                setEndAfterValue(n);
                patch({ endDate: computeEndAfter(n, endAfterUnit) });
              }}
              onBlur={() => {
                const n = Math.max(0.01, Math.round(endAfterValue * 100) / 100);
                setEndAfterValue(n);
                patch({ endDate: computeEndAfter(n, endAfterUnit) });
              }}
              style={{ width: 70, minHeight: 38 }}
            />
            <SelectField
              value={endAfterUnit}
              options={[
                { value: "hours", label: "hours" },
                { value: "days", label: "days" },
              ]}
              onChange={(v) => {
                const u = v as "days" | "hours";
                setEndAfterUnit(u);
                patch({ endDate: computeEndAfter(endAfterValue, u) });
              }}
              containerStyle={{ width: 110 }}
              sort={false}
            />
          </Flex>
        )}
      </Flex>

      {hasRamp ? rampUpRow : addRampLink}

      {(() => {
        if (!state.endDate) return null;
        const start = state.startDate ? new Date(state.startDate) : new Date();
        const end = new Date(state.endDate);
        const spanDays =
          (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (spanDays >= experimentMinLengthDays) return null;
        return (
          <HelperText status="warning" mt="2" size="sm">
            This experiment would end in ~{Math.max(0, Math.round(spanDays))}{" "}
            day{Math.round(spanDays) === 1 ? "" : "s"}, which is shorter than
            the {experimentMinLengthDays}-day minimum runtime. Decision Criteria
            won&apos;t evaluate until that minimum is reached.
          </HelperText>
        );
      })()}
    </Flex>
  );

  // ── Automation section ─────────────────────────────────────────────────────
  // Per-experiment automation toggles. Health signal classification is
  // configured in Decision Criteria; these toggles control execution.

  const orgDefaultShipping =
    organization?.settings?.defaultShippingCriteriaMode ?? "off";
  const orgDefaultRollback =
    organization?.settings?.defaultAutoRollbackMode ?? "off";
  const orgDefaultRampProgression =
    organization?.settings?.defaultRampProgressionMode ?? "hold-for-health";

  const automationSection = (
    <Box mt="5">
      <Text weight="semibold" as="div" mb="3">
        Automation
      </Text>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "180px 1fr",
          gap: "8px 16px",
          alignItems: "center",
        }}
      >
        <Text as="div" weight="medium">
          Shipping
        </Text>
        <SelectField
          value={state.shippingCriteriaMode}
          options={[
            { value: "off", label: "Manual" },
            {
              value: "auto",
              label: "Auto-ship on end date if clear winner",
            },
            {
              value: "auto-force",
              label: "Auto-ship on end date regardless",
            },
          ]}
          onChange={(v) =>
            patch({
              shippingCriteriaMode:
                v as ExperimentRampState["shippingCriteriaMode"],
            })
          }
          isOptionDisabled={(o) =>
            !hasDecisionFramework &&
            "value" in o &&
            (o.value === "auto" || o.value === "auto-force")
          }
          formatOptionLabel={({ value, label }) => (
            <span
              style={{ display: "flex", alignItems: "center", width: "100%" }}
            >
              {label}
              {value === orgDefaultShipping && (
                <span
                  className="text-muted uppercase-title"
                  style={{ marginLeft: "auto" }}
                >
                  default
                </span>
              )}
            </span>
          )}
          sort={false}
          isSearchable={false}
        />
        <Text as="div" weight="medium">
          Rollbacks
        </Text>
        <SelectField
          value={state.autoRollbackMode}
          onChange={(v) => patch({ autoRollbackMode: v })}
          options={[
            { value: "off", label: "Manual" },
            { value: "all", label: "Automatic" },
            {
              value: "health-only",
              label: "Automatic for health signals only",
            },
          ]}
          formatOptionLabel={({ value, label }) => (
            <span
              style={{ display: "flex", alignItems: "center", width: "100%" }}
            >
              {label}
              {value === orgDefaultRollback && (
                <span
                  className="text-muted uppercase-title"
                  style={{ marginLeft: "auto" }}
                >
                  default
                </span>
              )}
            </span>
          )}
          sort={false}
          isSearchable={false}
        />
        {hasRamp && (
          <>
            <Text as="div" weight="medium">
              Ramp schedules
            </Text>
            <SelectField
              value={state.rampProgressionMode}
              onChange={(v) => patch({ rampProgressionMode: v })}
              options={[
                {
                  value: "hold-for-health",
                  label: "Hold for health signals",
                },
                {
                  value: "ignore",
                  label: "Ignore signals",
                },
              ]}
              formatOptionLabel={({ value, label }) => (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                  }}
                >
                  {label}
                  {value === orgDefaultRampProgression && (
                    <span
                      className="text-muted uppercase-title"
                      style={{ marginLeft: "auto" }}
                    >
                      default
                    </span>
                  )}
                </span>
              )}
              sort={false}
              isSearchable={false}
            />
          </>
        )}
      </div>
      {state.shippingCriteriaMode === "auto-force" && (
        <Box mt="3">
          <Text as="label" weight="medium" mb="1">
            Fallback variation (if no clear winner)
          </Text>
          <SelectField
            value={state.plannedVariationId}
            onChange={(v) => patch({ plannedVariationId: v })}
            options={experiment.variations.map((v) => ({
              value: v.id,
              label: v.name,
            }))}
            formatOptionLabel={({ value, label }) => {
              const idx = experiment.variations.findIndex(
                (v) => v.id === value,
              );
              return (
                <span
                  className={`variation variation${idx} with-variation-label d-inline-flex align-items-center`}
                >
                  <span className="label">{idx}</span>
                  {label}
                </span>
              );
            }}
            sort={false}
          />
        </Box>
      )}
    </Box>
  );

  function applyExperimentTemplate(tmpl: RampScheduleTemplateInterface) {
    setPresetOpen(false);
    patch(experimentTemplateToState(tmpl));
    if (!hasRamp) setHasRamp(true);
    setSelectedTemplateId(tmpl.id);
  }

  function clearExperimentTemplate() {
    setPresetOpen(false);
    patch({
      builderMode: "simple",
      steps: generateExperimentSimpleSteps(
        state.simpleDurationDays,
        state.simpleDurationUnit,
      ),
    });
    setSelectedTemplateId("");
  }

  const hasCustomizedSteps = experimentStepsAreCustomized(
    state.steps,
    state.simpleDurationDays,
    state.simpleDurationUnit,
  );

  const currentTemplateStructure = experimentTemplateStructure(
    buildExperimentTemplatePayload(state, ""),
  );
  // Match templates by round-tripping each one through the same
  // apply → build path as the live state, so reconstruction rounding can't
  // cause a spurious mismatch (e.g. ejecting a template right after applying).
  const matchedTemplateId =
    experimentTemplates.find(
      (t) =>
        experimentTemplateStructure(
          buildExperimentTemplatePayload(
            { ...state, ...experimentTemplateToState(t) },
            "",
          ),
        ) === currentTemplateStructure,
    )?.id ?? "";
  const isIdenticalToExistingTemplate = matchedTemplateId !== "";

  // Keep the selection in sync with the current ramp config: any edit (a step
  // value change, Simple View, etc.) that no longer matches a template ejects
  // the selection to "None"/custom — mirroring the feature ramp widget, where
  // every patchState re-resolves the matching template.
  useEffect(() => {
    setSelectedTemplateId((prev) =>
      prev === matchedTemplateId ? prev : matchedTemplateId,
    );
  }, [matchedTemplateId]);

  const selectedTemplate = experimentTemplates.find(
    (t) => t.id === selectedTemplateId,
  );

  const presetTrigger = (
    <Flex
      align="center"
      justify="between"
      gap="2"
      style={{ width: 430, overflow: "hidden" }}
    >
      <Flex align="center" gap="1" style={{ flex: 1, minWidth: 0 }}>
        {selectedTemplate?.official && (
          <HiBadgeCheck
            style={{
              fontSize: "1.2em",
              lineHeight: "1em",
              color: "var(--blue-11)",
              flexShrink: 0,
              display: "block",
            }}
          />
        )}
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: selectedTemplate ? undefined : "var(--gray-a9)",
          }}
        >
          {selectedTemplate?.name ??
            (experimentTemplates.length === 0 ? "No templates" : "None")}
        </span>
      </Flex>
      <PiCaretDownBold style={{ flexShrink: 0 }} />
    </Flex>
  );

  const saveTemplateButton = hasRampSchedulesFeature ? (
    <Popover
      open={saveTemplateOpen}
      onOpenChange={(o) => {
        if (o) setTemplateName("");
        setSaveTemplateOpen(o);
      }}
      align="start"
      side="top"
      showArrow={false}
      contentStyle={{ width: 280, padding: "16px 20px" }}
      trigger={
        <Button
          variant="outline"
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
      content={
        <Flex direction="column" gap="3">
          <Field
            label="Template name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            autoFocus
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                saveAsExperimentTemplate();
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
              onClick={saveAsExperimentTemplate}
            >
              Save
            </Button>
          </Flex>
        </Flex>
      }
    />
  ) : null;

  async function saveAsExperimentTemplate() {
    const name = templateName.trim();
    if (!name || savingTemplate) return;
    setSavingTemplate(true);
    try {
      const res = await apiCall<{ rampScheduleTemplate: { id: string } }>(
        "/ramp-schedule-templates",
        {
          method: "POST",
          body: JSON.stringify(buildExperimentTemplatePayload(state, name)),
        },
      );
      await mutateTemplates();
      setSelectedTemplateId(res.rampScheduleTemplate.id);
      setSaveTemplateOpen(false);
      setTemplateName("");
    } finally {
      setSavingTemplate(false);
    }
  }

  const templateDropdown =
    experimentTemplates.length > 0 && hasRampSchedulesFeature ? (
      <Box mb="4">
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
            onClick={clearExperimentTemplate}
          >
            None
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {experimentTemplates.map((t) => (
            <DropdownMenuItem
              key={t.id}
              className={`multiline-item${
                t.id === selectedTemplateId ? " selected-item" : ""
              }`}
              onClick={() => applyExperimentTemplate(t)}
            >
              <Flex
                justify="between"
                align="center"
                gap="3"
                style={{ width: "100%" }}
              >
                <Flex align="center" gap="1" style={{ flex: 1, minWidth: 0 }}>
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
                <Box style={{ flexShrink: 0 }}>
                  <Text as="span" size="small" color="text-low">
                    {formatRampStepSummary(t.steps)}
                  </Text>
                </Box>
              </Flex>
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
        <Separator size="4" mt="5" />
      </Box>
    ) : null;

  const templateControls = hasRampSchedulesFeature ? (
    <Box mb="3">
      <Text as="div" weight="semibold" mb="1">
        Ramp-up Template
      </Text>
      <div
        style={{
          float: "right",
          position: "sticky",
          top: 0,
          zIndex: 1,
          background: "var(--color-panel-solid)",
          borderRadius: "var(--radius-3)",
        }}
      >
        {saveTemplateButton}
      </div>
      {templateDropdown}
    </Box>
  ) : null;

  // ── Ramp-up steps section (only when hasRamp) ─────────────────────────────
  // Rendered outside the violet box: a template picker + save-as row, then in
  // simple mode the edit-link + progression summary, in advanced the step grid.

  const rampStepsSection = hasRamp ? (
    <>
      {templateControls}
      {isSimpleMode ? (
        <Box mb="4" mt="5">
          {(() => {
            const progression = [
              ...state.steps
                .map((s) => s.patch.coverage)
                .filter((c): c is number => c !== undefined)
                .map((c) => `${c}%`),
              `${state.endCoverage ?? 100}%`,
            ].join(" → ");
            return (
              <Flex align="center" justify="between" mb="2">
                <Button
                  variant="ghost"
                  onClick={() => patch({ builderMode: "advanced" })}
                  icon={<PiCalendarBlank />}
                >
                  Edit Ramp-up Steps
                </Button>
                <Text color="text-low">
                  Steps:{" "}
                  <Text as="span" weight="semibold" color="text-mid">
                    {progression}
                  </Text>
                </Text>
              </Flex>
            );
          })()}
        </Box>
      ) : (
        <>
          <Box mb="4" mt="5">
            <Box mb="3">
              <Tooltip
                body="Will erase any customizations you have made"
                shouldDisplay={hasCustomizedSteps}
                tipPosition="top"
              >
                <Button
                  variant="ghost"
                  onClick={() => {
                    const steps = generateExperimentSimpleSteps(
                      state.simpleDurationDays,
                      state.simpleDurationUnit,
                    );
                    patch({ builderMode: "simple", steps });
                  }}
                  icon={<PiArrowCounterClockwise />}
                >
                  <Flex align="center" gap="1">
                    Simple View
                    {hasCustomizedSteps && (
                      <Box
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          backgroundColor: "var(--amber-9)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </Flex>
                </Button>
              </Tooltip>
            </Box>
            {renderStepGrid()}
          </Box>
        </>
      )}
    </>
  ) : null;

  // ── Decision Criteria panel ───────────────────────────────────────────────
  // Always visible — applies whether or not a ramp is configured. Persisted to
  // the experiment via decisionFrameworkSettings. Ramp behavior overrides are
  // nested here when a ramp is configured, since they're refinements of the
  // chosen Decision Criteria.

  const decisionCriteriaPanel = (
    <Box mt="5" mb="4" px="5" pt="3" pb="4" className="bg-highlight rounded">
      <Flex align="center" gap="2" mb="3">
        <Text weight="semibold" size="large">
          Experiment Decision Framework
        </Text>
        <PaidFeatureBadge commercialFeature="decision-framework" />
      </Flex>
      <Text weight="semibold" as="div" mb="1">
        Decision Criteria
      </Text>
      <Text as="div" size="small" color="text-mid" mb="2">
        Rules for deciding when to ship, rollback, or review.
      </Text>
      {hasDecisionFramework ? (
        <>
          {showDcDetailsModal && (
            <DecisionCriteriaModal
              decisionCriteria={effectiveDecisionCriteria}
              editable={false}
              onClose={() => setShowDcDetailsModal(false)}
              mutate={() => {}}
            />
          )}
          <Flex gap="2" align="end">
            <Box style={{ flex: 1 }}>
              <SelectField
                value={decisionCriteriaId}
                onChange={(v) => {
                  setDecisionCriteriaId(v);
                }}
                options={allDecisionCriteria.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                formatOptionLabel={({ value, label }) => (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                    }}
                  >
                    {label}
                    {value === orgDefaultCriteriaId && (
                      <span
                        className="text-muted uppercase-title"
                        style={{ marginLeft: "auto" }}
                      >
                        default
                      </span>
                    )}
                  </span>
                )}
                sort={false}
              />
            </Box>
            <Button
              variant="outline"
              color="gray"
              onClick={() => setShowDcDetailsModal(true)}
              mb="1"
            >
              View
            </Button>
          </Flex>
        </>
      ) : (
        <Text as="div" size="small" color="text-low">
          Not enabled for this organization.{" "}
          <Link
            href="/settings?tab=experiment"
            target="_blank"
            rel="noreferrer"
          >
            Enable in Organization Settings
            <PiArrowSquareOutFill className="ml-1" />
          </Link>
        </Text>
      )}
      {automationSection}
    </Box>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ModalStandard
      trackingEventModalType="experiment-ramp-schedule-modal"
      open={true}
      close={close}
      size="lg"
      maxWidth="900px"
      header="Schedule Settings"
      submit={submit}
      ctaEnabled={!hasUnresolvedRisk}
    >
      {dateRows}
      {decisionCriteriaPanel}
      {rampStepsSection}
    </ModalStandard>
  );
}
