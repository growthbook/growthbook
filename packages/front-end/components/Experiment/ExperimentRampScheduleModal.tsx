/**
 * ExperimentRampScheduleModal
 *
 * Two-page modal for configuring an experiment's launch schedule, modelled
 * closely on the feature-flag ramp schedule editor.
 *
 * Page 1 — Schedule type + optional start date
 * Page 2 — Step editor (coverage-only), EDF panel, monitoring behaviour,
 *           end strategy, template matching
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  Box,
  Flex,
  IconButton,
  Separator,
} from "@radix-ui/themes";
import {
  PiArrowCounterClockwise,
  PiBookmarkSimple,
  PiCalendarBlank,
  PiCaretDownFill,
  PiCaretRight,
  PiCheck,
  PiInfo,
  PiPlusBold,
  PiTrash,
  PiXBold,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { HiBadgeCheck } from "react-icons/hi";
import {
  type ExperimentInterfaceStringDates,
  type DecisionCriteriaData,
} from "shared/types/experiment";
import {
  type RampScheduleInterface,
  type RampScheduleTemplateInterface,
} from "shared/validators";
import {
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
} from "shared/enterprise";
import {
  generateSimpleSteps,
  reconstructUIStep,
  stepsMatchSimplePattern,
  formatRampStepSummary,
  findMatchingTemplate,
  type UIStep,
  type IntervalUnit,
  type RampSectionState,
} from "@/components/Features/RuleModal/RampScheduleSection";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "@/components/Features/RuleModal/RampScheduleSection.module.scss";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { Select, SelectItem } from "@/ui/Select";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";

// ─── Constants ────────────────────────────────────────────────────────────────

const UNIT_MULT: Record<IntervalUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

function bestUnitFromSeconds(s: number): { value: number; unit: IntervalUnit } {
  const r = (v: number) => Math.round(v * 100) / 100;
  if (s >= 96 * 3600) return { value: r(s / 86400), unit: "days" };
  if (s >= 3600) return { value: r(s / 3600), unit: "hours" };
  return { value: r(s / 60), unit: "minutes" };
}

// ─── State ────────────────────────────────────────────────────────────────────

export type ExperimentScheduleType = "dates" | "ramp";

export interface ExperimentRampState {
  steps: UIStep[];
  startDate: string;   // ISO or "" = immediately
  endDate: string;     // ISO or "" = manual end (used for "dates" schedule type)
  cutoffDate: string;  // ISO or "" = no hard cutoff (used for ramp type)
  builderMode: "simple" | "advanced";
  simpleDurationDays: number;
  simpleDurationUnit: IntervalUnit;

  pauseOnHealthSignal: boolean;

  endStrategyType: "none" | "soft" | "soft-edf" | "hard-planned";
  endStrategyDate: string;
  plannedVariationId: string;

  // "" = keep the experiment's current DC (no change on save)
  decisionCriteriaId: string;
}

function defaultState(
  schedule: RampScheduleInterface | null,
  experiment: ExperimentInterfaceStringDates,
): ExperimentRampState {
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
    const es = schedule.endStrategy;
    return {
      steps,
      startDate: schedule.startDate ? new Date(schedule.startDate).toISOString() : "",
      endDate: "",
      cutoffDate: schedule.cutoffDate ? new Date(schedule.cutoffDate).toISOString() : "",
      builderMode: isSimple ? "simple" : "advanced",
      simpleDurationDays: dur,
      simpleDurationUnit: unit,
      pauseOnHealthSignal: schedule.pauseOnHealthSignal ?? true,
      endStrategyType: es?.type ?? "none",
      endStrategyDate: es?.date ? new Date(es.date).toISOString() : "",
      plannedVariationId: es?.plannedVariationId ?? "",
      decisionCriteriaId: experiment.decisionFrameworkSettings?.decisionCriteriaId ?? "",
    };
  }
  return {
    steps: generateSimpleSteps(5, "days").map((s) => ({ ...s, monitored: true })),
    startDate: "",
    endDate: "",
    cutoffDate: "",
    builderMode: "simple",
    simpleDurationDays: 5,
    simpleDurationUnit: "days",
    pauseOnHealthSignal: true,
    endStrategyType: "none",
    endStrategyDate: "",
    plannedVariationId: "",
    decisionCriteriaId: experiment.decisionFrameworkSettings?.decisionCriteriaId ?? "",
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
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();

  const { data: dcData } = useApi<{
    decisionCriteria: DecisionCriteriaData[];
  }>("/decision-criteria");

  const hasRampSchedulesFeature = hasCommercialFeature("ramp-schedules");

  const [step, setStep] = useState(0);
  const [scheduleType, setScheduleType] = useState<ExperimentScheduleType>(
    existingSchedule ? "ramp" : "dates",
  );
  const [state, _setState] = useState<ExperimentRampState>(() =>
    defaultState(existingSchedule, experiment),
  );
  const patch = useCallback(
    (partial: Partial<ExperimentRampState>) => _setState((s) => ({ ...s, ...partial })),
    [],
  );

  // Templates for experiment entity type
  const { data: templatesData, mutate: mutateTemplates } = useApi<{
    rampScheduleTemplates: RampScheduleTemplateInterface[];
  }>("/ramp-schedule-templates");
  const templates = (templatesData?.rampScheduleTemplates ?? []).filter(
    (t) => !t.entityType || t.entityType === "experiment",
  );

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [presetOpen, setPresetOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const hasAutoSelected = useRef(false);

  // Decision criteria list
  const allCriteria: DecisionCriteriaData[] = [
    ...PRESET_DECISION_CRITERIAS,
    ...(dcData?.decisionCriteria ?? []),
  ];
  const orgDefaultCriteriaId = settings?.defaultDecisionCriteriaId ?? "";
  const orgDefaultCriteria =
    allCriteria.find((c) => c.id === orgDefaultCriteriaId) ?? PRESET_DECISION_CRITERIA;
  const isUsingOrgDefault =
    !state.decisionCriteriaId || state.decisionCriteriaId === orgDefaultCriteriaId;

  // Auto-select matching template on first load
  useEffect(() => {
    if (hasAutoSelected.current || templates.length === 0) return;
    hasAutoSelected.current = true;
    const sectionState: RampSectionState = {
      mode: existingSchedule ? "edit" : "create",
      name: "",
      startDate: state.startDate,
      steps: state.steps,
      endScheduleAt: state.cutoffDate,
      endPatch: { coverage: 100 },
      linkedRampId: existingSchedule?.id ?? "",
      endAdditionalEffectsOpen: false,
      cutoffDate: state.cutoffDate,
      lockFeature: false,
      builderMode: state.builderMode,
      monitoring: {
        datasourceId: "",
        exposureQueryId: "",
        guardrailMetricIds: [],
        signalMetricIds: [],
        updateScheduleMinutes: null,
        noTrafficGracePeriodHours: null,
      },
      simpleDurationDays: state.simpleDurationDays,
      simpleDurationUnit: state.simpleDurationUnit,
    };
    const matchId = findMatchingTemplate(sectionState, templates);
    if (matchId) setSelectedTemplateId(matchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  function applyTemplate(t: RampScheduleTemplateInterface) {
    const steps = t.steps.map(reconstructUIStep);
    const totalSec = steps.reduce(
      (sum, s) =>
        sum +
        (s.triggerType === "interval"
          ? Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit]
          : 0),
      0,
    );
    const { value: dur, unit } = bestUnitFromSeconds(totalSec || 5 * 86400);
    const isSimple = stepsMatchSimplePattern(steps, { coverage: 100 });
    patch({
      steps: steps.map((s) => ({ ...s, monitored: true })),
      builderMode: isSimple ? "simple" : "advanced",
      simpleDurationDays: dur,
      simpleDurationUnit: unit,
    });
    setSelectedTemplateId(t.id);
  }

  function clearTemplate() {
    setSelectedTemplateId("");
    patch({
      steps: generateSimpleSteps(5, "days").map((s) => ({ ...s, monitored: true })),
      builderMode: "simple",
      simpleDurationDays: 5,
      simpleDurationUnit: "days",
    });
  }

  async function saveAsTemplate() {
    setSavingTemplate(true);
    try {
      const steps = buildExperimentSteps(state.steps, experiment.id);
      await apiCall("/ramp-schedule-templates", {
        method: "POST",
        body: JSON.stringify({ name: templateName, entityType: "experiment", steps }),
      });
      mutateTemplates();
      setSaveTemplateOpen(false);
      setTemplateName("");
    } finally {
      setSavingTemplate(false);
    }
  }

  async function submit() {
    if (scheduleType === "dates") {
      // Simple start/end schedule — save dates on the experiment, remove any ramp
      if (existingSchedule) {
        await apiCall(`/experiment/${experiment.id}/ramp-schedule`, {
          method: "DELETE",
        }).catch(() => {});
      }
      await apiCall(`/experiment/${experiment.id}`, {
        method: "POST",
        body: JSON.stringify({
          ...(state.startDate
            ? { statusUpdateSchedule: { startAt: state.startDate } }
            : { statusUpdateSchedule: null }),
          ...(state.endDate ? { endDate: state.endDate } : {}),
        }),
      });
    } else {
      const steps = buildExperimentSteps(state.steps, experiment.id);
      const endStrategy =
        state.endStrategyType !== "none"
          ? {
              type: state.endStrategyType,
              date: state.endStrategyDate || undefined,
              plannedVariationId:
                state.endStrategyType === "hard-planned" ? state.plannedVariationId : undefined,
            }
          : undefined;
      const body = {
        steps,
        startDate: state.startDate || null,
        cutoffDate: state.cutoffDate || null,
        pauseOnHealthSignal: state.pauseOnHealthSignal,
        endStrategy,
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

    // Patch decision criteria if it changed
    const currentDcId = experiment.decisionFrameworkSettings?.decisionCriteriaId ?? "";
    if (state.decisionCriteriaId !== currentDcId) {
      await apiCall(`/experiment/${experiment.id}`, {
        method: "POST",
        body: JSON.stringify({
          decisionFrameworkSettings: {
            ...experiment.decisionFrameworkSettings,
            decisionCriteriaId: state.decisionCriteriaId || undefined,
          },
        }),
      });
    }

    mutate();
  }

  const isSimpleMode = state.builderMode === "simple";
  const hasTemplate = !!selectedTemplateId;

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
    if (approvals > 0) parts.push(`${approvals} approval${approvals > 1 ? "s" : ""}`);
    return parts.join(" + ") || "0";
  }, [state.steps]);

  // ── Template dropdown ─────────────────────────────────────────────────────

  const presetTrigger = (
    <Link
      type="button"
      style={{
        color: selectedTemplateId ? "var(--color-text-high)" : "var(--color-text-low)",
      }}
    >
      <Flex align="center" gap="1">
        {selectedTemplateId ? (
          <>
            <HiBadgeCheck style={{ color: "var(--blue-11)" }} />
            <Text>
              {templates.find((t) => t.id === selectedTemplateId)?.name ?? "Template"}
            </Text>
          </>
        ) : (
          <Text>No template</Text>
        )}
        <PiCaretDownFill />
      </Flex>
    </Link>
  );

  const templateDropdown =
    templates.length > 0 && hasRampSchedulesFeature ? (
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
            onClick={clearTemplate}
          >
            None
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {[...templates]
            .sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0))
            .map((t) => (
              <DropdownMenuItem
                key={t.id}
                className={`multiline-item${t.id === selectedTemplateId ? " selected-item" : ""}`}
                onClick={() => applyTemplate(t)}
              >
                <Flex justify="between" align="center" gap="3" style={{ width: "100%" }}>
                  <Flex align="center" gap="1" style={{ flex: 1, minWidth: 0 }}>
                    {t.official && (
                      <HiBadgeCheck
                        style={{ color: "var(--blue-11)", fontSize: "1.2em", flexShrink: 0 }}
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
                  <Text size="small" color="text-low">
                    {formatRampStepSummary(t.steps)}
                  </Text>
                </Flex>
              </DropdownMenuItem>
            ))}
        </DropdownMenu>
        <Separator size="4" mt="5" />
      </Box>
    ) : null;

  // ── Save-template button ──────────────────────────────────────────────────

  const saveTemplateButton = hasRampSchedulesFeature ? (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={<PiBookmarkSimple />}
        onClick={() => setSaveTemplateOpen(true)}
      >
        Save as template
      </Button>
      {saveTemplateOpen && (
        <AlertDialog.Root open>
          <AlertDialog.Content maxWidth="380px">
            <AlertDialog.Title>Save as template</AlertDialog.Title>
            <Box mt="2">
              <Field
                label="Template name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Standard 2-week ramp"
              />
            </Box>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="ghost" onClick={() => setSaveTemplateOpen(false)}>
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button
                  color="violet"
                  disabled={!templateName.trim()}
                  loading={savingTemplate}
                  onClick={saveAsTemplate}
                >
                  Save
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      )}
    </>
  ) : null;

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
    return durationSummary ? `~${durationSummary}` : null;
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

  // ── EDF panel ─────────────────────────────────────────────────────────────

  const edfPanel = (
    <Box mb="4" px="5" pt="3" pb="4" className="bg-highlight rounded">
      <Flex align="center" gap="2" mb="3">
        <Text weight="semibold">Decision Criteria</Text>
        {isUsingOrgDefault ? (
          <Badge label="Org default" color="gray" size="sm" />
        ) : (
          <Badge label="Custom" color="violet" size="sm" />
        )}
      </Flex>

      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          <Box style={{ flex: 1 }}>
            <Select
              value={state.decisionCriteriaId || orgDefaultCriteria.id}
              setValue={(v) => patch({ decisionCriteriaId: v })}
              size="2"
            >
              {allCriteria.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <Text weight="semibold">{c.name}</Text>
                  {c.description ? (
                    <Text color="text-low">{`: ${c.description}`}</Text>
                  ) : null}
                </SelectItem>
              ))}
            </Select>
          </Box>
          {!isUsingOrgDefault && (
            <Tooltip body="Reset to org-default Decision Criteria">
              <Button
                variant="ghost"
                size="sm"
                icon={<PiArrowCounterClockwise />}
                onClick={() => patch({ decisionCriteriaId: orgDefaultCriteriaId })}
              >
                Reset
              </Button>
            </Tooltip>
          )}
        </Flex>

        <Text size="small" color="text-mid">
          This criteria governs when the ramp engine emits{" "}
          <strong>rollback-now</strong>, <strong>ship-now</strong>, and{" "}
          <strong>review-now</strong> signals. Thresholds are configured in
          Organisation Settings → Decision Framework.
        </Text>
      </Flex>
    </Box>
  );

  // ── Health signal pause toggle ────────────────────────────────────────────

  const healthSignalToggle = (
    <Flex align="start" gap="3" mb="4">
      <Switch
        value={state.pauseOnHealthSignal}
        onChange={(v) => patch({ pauseOnHealthSignal: v })}
        id="pause-on-health-signal"
      />
      <Box>
        <Text as="label" htmlFor="pause-on-health-signal" weight="medium">
          Pause ramp on health signal
        </Text>
        <Text as="div" size="small" color="text-low" mt="1">
          Hold step advancement when SRM, multiple exposures, or no-traffic is
          detected. When off, health issues surface as warnings only and the ramp
          continues. EDF-driven decisions (rollback-now, ship-now, review-now) are
          configured separately via Decision Criteria.
        </Text>
      </Box>
    </Flex>
  );

  // ── End strategy ──────────────────────────────────────────────────────────

  const endStrategyPanel = (
    <Box mb="4">
      <Text weight="medium" mb="2">
        On ramp completion
      </Text>
      <SelectField
        value={state.endStrategyType}
        options={[
          { value: "none", label: "No automatic action" },
          { value: "soft", label: "Remind me to end the experiment" },
          { value: "soft-edf", label: "Auto-rollout if EDF has a clear winner, otherwise prompt" },
          { value: "hard-planned", label: "Force-ship a specific variation on the cutoff date" },
        ]}
        onChange={(v) =>
          patch({ endStrategyType: v as ExperimentRampState["endStrategyType"] })
        }
        helpText={
          state.endStrategyType === "soft-edf"
            ? "Uses the Decision Criteria configured above to determine the winner."
            : undefined
        }
      />
      {state.endStrategyType === "hard-planned" && (
        <Box mt="3">
          <SelectField
            label="Planned release variation"
            helpText="This variation will be force-shipped on the cutoff date."
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
  );

  // ── Page 1 ─────────────────────────────────────────────────────────────────

  // Date rows mirroring ScheduleInputs.tsx conventions
  const dateScheduleRows = (
    <Flex direction="column" gap="1" mt="4" ml="5">
      {/* Start row */}
      <Flex align="center" gap="3" py="2" style={{ minHeight: 54 }}>
        <Box style={{ width: 70 }}>
          <Text as="label" weight="medium">
            Start
          </Text>
        </Box>
        <SelectField
          value={state.startDate ? "specific-time" : "immediately"}
          options={[
            { value: "immediately", label: "Immediately" },
            { value: "specific-time", label: "On date" },
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
          containerClassName="mb-0"
          containerStyle={{ minHeight: 38, width: 150 }}
        />
        {state.startDate && (
          <DatePicker
            date={state.startDate || undefined}
            setDate={(d) => patch({ startDate: d ? d.toISOString() : "" })}
            precision="datetime"
            containerClassName="mb-0"
            scheduleEndDate={state.endDate || undefined}
          />
        )}
      </Flex>

      {/* End row */}
      <Flex align="center" gap="3" py="2" style={{ minHeight: 54 }}>
        <Box style={{ width: 70 }}>
          <Text as="label" weight="medium">
            End
          </Text>
        </Box>
        <SelectField
          value={state.endDate ? "specific-time" : "never"}
          options={[
            { value: "never", label: "Manual end" },
            { value: "specific-time", label: "On date" },
          ]}
          onChange={(v) => {
            if (v === "never") {
              patch({ endDate: "" });
            } else {
              const d = new Date();
              d.setSeconds(0, 0);
              patch({ endDate: d.toISOString() });
            }
          }}
          containerClassName="mb-0"
          containerStyle={{ minHeight: 38, width: 150 }}
        />
        {state.endDate && (
          <DatePicker
            date={state.endDate || undefined}
            setDate={(d) => patch({ endDate: d ? d.toISOString() : "" })}
            precision="datetime"
            containerClassName="mb-0"
            scheduleStartDate={state.startDate || undefined}
            disableBefore={
              state.startDate ? new Date(state.startDate) : new Date()
            }
          />
        )}
      </Flex>
    </Flex>
  );

  const page1 = (
    <Page display="Schedule Type">
      <Box mt="4" style={{ minHeight: 200 }}>
        <RadioGroup
          value={scheduleType}
          setValue={(v) => setScheduleType(v as ExperimentScheduleType)}
          gap="3"
          options={[
            {
              value: "dates",
              label: "Start and end dates",
              description:
                "Schedule when the experiment goes live and when it ends — no gradual rollout.",
            },
            {
              value: "ramp",
              label: "Ramp-up schedule",
              description:
                "Gradually increase coverage over time with guardrail monitoring, EDF-driven early stopping, and a configurable end strategy.",
              disabled: !hasRampSchedulesFeature,
              disabledReason: "Requires the ramp schedules commercial feature",
            },
          ]}
        />

        {scheduleType === "dates" && dateScheduleRows}
      </Box>
    </Page>
  );

  // ── Page 2 ─────────────────────────────────────────────────────────────────

  const page2 = (
    <Page display="Ramp-up Schedule">
      <Box mt="4" style={{ minHeight: 200 }}>
        {/* Template */}
        {hasRampSchedulesFeature && (
          <>
            <Text as="div" weight="semibold" mb="1">
              Template
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
          </>
        )}
        {templateDropdown}

        {/* Start + End date rows */}
        <Flex direction="column" gap="1" mb="4">
          {/* Start row */}
          <Flex align="center" gap="3" py="2" style={{ minHeight: 54 }}>
            <Box style={{ width: 70 }}>
              <Text as="label" weight="medium">
                Start
              </Text>
            </Box>
            <SelectField
              value={state.startDate ? "specific-time" : "immediately"}
              options={[
                { value: "immediately", label: "Immediately" },
                { value: "specific-time", label: "On date" },
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
              containerClassName="mb-0"
              containerStyle={{ minHeight: 38, width: 150 }}
            />
            {state.startDate && (
              <DatePicker
                date={state.startDate || undefined}
                setDate={(d) => patch({ startDate: d ? d.toISOString() : "" })}
                precision="datetime"
                containerClassName="mb-0"
                scheduleEndDate={state.cutoffDate || undefined}
              />
            )}
          </Flex>

          {/* End row */}
          <Flex align="center" gap="3" py="2" style={{ minHeight: 54 }}>
            <Box style={{ width: 70 }}>
              <Text as="label" weight="medium">
                End
              </Text>
            </Box>
            <SelectField
              value={state.cutoffDate ? "specific-time" : "never"}
              options={[
                { value: "never", label: "No end" },
                { value: "specific-time", label: "On date" },
              ]}
              onChange={(v) => {
                if (v === "never") {
                  handleEndDateChange("");
                } else {
                  const d = new Date();
                  d.setDate(d.getDate() + Math.round(state.simpleDurationDays) || 14);
                  d.setSeconds(0, 0);
                  handleEndDateChange(d.toISOString());
                }
              }}
              containerClassName="mb-0"
              containerStyle={{ minHeight: 38, width: 150 }}
            />
            {state.cutoffDate && (
              <>
                <DatePicker
                  date={state.cutoffDate || undefined}
                  setDate={(d) => handleEndDateChange(d ? d.toISOString() : "")}
                  precision="datetime"
                  containerClassName="mb-0"
                  scheduleStartDate={state.startDate || undefined}
                  disableBefore={
                    state.startDate ? new Date(state.startDate) : new Date()
                  }
                />
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="2"
                  radius="full"
                  onClick={() => handleEndDateChange("")}
                >
                  <PiXBold />
                </IconButton>
              </>
            )}
            {durationLabel && (
              <Text size="small" color="text-low">
                {durationLabel}
              </Text>
            )}
          </Flex>
        </Flex>

        <Separator size="4" mb="4" />

        {edfPanel}
        {healthSignalToggle}
        {endStrategyPanel}

        <Separator size="4" mb="4" />

        {/* Ramp-up Steps — bottom of page */}
        {isSimpleMode && !hasTemplate ? (
          /* Simple mode: "Edit Ramp-up Steps" button left, coverage progression right */
          <Box mb="4">
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
          /* Advanced / template mode: "Simple View" button above grid */
          <Box mb="4">
            {!hasTemplate && (
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
            )}
            <Box className="appbox px-3 pt-3 pb-2 bg-light">
              {renderStepGrid()}
            </Box>
          </Box>
        )}
      </Box>
    </Page>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasRampPage = scheduleType === "ramp";

  return (
    <PagedModal
      trackingEventModalType="experiment-ramp-schedule-modal"
      close={close}
      size="lg"
      header="Schedule Settings"
      cta={
        hasRampPage && step === 0 ? (
          <>
            Next: Ramp-up{" "}
            <PiCaretRight className="position-relative" style={{ top: -1 }} />
          </>
        ) : (
          "Save"
        )
      }
      forceCtaText={hasRampPage && step === 0}
      ctaEnabled={scheduleType !== "ramp" || hasRampSchedulesFeature}
      step={step}
      setStep={setStep}
      backButton
      hideNav
      submit={submit}
      useRadixButton
    >
      {page1}
      {hasRampPage && page2}
    </PagedModal>
  );
}
