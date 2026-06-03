/**
 * ExperimentRampScheduleModal
 *
 * Single-page modal for configuring an experiment's launch schedule.
 *
 * Always visible  — Start / End dates, Decision Criteria
 * Progressive opt-in — Ramp-up schedule (steps, health signal, end strategy)
 */
import React, { useCallback, useMemo, useState } from "react";
import { AlertDialog, Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiArrowCounterClockwise,
  PiArrowSquareOutFill,
  PiCalendarBlank,
  PiCheck,
  PiInfo,
  PiPlusBold,
  PiTrash,
  PiXBold,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { type ExperimentInterfaceStringDates } from "shared/types/experiment";
import { type RampScheduleInterface } from "shared/validators";
import {
  generateSimpleSteps,
  reconstructUIStep,
  stepsMatchSimplePattern,
  type UIStep,
  type IntervalUnit,
} from "@/components/Features/RuleModal/RampScheduleSection";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import Tooltip from "@/components/Tooltip/Tooltip";
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
import Checkbox from "@/ui/Checkbox";
import { DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS } from "shared/constants";
import {
  DecisionCriteriaData,
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
} from "shared/enterprise";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";

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

// ─── State ────────────────────────────────────────────────────────────────────

// Per-signal action override. `null` means "inherit from EDF default".
type RampSignalAction = "warn" | "hold" | "rollback" | null;

export interface ExperimentRampState {
  steps: UIStep[];
  startDate: string;   // ISO or "" = immediately
  endDate: string;     // ISO or "" = manual end (used for "dates" schedule type)
  cutoffDate: string;  // ISO or "" = no hard cutoff (used for ramp type)
  builderMode: "simple" | "advanced";
  simpleDurationDays: number;
  simpleDurationUnit: IntervalUnit;

  // Per-experiment overrides for ramp-time health signals. Each `null` means
  // "inherit from EDF" (which itself defaults to "warn" in built-in presets).
  rampBehavior: {
    srmAction: RampSignalAction;
    noTrafficAction: RampSignalAction;
    multipleExposureAction: RampSignalAction;
  };

  // "none" is a UI sentinel for "no automatic action". On save, "none" maps
  // to a null endStrategy on the experiment.
  endStrategyType: "none" | "soft" | "soft-edf" | "hard-planned";
  plannedVariationId: string;
}

function defaultState(
  schedule: RampScheduleInterface | null,
  experiment: ExperimentInterfaceStringDates,
): ExperimentRampState {
  // End date / end strategy are sourced from the experiment — they apply
  // whether or not a ramp schedule exists.
  const es = experiment.endStrategy ?? null;
  const endDate = experiment.endDate
    ? new Date(experiment.endDate).toISOString()
    : "";
  const baseEndStrategy = {
    endDate,
    endStrategyType: es?.type ?? ("none" as const),
    plannedVariationId: es?.plannedVariationId ?? "",
  };
  if (schedule) {
    const steps = schedule.steps.map(reconstructUIStep);
    const isSimple = stepsMatchSimplePattern(steps, { coverage: 100 });
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
      startDate: schedule.startDate ? new Date(schedule.startDate).toISOString() : "",
      cutoffDate: schedule.cutoffDate ? new Date(schedule.cutoffDate).toISOString() : "",
      builderMode: isSimple ? "simple" : "advanced",
      simpleDurationDays: dur,
      simpleDurationUnit: unit,
      rampBehavior: {
        srmAction: schedule.rampBehavior?.srmAction ?? null,
        noTrafficAction: schedule.rampBehavior?.noTrafficAction ?? null,
        multipleExposureAction:
          schedule.rampBehavior?.multipleExposureAction ?? null,
      },
      ...baseEndStrategy,
    };
  }
  return {
    steps: generateSimpleSteps(5, "days").map((s) => ({ ...s, monitored: true })),
    startDate: "",
    cutoffDate: "",
    builderMode: "simple",
    simpleDurationDays: 5,
    simpleDurationUnit: "days",
    rampBehavior: {
      srmAction: null,
      noTrafficAction: null,
      multipleExposureAction: null,
    },
    ...baseEndStrategy,
  };
}

function buildExperimentSteps(
  steps: UIStep[],
  experimentId: string,
): RampScheduleInterface["steps"] {
  return steps.map((s) => ({
    interval:
      s.triggerType === "interval"
        ? Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit]
        : null,
    actions: [
      {
        targetType: "experiment" as const,
        targetId: experimentId,
        patch: { coverage: (s.patch.coverage ?? 100) / 100 },
      },
    ],
    monitored: true,
    ...(s.holdConditions ? { holdConditions: s.holdConditions } : {}),
    ...(s.approvalNotes?.trim() ? { approvalNotes: s.approvalNotes.trim() } : {}),
  }));
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
          if (e.key === "Enter") { e.preventDefault(); save(); }
        }}
      />
      <Flex justify="end" gap="2">
        <AlertDialog.Cancel>
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action>
          <Button size="sm" onClick={save}>Done</Button>
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
    defaultState(existingSchedule, experiment),
  );

  // EDF: managed independently of ramp state since it applies whether or not
  // a ramp is configured. Saved to the experiment, not the schedule.
  const [decisionCriteriaId, setDecisionCriteriaId] = useState(
    experiment.decisionFrameworkSettings?.decisionCriteriaId ?? "",
  );

  // Customize ramp-up behavior: explicit toggle gating the per-signal override
  // section. Defaults to "on" only if the existing schedule already has
  // overrides — otherwise the user opts in to customize.
  const initialCustomize = !!(
    existingSchedule?.rampBehavior &&
    (existingSchedule.rampBehavior.srmAction ||
      existingSchedule.rampBehavior.noTrafficAction ||
      existingSchedule.rampBehavior.multipleExposureAction)
  );
  const [customizeRampBehavior, setCustomizeRampBehavior] =
    useState(initialCustomize);

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
    (partial: Partial<ExperimentRampState>) => _setState((s) => ({ ...s, ...partial })),
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
      ...(state.startDate
        ? { statusUpdateSchedule: { startAt: state.startDate } }
        : { statusUpdateSchedule: null }),
      ...(state.endDate ? { endDate: state.endDate } : { endDate: null }),
    };
    if (hasDecisionFramework) {
      experimentPatch.decisionFrameworkSettings = {
        ...experiment.decisionFrameworkSettings,
        decisionCriteriaId: decisionCriteriaId || undefined,
      };
    }
    // End strategy is only meaningful when there's a scheduled end date.
    // Clear it (null) when the user has no end date or chose "no automatic
    // action"; otherwise persist the configured strategy. The fire date is
    // the experiment's `endDate` itself — not duplicated on the strategy.
    if (!state.endDate || state.endStrategyType === "none") {
      experimentPatch.endStrategy = null;
    } else {
      experimentPatch.endStrategy = {
        type: state.endStrategyType,
        plannedVariationId:
          state.endStrategyType === "hard-planned"
            ? state.plannedVariationId
            : undefined,
      };
    }
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
      const steps = buildExperimentSteps(state.steps, experiment.id);
      // Only send overrides when the user has explicitly opted in to customize.
      // Otherwise the schedule fully inherits from the EDF.
      const rb = state.rampBehavior;
      const rampBehavior = customizeRampBehavior
        ? {
            ...(rb.srmAction !== null ? { srmAction: rb.srmAction } : {}),
            ...(rb.noTrafficAction !== null
              ? { noTrafficAction: rb.noTrafficAction }
              : {}),
            ...(rb.multipleExposureAction !== null
              ? { multipleExposureAction: rb.multipleExposureAction }
              : {}),
          }
        : undefined;
      const body = {
        steps,
        startDate: state.startDate || null,
        cutoffDate: state.cutoffDate || null,
        rampBehavior:
          rampBehavior && Object.keys(rampBehavior).length > 0
            ? rampBehavior
            : undefined,
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

  // Mirrors the feature-side `durationSummary` shape so the rendered label
  // formats consistently across feature and experiment ramp UIs.
  // `isPure === true` means the total is a literal sum of intervals (no
  // approvals, no monitored steps); the renderer skips the `~` prefix in that
  // case. Experiment steps are monitored by default, so the label normally
  // includes the "+ monitored steps" suffix.
  const durationSummary = useMemo(() => {
    let totalSec = 0;
    let approvals = 0;
    let hasMonitored = false;
    for (const s of state.steps) {
      if (s.triggerType === "interval") {
        totalSec += Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit];
      } else {
        approvals++;
      }
      if (s.monitored) hasMonitored = true;
    }
    const parts: string[] = [];
    if (totalSec > 0) {
      const { value, unit } = bestUnitFromSeconds(totalSec);
      parts.push(`${value} ${unit}`);
    }
    if (approvals > 0) {
      parts.push(`${approvals} approval step${approvals > 1 ? "s" : ""}`);
    }
    if (hasMonitored) {
      parts.push("monitored steps");
    }
    const isPure = approvals === 0 && !hasMonitored;
    return { isPure, label: parts.join(" + ") || "0" };
  }, [state.steps]);

  // ── Step grid ─────────────────────────────────────────────────────────────

  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [minSamplePopoverIndex, setMinSamplePopoverIndex] = useState<number | null>(null);

  function updateStep(i: number, update: Partial<UIStep>) {
    const steps = [...state.steps];
    steps[i] = { ...steps[i], ...update };
    patch({ steps });
  }

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
          <Box style={{ width: COL.num }}>
            <Text size="small" color="text-low">Step</Text>
          </Box>
          <Box style={{ width: COL.coverage }}>
            <Text size="small" color="text-low">Rollout %</Text>
          </Box>
          <Box>
            <Text size="small" color="text-low">Action</Text>
          </Box>
          <Box flexGrow="1" />
        </Flex>

        {/* Step cards */}
        {state.steps.map((step, i) => (
          <Box
            key={i}
            my="4"
            style={{
              position: "relative",
              border: "1px solid var(--gray-a5)",
              borderRadius: "var(--radius-2)",
              paddingBlock: "var(--space-2)",
            }}
          >
            {/* Blue left bar — all experiment steps are monitored */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                borderRadius: "var(--radius-2) 0 0 var(--radius-2)",
                backgroundColor: "var(--blue-9)",
              }}
            />
            <Flex direction="column" pl="2">
              {/* Main row */}
              <Flex align="center" gap="4">
                {/* Step number */}
                <Box style={{ width: COL.num, flexShrink: 0 }}>
                  <Text size="small" color="text-low">{i + 1}</Text>
                </Box>

                {/* Coverage */}
                <Box style={{ width: COL.coverage, flexShrink: 0 }}>
                  <div className={`position-relative ${styles.percentInputWrap}`}>
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
                            coverage: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)),
                          },
                        })
                      }
                    />
                    <span>%</span>
                  </div>
                </Box>

                {/* Hold for — always interval */}
                <Flex
                  align="center"
                  gap="2"
                  style={{ width: COL.trigger + COL.duration + 80, flexShrink: 0 }}
                >
                  <Field
                    style={{ minHeight: 38 }}
                    type="number"
                    min="0"
                    step="any"
                    onFocus={(e) => e.target.select()}
                    value={String(step.intervalValue)}
                    onChange={(e) =>
                      updateStep(i, { intervalValue: parseFloat(e.target.value) || 0 })
                    }
                    onBlur={(e) =>
                      updateStep(i, {
                        intervalValue: Math.max(0.01, parseFloat(e.target.value) || 0.01),
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
                      onChange={(v) => updateStep(i, { intervalUnit: v as IntervalUnit })}
                      containerStyle={{ minHeight: 38 }}
                    />
                  </Box>
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
                          {(step.holdConditions?.minSampleSize ?? null) !== null && (
                            <PiCheck size={16} />
                          )}
                          Minimum sample size
                        </Flex>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          const turningOn = !step.holdConditions?.requiresApproval;
                          setOpenMenuIndex(null);
                          updateStep(i, {
                            holdConditions: {
                              ...step.holdConditions,
                              requiresApproval: turningOn,
                            },
                            notesOpen: false,
                            approvalNotes: turningOn ? step.approvalNotes : "",
                          });
                        }}
                      >
                        <Flex align="center" gap="1">
                          {step.holdConditions?.requiresApproval && <PiCheck size={16} />}
                          Require approval
                        </Flex>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={() => {
                          setOpenMenuIndex(null);
                          const last = state.steps[i];
                          const newStep: UIStep = {
                            patch: { coverage: Math.min(100, (last?.patch?.coverage ?? 50) + 10) },
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
                            patch({ steps: state.steps.filter((_, j) => j !== i) });
                          }}
                        >
                          Remove step
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    )}
                  </DropdownMenu>
                </Flex>
              </Flex>

              {/* "Then:" hold condition sub-rows */}
              {(step.holdConditions?.requiresApproval ||
                (step.holdConditions?.minSampleSize ?? null) !== null) && (
                <Flex
                  direction="column"
                  gap="1"
                  mt="2"
                  style={{ paddingLeft: COL.num + 16 + COL.coverage + 16 }}
                >
                  <Text color="text-low" weight="medium">Then:</Text>

                  {step.holdConditions?.requiresApproval && (
                    <Flex align="center" gap="4" style={{ paddingLeft: 16, minHeight: 32 }}>
                      <Flex align="center" gap="3" flexGrow="1">
                        <Box style={{ flexShrink: 0 }}>
                          <Text weight="medium">Hold for approval</Text>
                        </Box>
                        {!step.notesOpen ? (
                          <Link
                            size="1"
                            color="gray"
                            style={{ flexShrink: 0 }}
                            onClick={() => updateStep(i, { notesOpen: true, approvalNotes: "" })}
                          >
                            <PiPlusBold style={{ marginRight: 3, verticalAlign: "middle" }} />
                            Add notes
                          </Link>
                        ) : (
                          <Box style={{ flex: 1, minWidth: 120 }}>
                            <Field
                              label=""
                              placeholder="ex: Check error rates"
                              value={step.approvalNotes}
                              onChange={(e) => updateStep(i, { approvalNotes: e.target.value })}
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
                    <Flex align="center" gap="3" style={{ paddingLeft: 16, minHeight: 32 }}>
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
            </Flex>
          </Box>
        ))}

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
                    patch: { coverage: Math.min(100, (last?.patch?.coverage ?? 50) + 25) },
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

        {/* Min sample dialog */}
        {minSamplePopoverIndex !== null && state.steps[minSamplePopoverIndex] && (
          <AlertDialog.Root open>
            <AlertDialog.Content maxWidth="320px">
              <Flex direction="column" gap="3">
                <AlertDialog.Title>
                  <Text weight="medium" size="medium">Minimum sample size</Text>
                </AlertDialog.Title>
                <AlertDialog.Description>
                  <Text as="span" size="small" color="text-mid">
                    Hold this step until total users reaches this threshold
                  </Text>
                </AlertDialog.Description>
                {(() => {
                  const idx = minSamplePopoverIndex;
                  const currentVal = state.steps[idx]?.holdConditions?.minSampleSize;
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
      </Box>
    );
  }

  function handleDurationChange(dur: number, unit?: IntervalUnit) {
    const d = Math.max(0.01, dur);
    const u = unit ?? state.simpleDurationUnit ?? "days";
    patch({
      simpleDurationDays: d,
      simpleDurationUnit: u,
      steps: generateSimpleSteps(d, u).map((s) => ({ ...s, monitored: true })),
    });
  }

  // ── Computed duration label ───────────────────────────────────────────────

  const durationLabel = useMemo(() => {
    if (state.startDate && state.cutoffDate) {
      const diffMs =
        new Date(state.cutoffDate).getTime() - new Date(state.startDate).getTime();
      if (diffMs > 0) {
        const days = Math.round(diffMs / 86400000);
        return `${days} day${days !== 1 ? "s" : ""}`;
      }
    }
    return durationSummary.isPure
      ? durationSummary.label
      : `~${durationSummary.label}`;
  }, [state.startDate, state.cutoffDate, durationSummary]);

  // When the end date changes in simple mode, regenerate steps to fill the span.
  function handleEndDateChange(iso: string) {
    if (!iso || !isSimpleMode) {
      patch({ cutoffDate: iso });
      return;
    }
    const start = state.startDate ? new Date(state.startDate) : new Date();
    const diffSec = Math.max(3600, (new Date(iso).getTime() - start.getTime()) / 1000);
    const { value, unit } = bestUnitFromSeconds(diffSec);
    patch({
      cutoffDate: iso,
      simpleDurationDays: value,
      simpleDurationUnit: unit,
      steps: generateSimpleSteps(value, unit).map((s) => ({ ...s, monitored: true })),
    });
  }

  // ── Ramp behavior ─────────────────────────────────────────────────────────
  // Per-signal action resolution follows a 3-tier precedence at evaluation
  // time: schedule override → EDF default → "warn". This UI surfaces the
  // resolved values from the experiment's Decision Criteria as readonly
  // defaults; the "Override Decision Criteria" checkbox unlocks them for
  // per-experiment editing.

  const SIGNAL_ACTION_OPTIONS = [
    { value: "warn", label: "Warn only" },
    { value: "hold", label: "Hold step" },
    { value: "rollback", label: "Rollback ramp" },
  ];

  const SIGNAL_FIELDS: {
    key: keyof ExperimentRampState["rampBehavior"];
    label: string;
  }[] = [
    { key: "srmAction", label: "SRM" },
    { key: "noTrafficAction", label: "No traffic" },
    { key: "multipleExposureAction", label: "Multiple exposures" },
  ];

  // Resolved DC: the criteria currently chosen for this experiment, or the
  // org default when no explicit selection has been made. Falls back to the
  // built-in preset when the org default has been deleted.
  const effectiveDecisionCriteria =
    allDecisionCriteria.find((c) => c.id === decisionCriteriaId) ??
    orgDefaultCriteria;
  const dcRampBehavior = effectiveDecisionCriteria.rampBehavior ?? {};
  // Per-signal default (EDF rampBehavior with hardcoded "warn" fallback).
  const signalDefault = (
    key: keyof ExperimentRampState["rampBehavior"],
  ): "warn" | "hold" | "rollback" => dcRampBehavior[key] ?? "warn";

  function toggleCustomize(next: boolean) {
    setCustomizeRampBehavior(next);
    if (!next) {
      // Clear all overrides when turning off so saved state matches reality.
      patch({
        rampBehavior: {
          srmAction: null,
          noTrafficAction: null,
          multipleExposureAction: null,
        },
      });
    } else {
      // Seed any unset signals with the current EDF defaults so users start
      // from the resolved state rather than a blank slate.
      const rb = state.rampBehavior;
      patch({
        rampBehavior: {
          srmAction: rb.srmAction ?? signalDefault("srmAction"),
          noTrafficAction: rb.noTrafficAction ?? signalDefault("noTrafficAction"),
          multipleExposureAction:
            rb.multipleExposureAction ?? signalDefault("multipleExposureAction"),
        },
      });
    }
  }

  const rampBehaviorPanel = (
    <Box mb="4">
      <Checkbox
        label="Use Decision Criteria for ramp behavior"
        weight="medium"
        value={!customizeRampBehavior}
        setValue={(v) => toggleCustomize(!v)}
      />
      <Flex direction="column" gap="2" mt="3">
        {SIGNAL_FIELDS.map((f) => {
          const effectiveValue: "warn" | "hold" | "rollback" =
            customizeRampBehavior
              ? state.rampBehavior[f.key] ?? signalDefault(f.key)
              : signalDefault(f.key);
          return (
            <Flex key={f.key} align="center" gap="3">
              <Box style={{ width: 160, flexShrink: 0 }}>
                <Text as="div" weight="medium">
                  {f.label}
                </Text>
              </Box>
              <Box style={{ flexGrow: 1, maxWidth: 240 }}>
                <SelectField
                  disabled={!customizeRampBehavior}
                  value={effectiveValue}
                  onChange={(v) =>
                    patch({
                      rampBehavior: {
                        ...state.rampBehavior,
                        [f.key]: v as "warn" | "hold" | "rollback",
                      },
                    })
                  }
                  options={SIGNAL_ACTION_OPTIONS}
                  sort={false}
                />
              </Box>
            </Flex>
          );
        })}
      </Flex>
    </Box>
  );

  // ── End strategy ──────────────────────────────────────────────────────────
  // Tied to the experiment's scheduled end date (not the ramp). Only rendered
  // when state.endDate is set — for a manual end, none of these options apply.
  // Persisted on the experiment so it covers both ramp and non-ramp experiments.

  const endStrategyPanel = state.endDate ? (
    <Box mb="4" mt="5">
      <Text as="div" weight="medium" mb="1">
        On end date
      </Text>
      <Text as="div" size="small" color="text-mid" mb="2">
        How GrowthBook should refine the experiment when its scheduled end date is reached.
      </Text>
      <SelectField
        value={state.endStrategyType}
        options={[
          { value: "none", label: "No automatic action" },
          { value: "soft", label: "Remind me to end the experiment" },
          {
            value: "soft-edf",
            label: "Auto-rollout if Decision Criteria has a clear winner, otherwise prompt",
          },
          {
            value: "hard-planned",
            label: "Force-ship a specific variation on the end date",
          },
        ]}
        onChange={(v) =>
          patch({ endStrategyType: v as ExperimentRampState["endStrategyType"] })
        }
        sort={false}
        helpText={
          state.endStrategyType === "soft-edf"
            ? "Uses the Decision Criteria configured above to determine the winner."
            : undefined
        }
      />
      {state.endStrategyType === "hard-planned" && (
        <Box mt="3">
          <Text as="label" weight="medium" mb="1">
            Planned release variation
          </Text>
          <SelectField
            helpText="This variation will be force-shipped on the end date."
            value={state.plannedVariationId}
            onChange={(v) => patch({ plannedVariationId: v })}
            options={[
              { value: "", label: "Select variation…" },
              ...experiment.variations.map((v, i) => ({
                value: v.id,
                label: `${i === 0 ? "Control" : `Variation ${i}`}: ${v.name}`,
              })),
            ]}
          />
        </Box>
      )}
    </Box>
  ) : null;

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

  const dateRows = (
    <Flex direction="column" gap="1" mb="4">
      {/* Start row */}
      <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
        <Box style={{ width: labelColWidth }}>
          <Text as="label" weight="medium" mb="0">Start</Text>
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
          <Text as="label" weight="medium" mb="0">End</Text>
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
            disableBefore={state.startDate ? new Date(state.startDate) : new Date()}
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
                const n = Math.max(
                  0.01,
                  Math.round(endAfterValue * 100) / 100,
                );
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

      {hasRamp && rampUpRow}

      {(() => {
        if (!state.endDate) return null;
        const start = state.startDate
          ? new Date(state.startDate)
          : new Date();
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

  // ── Add ramp-up link (only shown when no ramp) ────────────────────────────

  const addRampLink = (
    <Box mb="4">
      {hasRampSchedulesFeature ? (
        <Link onClick={() => setHasRamp(true)}>
          <PiPlusBold style={{ marginRight: 4, verticalAlign: "middle" }} />
          Add ramp-up schedule
        </Link>
      ) : (
        <Tooltip body="Requires the ramp schedules commercial feature">
          <Link color="gray">
            <PiPlusBold style={{ marginRight: 4, verticalAlign: "middle" }} />
            Add ramp-up schedule
          </Link>
        </Tooltip>
      )}
    </Box>
  );

  // ── Ramp behavior sub-section (only when hasRamp) ─────────────────────────
  // Nested under the Decision Criteria panel since the override semantics are
  // anchored to the chosen Decision Criteria.

  const rampBehaviorSection = hasRamp ? (
    <Box mt="5">{rampBehaviorPanel}</Box>
  ) : null;

  // ── Ramp-up steps section (only when hasRamp) ─────────────────────────────
  // Rendered outside the violet box: in simple mode this is just the
  // edit-link + progression summary; in advanced mode it's the step grid.

  const rampStepsSection = hasRamp ? (
    isSimpleMode ? (
      <Box mb="4" mt="5">
        {(() => {
          const progression = [
            "0%",
            ...state.steps
              .map((s) => s.patch.coverage)
              .filter((c): c is number => c !== undefined)
              .map((c) => `${c}%`),
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
        <Text as="div" weight="semibold" mb="2" mt="5">
          Ramp-up Steps
        </Text>
        <Box mb="4">
          <Box mb="3">
            <Button
              variant="ghost"
              onClick={() => {
                const steps = generateSimpleSteps(
                  state.simpleDurationDays,
                  state.simpleDurationUnit,
                ).map((s) => ({ ...s, monitored: true }));
                patch({ builderMode: "simple", steps });
              }}
              icon={<PiArrowCounterClockwise />}
            >
              Simple View
            </Button>
          </Box>
          <Box className="appbox px-3 pt-3 pb-2 bg-light">
            {renderStepGrid()}
          </Box>
        </Box>
      </>
    )
  ) : null;

  // ── Decision Criteria panel ───────────────────────────────────────────────
  // Always visible — applies whether or not a ramp is configured. Persisted to
  // the experiment via decisionFrameworkSettings. Ramp behavior overrides are
  // nested here when a ramp is configured, since they're refinements of the
  // chosen Decision Criteria.

  const decisionCriteriaPanel = (
    <Box mt="5" mb="4" px="5" pt="3" pb="4" className="bg-highlight rounded">
      <Flex align="center" gap="2" mb="2">
        <Text weight="semibold" size="large">
          Decision Criteria
        </Text>
        <PaidFeatureBadge commercialFeature="decision-framework" />
      </Flex>
      <Text as="div" size="small" color="text-mid" mb="2">
        Evaluates metric and guardrail signals to guide experiment decisions —
        ship, rollback, or hold.
      </Text>
      {hasDecisionFramework ? (
        <SelectField
          value={decisionCriteriaId}
          onChange={(v) => setDecisionCriteriaId(v)}
          options={[
            {
              label: `Default (${orgDefaultCriteria.name})`,
              value: "",
            },
            ...allDecisionCriteria.map((c) => ({
              value: c.id,
              label: c.name,
            })),
          ]}
          formatOptionLabel={({ value, label }) =>
            value === "" ? (
              <em className="text-muted">{label}</em>
            ) : (
              label
            )
          }
          sort={false}
        />
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
      {rampBehaviorSection}
    </Box>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ModalStandard
      trackingEventModalType="experiment-ramp-schedule-modal"
      open={true}
      close={close}
      size="lg"
      header="Schedule Settings"
      submit={submit}
    >
      {dateRows}
      {!hasRamp && addRampLink}
      {endStrategyPanel}
      {decisionCriteriaPanel}
      {rampStepsSection}
    </ModalStandard>
  );
}
