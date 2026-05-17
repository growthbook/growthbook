import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import pick from "lodash/pick";
import {
  AlertDialog,
  Box,
  Flex,
  Separator,
  IconButton,
} from "@radix-ui/themes";
import {
  PiPlusBold,
  PiInfo,
  PiCaretDownBold,
  PiCaretDownFill,
  PiCaretRightFill,
  PiBookmarkSimple,
  PiCalendarBlank,
  PiArrowCounterClockwise,
  PiTrash,
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
  type StepHoldConditions,
} from "shared/validators";
import { date as formatDate } from "shared/dates";
import { BsThreeDotsVertical } from "react-icons/bs";
import { HiBadgeCheck } from "react-icons/hi";
import {
  getRampBadgeColor,
  getRampStatusLabel,
  getRampStepsCompleted,
  formatScheduledDate,
} from "@/components/RampSchedule/RampTimeline";
import Badge from "@/ui/Badge";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import Switch from "@/ui/Switch";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import ConditionInput from "@/components/Features/ConditionInput";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import RuleEnvironmentScopeField from "@/components/Features/RuleModal/EnvironmentScopeField";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import MonitoredIcon from "@/components/Features/RuleModal/MonitoredIcon";
import FeatureValueField from "@/components/Features/FeatureValueField";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { formatRemainingDuration } from "@/components/Features/Rule";
import { Popover } from "@/ui/Popover";
import { getExposureQuery } from "@/services/datasources";
import styles from "./RampScheduleSection.module.scss";

export type IntervalUnit = "minutes" | "hours" | "days";

export type StepField =
  | "coverage"
  | "condition"
  | "savedGroups"
  | "prerequisites"
  | "allEnvironments"
  | "environments"
  | "force";

export const STEP_FIELD_LABELS: Record<StepField, string> = {
  coverage: "Rollout %",
  condition: "Attribute targeting",
  savedGroups: "Saved groups",
  prerequisites: "Prerequisites",
  allEnvironments: "Environments",
  environments: "Environment list",
  force: "Feature value",
};

// coverage is 0–100 in the UI, converted to 0–1 in payloads.
export type UIStepPatch = {
  coverage?: number;
  // `null` is a UI sentinel meaning "explicitly clear this targeting".
  condition?: string | null;
  // `null` is a UI sentinel meaning "explicitly clear this targeting".
  savedGroups?: SavedGroupTargeting[] | null;
  // `null` is a UI sentinel meaning "explicitly clear this targeting".
  prerequisites?: FeaturePrerequisite[] | null;
  allEnvironments?: boolean;
  environments?: string[];
  force?: string;
};

export type UIStep = {
  patch: UIStepPatch;
  triggerType: "interval" | "approval";
  intervalValue: number;
  intervalUnit: IntervalUnit;
  approvalNotes: string;
  // UI-only expansion state.
  notesOpen: boolean;
  additionalEffectsOpen: boolean;
  monitored: boolean;
  holdConditions?: StepHoldConditions;
};

export type RampMode = "off" | "create" | "edit" | "link";

export type RampBuilderMode = "simple" | "advanced";

export interface RampMonitoringState {
  datasourceId: string;
  exposureQueryId: string;
  guardrailMetricIds: string[];
  signalMetricIds: string[];
  updateScheduleMinutes: number | null;
  srmAction?: "warn" | "hold" | "rollback";
  noTrafficAction?: "warn" | "hold" | "rollback";
  multipleExposureAction?: "warn" | "hold" | "rollback";
}

export interface RampSectionState {
  mode: RampMode;
  name: string;
  // ISO datetime string. Empty means start immediately.
  startDate: string;
  steps: UIStep[];
  // Empty means no end date.
  endScheduleAt: string;
  endPatch: UIStepPatch;
  linkedRampId: string;
  endAdditionalEffectsOpen: boolean;

  cutoffDate: string;

  lockFeature: boolean;

  builderMode: RampBuilderMode;
  monitoring: RampMonitoringState;
  simpleDurationDays: number;
  simpleDurationUnit?: IntervalUnit;
}

const DEFAULT_MONITORING: RampMonitoringState = {
  datasourceId: "",
  exposureQueryId: "",
  guardrailMetricIds: [],
  signalMetricIds: [],
  updateScheduleMinutes: null,
};

const UNIT_MULT: Record<IntervalUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

const SIMPLE_COVERAGES = [1, 5, 10, 25, 50];

export function generateSimpleSteps(
  duration: number,
  unit: IntervalUnit = "days",
): UIStep[] {
  const intervalValue = Math.max(
    1,
    Math.round(duration / SIMPLE_COVERAGES.length),
  );

  return SIMPLE_COVERAGES.map((cov) => ({
    patch: { coverage: cov },
    triggerType: "interval" as const,
    intervalValue,
    intervalUnit: unit,
    approvalNotes: "",
    notesOpen: false,
    additionalEffectsOpen: false,
    monitored: false,
  }));
}

export function stepsMatchSimplePattern(
  steps: UIStep[],
  endPatch?: UIStepPatch,
): boolean {
  // Any non-coverage rule patch means this is advanced mode.
  const hasStepRuleEffects = steps.some((s) =>
    VALID_STEP_FIELDS.some((f) => s.patch[f] !== undefined),
  );
  if (hasStepRuleEffects) return false;
  // End actions beyond default coverage also imply advanced mode.
  if (
    endPatch &&
    (VALID_STEP_FIELDS.some((f) => endPatch[f] !== undefined) ||
      (endPatch.coverage !== undefined && endPatch.coverage !== 100))
  ) {
    return false;
  }
  if (steps.length !== SIMPLE_COVERAGES.length) return false;
  const firstStep = steps[0];
  if (!firstStep) return false;
  const expectedSimpleSteps = generateSimpleSteps(
    firstStep.intervalValue * SIMPLE_COVERAGES.length,
    firstStep.intervalUnit,
  ).map((s) => ({
    ...s,
    monitored: firstStep.monitored,
    holdConditions: firstStep.holdConditions,
  }));
  const normalizeSimpleStep = (s: UIStep) => ({
    triggerType: s.triggerType,
    intervalValue: s.intervalValue,
    intervalUnit: s.intervalUnit,
    coverage: s.patch.coverage ?? 0,
    monitored: !!s.monitored,
    holdConditions: s.holdConditions ?? undefined,
  });
  if (
    !isEqual(
      steps.map(normalizeSimpleStep),
      expectedSimpleSteps.map(normalizeSimpleStep),
    )
  ) {
    return false;
  }
  // Ensure hold-conditions are consistent if present.
  const hcRef = JSON.stringify(firstStep.holdConditions ?? null);
  if (!steps.every((s) => JSON.stringify(s.holdConditions ?? null) === hcRef)) {
    return false;
  }
  return true;
}

export const VALID_STEP_FIELDS: StepField[] = [
  "savedGroups",
  "condition",
  "prerequisites",
  "allEnvironments",
  "environments",
  "force",
];

// Sentinel values used when opting a field into a step for the first time.
export const FIELD_DEFAULTS: Partial<UIStepPatch> = {
  condition: "{}",
  savedGroups: [],
  prerequisites: [],
  allEnvironments: true,
  environments: [],
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

export function getMonitoringValidationError(
  state: RampSectionState,
): string | null {
  const hasMonitoredSteps = state.steps.some((s) => s.monitored);
  if (!hasMonitoredSteps) return null;
  const m = state.monitoring;
  if (!m.datasourceId) return "Select a data source for monitoring";
  if (!m.exposureQueryId) return "Select an assignment table for monitoring";
  if (m.guardrailMetricIds.length === 0 && m.signalMetricIds.length === 0)
    return "Add at least one guardrail or signal metric for monitoring";
  const zeroTrafficStep = state.steps.find(
    (s) => s.monitored && (s.patch.coverage ?? 0) === 0,
  );
  if (zeroTrafficStep)
    return "Monitored steps must have traffic greater than 0%";
  return null;
}

export function isRampSectionConfigured(state: RampSectionState): boolean {
  return (
    state.mode !== "create" ||
    state.steps.length > 0 ||
    !!state.startDate ||
    !!state.endScheduleAt ||
    !!state.cutoffDate
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

const COL = {
  num: 30, // "1" / "2" / "start" / "end"
  trigger: 130, // trigger type select
  duration: 200, // trigger details (interval inputs, datetime, "Awaiting approval")
  coverage: 80, // [number] %
} as const;

function isEmptyConditionValue(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "{}";
}

export function buildPatch(
  patch: UIStepPatch,
  ruleId: string,
  monitored?: boolean,
): RampStepAction["patch"] {
  const out: RampStepAction["patch"] = { ruleId };

  if (patch.coverage !== undefined)
    out.coverage = monitored
      ? (patch.coverage * 2) / 100
      : patch.coverage / 100;
  if (patch.condition !== undefined) {
    // `null` sentinel means "clear targeting" explicitly.
    if (patch.condition === null) {
      out.condition = "{}";
    } else if (!isEmptyConditionValue(patch.condition)) {
      out.condition = patch.condition;
    }
  }
  if (patch.savedGroups !== undefined) {
    // `null` sentinel means "clear targeting" explicitly.
    if (patch.savedGroups === null) {
      out.savedGroups = [];
    } else if (patch.savedGroups.length > 0) {
      out.savedGroups = patch.savedGroups;
    }
  }
  if (patch.prerequisites !== undefined) {
    // `null` sentinel means "clear targeting" explicitly.
    if (patch.prerequisites === null) {
      out.prerequisites = [];
    } else if (patch.prerequisites.length > 0) {
      out.prerequisites = patch.prerequisites;
    }
  }
  if (patch.allEnvironments !== undefined || patch.environments !== undefined) {
    const allEnvironments = patch.allEnvironments ?? false;
    out.allEnvironments = allEnvironments;
    out.environments = allEnvironments ? undefined : (patch.environments ?? []);
  }
  if (patch.force !== undefined) {
    try {
      out.force = JSON.parse(patch.force);
    } catch {
      out.force = patch.force;
    }
  }
  return out;
}

export function buildEndActions(
  endPatch: UIStepPatch,
  ruleId: string,
): RampStepAction[] {
  const patch = buildPatch(endPatch, ruleId);
  const isEmpty = Object.keys(patch).length <= 1; // only ruleId
  if (isEmpty) return [];
  return [
    {
      targetType: "feature-rule" as const,
      targetId: "t1",
      patch,
    },
  ];
}

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

export function buildMonitoringConfig(
  monitoring: RampMonitoringState,
  steps?: UIStep[],
):
  | {
      datasourceId: string;
      exposureQueryId: string;
      guardrailMetricIds: string[];
      signalMetricIds?: string[];
      updateScheduleMinutes?: number | null;
      srmAction?: "warn" | "hold" | "rollback";
      noTrafficAction?: "warn" | "hold" | "rollback";
      multipleExposureAction?: "warn" | "hold" | "rollback";
    }
  | undefined {
  if (steps && !steps.some((s) => s.monitored)) return undefined;
  if (
    !monitoring.datasourceId ||
    !monitoring.exposureQueryId ||
    (monitoring.guardrailMetricIds.length === 0 &&
      monitoring.signalMetricIds.length === 0)
  ) {
    return undefined;
  }
  return {
    datasourceId: monitoring.datasourceId,
    exposureQueryId: monitoring.exposureQueryId,
    guardrailMetricIds: monitoring.guardrailMetricIds,
    signalMetricIds:
      monitoring.signalMetricIds.length > 0
        ? monitoring.signalMetricIds
        : undefined,
    updateScheduleMinutes: monitoring.updateScheduleMinutes ?? undefined,
    srmAction: monitoring.srmAction,
    noTrafficAction: monitoring.noTrafficAction,
    multipleExposureAction: monitoring.multipleExposureAction,
  };
}

export function buildRampSteps(
  steps: UIStep[],
  targetId: string,
  ruleId: string,
) {
  return steps.map((s) => {
    const patch = buildPatch(s.patch, ruleId, s.monitored);
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
      monitored: !!s.monitored,
      ...(s.monitored && s.holdConditions
        ? { holdConditions: s.holdConditions }
        : {}),
    };
  });
}

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

function normalizeStructural(p: Record<string, unknown>) {
  // Templates only compare intermediate steps, endPatch, and monitoring config.
  type StepShape = {
    actions: { patch: Record<string, unknown>; [k: string]: unknown }[];
  };
  const steps = ((p.steps as StepShape[]) ?? []).map((s) => ({
    ...s,
    actions: normalizeActions(s.actions) ?? [],
  }));
  const endPatch = p.endPatch ?? null;
  const monitoringConfig = p.monitoringConfig ?? null;
  return JSON.stringify({
    steps,
    endPatch,
    monitoringConfig,
  });
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

export function activeFieldsFromState(state: RampSectionState): Set<StepField> {
  // Coverage is always controlled; other fields are inferred from patches.
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

function formatReadonlyAction(step: UIStep): string {
  if (step.triggerType === "approval") return "Approval";
  const value = Math.max(1, step.intervalValue);
  const unit =
    value === 1 ? step.intervalUnit.replace(/s$/, "") : step.intervalUnit;
  return `Hold ${value} ${unit}`;
}

function formatReadonlyCoverage(step: UIStep): string {
  if (step.patch.coverage === undefined) return "—";
  return `${step.patch.coverage}%`;
}

function ReadOnlyEffectRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const isPlainText =
    typeof children === "string" || typeof children === "number";
  return (
    <Flex direction="column" gap="1">
      <Text as="div" size="small" weight="medium" color="text-mid">
        {label}
      </Text>
      <Box style={{ minWidth: 0 }}>
        {isPlainText ? <Text size="small">{children}</Text> : children}
      </Box>
    </Flex>
  );
}

function ReadOnlySettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const isPlainText =
    typeof children === "string" || typeof children === "number";
  return (
    <Flex align="start" gap="3" py="1">
      <Box style={{ width: 120, flexShrink: 0 }}>
        <Text size="small" weight="medium" color="text-mid">
          {label}
        </Text>
      </Box>
      <Box style={{ minWidth: 0, flex: 1 }}>
        {isPlainText ? <Text size="small">{children}</Text> : children}
      </Box>
    </Flex>
  );
}

function formatReadonlyDurationFromSchedule(rs: RampScheduleInterface): string {
  let totalSeconds = 0;
  let approvals = 0;
  let hasMonitored = false;
  for (const step of rs.steps) {
    if (step.trigger.type === "interval") {
      totalSeconds += step.trigger.seconds;
    } else {
      approvals++;
    }
    if (step.monitored) hasMonitored = true;
  }
  const parts: string[] = [];
  if (totalSeconds > 0) parts.push(formatRemainingDuration(totalSeconds));
  if (approvals > 0) {
    parts.push(`${approvals} approval step${approvals > 1 ? "s" : ""}`);
  }
  if (hasMonitored) parts.push("monitored steps");
  return parts.join(" + ") || "0";
}

function formatUserUnitLabel(userIdType?: string): string | null {
  if (!userIdType) return null;
  if (userIdType === "anonymous_id") return "Anonymous users";
  if (userIdType === "user_id") return "Logged-in users";
  const words = userIdType
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  return `${words} users`;
}

function MinSampleDialog({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue?: number;
  onSave: (value: number | undefined) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(
    initialValue != null ? String(initialValue) : "",
  );

  const save = () => {
    const val = parseInt(draft);
    onSave(val && val > 0 ? val : undefined);
  };

  return (
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
            containerClassName="mb-0"
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
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

interface Props {
  ruleRampSchedule: RampScheduleInterface | undefined;
  state: RampSectionState;
  setState: (s: RampSectionState) => void;
  // Embedded mode omits the outer heading/switch wrapper.
  embedded?: boolean;
  // Renders the schedule grid in view-only mode.
  readOnly?: boolean;
  feature: FeatureInterface;
  environments: string[];
  // Used by the standalone modal.
  boxStepGrid?: boolean;
  // Name is still stored, but not editable in standalone modal contexts.
  hideNameField?: boolean;
  // Hide template creation while already editing a template.
  hideTemplateSave?: boolean;
  // Shows pending removal before the draft is saved.
  pendingDetach?: boolean;
}

export default function RampScheduleSection({
  ruleRampSchedule,
  state,
  setState,
  embedded = false,
  readOnly = false,
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
  const [minSamplePopoverIndex, setMinSamplePopoverIndex] = useState<
    number | null
  >(null);
  const skipNextEnvSelectionUpdateRef = useRef(false);

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
  const { datasources, getDatasourceById, getExperimentMetricById } =
    useDefinitions();
  const settings = useOrgSettings();

  const selectedDatasource = useMemo(
    () => getDatasourceById(state.monitoring.datasourceId) ?? undefined,
    [getDatasourceById, state.monitoring.datasourceId],
  );

  const exposureQueries = useMemo(
    () => selectedDatasource?.settings?.queries?.exposure ?? [],
    [selectedDatasource],
  );
  const { data: templatesData, mutate: mutateTemplates } = useApi<{
    rampScheduleTemplates: RampScheduleTemplateInterface[];
  }>("/ramp-schedule-templates");
  const templates = templatesData?.rampScheduleTemplates ?? [];

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [presetOpen, setPresetOpen] = useState(false);
  const hasAutoSelected = useRef(false);

  // On first template load, match the existing state or apply the first default.
  useEffect(() => {
    if (hasAutoSelected.current || templates.length === 0) return;
    hasAutoSelected.current = true;
    const matchId = findMatchingTemplate(state, templates);
    if (matchId) {
      setSelectedTemplateId(matchId);
      return;
    }
    if (!ruleRampSchedule && !hideTemplateSave && selectedTemplateId) {
      const first = [...templates].sort(
        (a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0),
      )[0];
      if (first) applyTemplate(first);
    }
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

  const activeFields = useMemo<Set<StepField>>(
    () => activeFieldsFromState(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.steps, state.endPatch],
  );

  const startPatchBaseline = useMemo(() => {
    const startAction = ruleRampSchedule?.startActions?.find(
      (a) => a.targetType === "feature-rule",
    );
    return reconstructUIPatch(
      startAction?.patch as FeatureRulePatch | undefined,
    );
  }, [ruleRampSchedule?.startActions]);

  const getDefaultFieldValueForNewEffect = (
    field: StepField,
    currentStepIndex: number | "end",
  ): unknown => {
    const lookupEnvPatch = (patch?: UIStepPatch): UIStepPatch | null => {
      if (!patch) return null;
      if (
        patch.allEnvironments === undefined &&
        patch.environments === undefined
      )
        return null;
      return {
        allEnvironments: patch.allEnvironments ?? false,
        environments: patch.environments ?? [],
      };
    };

    const lookupField = (patch?: UIStepPatch): unknown => {
      if (field === "allEnvironments" || field === "environments") {
        return lookupEnvPatch(patch);
      }
      return patch?.[field];
    };

    const startIndex =
      currentStepIndex === "end"
        ? state.steps.length - 1
        : currentStepIndex - 1;
    for (let i = startIndex; i >= 0; i--) {
      const found = lookupField(state.steps[i]?.patch);
      if (found !== undefined && found !== null) {
        return cloneDeep(found);
      }
    }

    const baseline = lookupField(startPatchBaseline);
    if (baseline !== undefined && baseline !== null) {
      return cloneDeep(baseline);
    }

    return cloneDeep(FIELD_DEFAULTS[field]);
  };

  function updateStep(i: number, update: Partial<UIStep>) {
    const newSteps = state.steps.map((s, idx) =>
      idx === i ? { ...s, ...update } : s,
    );
    patchState({ steps: newSteps });
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

  function nearestIntervalBefore(
    beforeIndex: number,
  ): Pick<UIStep, "intervalValue" | "intervalUnit"> {
    // New steps inherit the nearest prior interval duration.
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
    const isMonitored = prev?.monitored ?? false;
    const maxCov = isMonitored ? 50 : 100;
    const newStep: UIStep = {
      patch: {
        coverage:
          prevCoverage !== undefined
            ? Math.min(maxCov, prevCoverage + 10)
            : Math.min(maxCov, 10),
      },
      triggerType: prev?.triggerType ?? "interval",
      ...interval,
      approvalNotes: "",
      notesOpen: false,
      additionalEffectsOpen: false,
      monitored: isMonitored,
    };
    const steps = [...state.steps];
    steps.splice(insertAt, 0, newStep);
    patchState({ steps });
  }

  function addStep() {
    const last = state.steps[state.steps.length - 1];
    const isMonitored = last?.monitored ?? false;
    const maxCov = isMonitored ? 50 : 100;
    const newPatch: UIStepPatch = {
      coverage:
        last?.patch.coverage !== undefined
          ? Math.min(maxCov, last.patch.coverage + 10)
          : Math.min(maxCov, 10),
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
          monitored: isMonitored,
        },
      ],
    });
  }

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

  const canEdit =
    !ruleRampSchedule ||
    !["running", "pending-approval", "conflict"].includes(
      ruleRampSchedule.status,
    );
  const isReadOnlyView = readOnly || (state.mode !== "create" && !canEdit);

  function renderStepGrid() {
    const subRowIndent = COL.num + 16;
    const readOnlySteps = isReadOnlyView
      ? (ruleRampSchedule?.steps ?? []).map(reconstructUIStep)
      : [];
    const stepsForDisplay = isReadOnlyView ? readOnlySteps : state.steps;
    const currentReadOnlyStepIndex = isReadOnlyView
      ? (ruleRampSchedule?.currentStepIndex ?? -1)
      : -1;

    const getReadOnlyStepMarker = (stepIndex: number) => {
      if (!isReadOnlyView || !ruleRampSchedule) return null;
      if (stepIndex !== currentReadOnlyStepIndex) return null;

      switch (ruleRampSchedule.status) {
        case "running":
          return {
            borderColor: "var(--green-9)",
            textColor: "var(--green-11)",
            tooltip: "Live step: ramp is currently running at this step.",
          };
        case "paused":
          return {
            borderColor: "var(--amber-9)",
            textColor: "var(--amber-11)",
            tooltip: "Paused step: ramp is paused on this step.",
          };
        case "pending-approval":
          return {
            borderColor: "var(--yellow-9)",
            textColor: "var(--yellow-11)",
            tooltip:
              "Pending approval: ramp is waiting for manual approval on this step.",
          };
        case "ready":
        case "pending":
          return {
            borderColor: "var(--blue-9)",
            textColor: "var(--blue-11)",
            tooltip:
              "Pending start: this is the next step once the ramp starts.",
          };
        default:
          return {
            borderColor: "var(--gray-8)",
            textColor: "var(--gray-11)",
            tooltip: `Current step pointer (${ruleRampSchedule.status}).`,
          };
      }
    };
    const ruleEffectItems: { field: StepField; label: string }[] = [
      { field: "savedGroups", label: "Saved group targeting" },
      { field: "condition", label: "Attribute targeting" },
      { field: "prerequisites", label: "Prerequisite targeting" },
      { field: "force", label: "Default value" },
      { field: "allEnvironments", label: "Environments" },
    ];
    const hasRuleEffectField = (patch: UIStepPatch, field: StepField) => {
      if (field === "allEnvironments" || field === "environments") {
        return "allEnvironments" in patch || "environments" in patch;
      }
      return field in patch;
    };
    const getAvailableRuleEffects = (patch: UIStepPatch) =>
      ruleEffectItems
        .filter((item) => !(hideTemplateSave && item.field === "force"))
        .filter((item) => !hasRuleEffectField(patch, item.field));
    const hasSelectedRuleEffects = (patch: UIStepPatch) =>
      ruleEffectItems
        .filter((item) => !(hideTemplateSave && item.field === "force"))
        .some((item) => hasRuleEffectField(patch, item.field));

    const renderRuleEffectsMenuGroup = (
      patch: UIStepPatch,
      onSelectField: (field: StepField) => void,
    ) => {
      const availableRuleEffects = getAvailableRuleEffects(patch);
      if (!availableRuleEffects.length) return null;
      return (
        <DropdownMenuGroup label="Rule modifications">
          {availableRuleEffects.map((item) => (
            <DropdownMenuItem
              key={item.field}
              onClick={() => onSelectField(item.field)}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      );
    };

    function renderPatchSubRows(
      patch: UIStepPatch,
      setPatchFn: (field: StepField, value: unknown) => void,
      removePatchFieldFn: (field: StepField) => void,
      setPatchObjectFn: (patch: UIStepPatch) => void,
      currentStepIndex: number | "start" | "end",
      open: boolean,
    ) {
      if (!open) return null;

      const removeEffectButton = (onClick: () => void) => (
        <Tooltip body="Remove effect" tipMinWidth="50px">
          <IconButton
            variant="ghost"
            color="red"
            size="2"
            radius="full"
            onClick={onClick}
          >
            <PiTrash />
          </IconButton>
        </Tooltip>
      );

      const effectRows: ReactNode[] = [];

      if ("savedGroups" in patch) {
        effectRows.push(
          <Box>
            <SavedGroupTargetingField
              value={patch.savedGroups ?? []}
              setValue={(v) => setPatchFn("savedGroups", v)}
              project={feature.project ?? ""}
              slimMode
              addRemoveMode
              addRemoveValue={patch.savedGroups === null ? "remove" : "set"}
              onAddRemoveValueChange={(mode) =>
                setPatchFn("savedGroups", mode === "remove" ? null : [])
              }
              onRemoveEffect={() => removePatchFieldFn("savedGroups")}
              setModeLabel="Set saved group targeting"
              removeModeLabel="Remove saved group targeting"
              labelActions={removeEffectButton(() =>
                removePatchFieldFn("savedGroups"),
              )}
            />
          </Box>,
        );
      }

      if ("condition" in patch) {
        effectRows.push(
          <Box>
            <ConditionInput
              key={`${currentStepIndex}-condition`}
              defaultValue={patch.condition ?? "{}"}
              onChange={(v) => setPatchFn("condition", v)}
              project={feature.project ?? ""}
              slimMode
              emptyText=""
              addRemoveMode
              addRemoveValue={patch.condition === null ? "remove" : "set"}
              onAddRemoveValueChange={(mode) =>
                setPatchFn("condition", mode === "remove" ? null : "{}")
              }
              onRemoveEffect={() => removePatchFieldFn("condition")}
              setModeLabel="Set attribute targeting"
              removeModeLabel="Remove attribute targeting"
              labelActions={removeEffectButton(() =>
                removePatchFieldFn("condition"),
              )}
            />
          </Box>,
        );
      }

      if ("prerequisites" in patch) {
        effectRows.push(
          <Box>
            <PrerequisiteInput
              value={patch.prerequisites ?? []}
              setValue={(v) => setPatchFn("prerequisites", v)}
              feature={feature}
              environments={environments}
              setPrerequisiteTargetingSdkIssues={() => {}}
              slimMode
              addRemoveMode
              addRemoveValue={patch.prerequisites === null ? "remove" : "set"}
              onAddRemoveValueChange={(mode) =>
                setPatchFn("prerequisites", mode === "remove" ? null : [])
              }
              onRemoveEffect={() => removePatchFieldFn("prerequisites")}
              setModeLabel="Set prerequisite targeting"
              removeModeLabel="Remove prerequisite targeting"
              labelActions={removeEffectButton(() =>
                removePatchFieldFn("prerequisites"),
              )}
            />
          </Box>,
        );
      }

      if ("force" in patch && !hideTemplateSave) {
        effectRows.push(
          <Box>
            <Flex align="center" justify="between" mb="1">
              <Text as="div" weight="semibold">
                Default value
              </Text>
              {removeEffectButton(() => removePatchFieldFn("force"))}
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
          </Box>,
        );
      }

      if ("allEnvironments" in patch || "environments" in patch) {
        effectRows.push(
          <Box>
            <Flex align="center" justify="between" mb="1">
              <Text as="div" weight="semibold">
                Rule environments
              </Text>
              {removeEffectButton(() => {
                const nextPatch = { ...patch };
                delete nextPatch.allEnvironments;
                delete nextPatch.environments;
                setPatchObjectFn(nextPatch);
              })}
            </Flex>
            <RuleEnvironmentScopeField
              environments={environments.map((id) => ({ id, description: "" }))}
              allEnvironments={patch.allEnvironments ?? false}
              setAllEnvironments={(v) => {
                if (v) skipNextEnvSelectionUpdateRef.current = true;
                setPatchObjectFn({
                  ...patch,
                  allEnvironments: v,
                  environments: v ? [] : (patch.environments ?? []),
                });
              }}
              selectedEnvironments={patch.environments ?? []}
              setSelectedEnvironments={(v) => {
                if (skipNextEnvSelectionUpdateRef.current) {
                  skipNextEnvSelectionUpdateRef.current = false;
                  return;
                }
                setPatchFn("environments", v);
              }}
              label=""
            />
          </Box>,
        );
      }

      if (!effectRows.length) return null;

      return (
        <Box mt="2" pr="2" style={{ paddingLeft: subRowIndent }}>
          <Flex direction="column" gap="2">
            {effectRows.map((row, index) => (
              <Box
                key={`effect-row-${index}`}
                px="2"
                py="2"
                style={{
                  border: "1px solid var(--gray-a5)",
                  borderRadius: "var(--radius-2)",
                }}
              >
                {row}
              </Box>
            ))}
          </Flex>
        </Box>
      );
    }

    function renderReadonlyPatchSubRows(
      patch: UIStepPatch,
      step?: UIStep,
    ): ReactNode {
      const rows: ReactNode[] = [];

      if ("savedGroups" in patch) {
        rows.push(
          <ReadOnlyEffectRow label="Saved groups">
            {patch.savedGroups === null ? (
              "None"
            ) : patch.savedGroups && patch.savedGroups.length > 0 ? (
              <SavedGroupTargetingDisplay savedGroups={patch.savedGroups} />
            ) : (
              "None"
            )}
          </ReadOnlyEffectRow>,
        );
      }

      if ("condition" in patch) {
        rows.push(
          <ReadOnlyEffectRow label="Attribute targeting">
            {isEmptyConditionValue(patch.condition) ? (
              "None"
            ) : (
              <ConditionDisplay condition={patch.condition ?? "{}"} />
            )}
          </ReadOnlyEffectRow>,
        );
      }

      if ("prerequisites" in patch) {
        rows.push(
          <ReadOnlyEffectRow label="Prerequisites">
            {patch.prerequisites === null ? (
              "None"
            ) : patch.prerequisites && patch.prerequisites.length > 0 ? (
              <ConditionDisplay prerequisites={patch.prerequisites} />
            ) : (
              "None"
            )}
          </ReadOnlyEffectRow>,
        );
      }

      if ("force" in patch && !hideTemplateSave) {
        rows.push(
          <ReadOnlyEffectRow label="Default value">
            <span style={{ fontFamily: "monospace" }}>
              {patch.force ?? "null"}
            </span>
          </ReadOnlyEffectRow>,
        );
      }

      if ("allEnvironments" in patch || "environments" in patch) {
        const envLabel = patch.allEnvironments
          ? "All environments"
          : patch.environments && patch.environments.length > 0
            ? patch.environments.join(", ")
            : "No environments";
        rows.push(
          <ReadOnlyEffectRow label="Rule environments">
            {envLabel}
          </ReadOnlyEffectRow>,
        );
      }

      if (step?.holdConditions?.minSampleSize != null) {
        rows.push(
          <ReadOnlyEffectRow label="Minimum sample size">
            {step.holdConditions.minSampleSize.toLocaleString()}
          </ReadOnlyEffectRow>,
        );
      }
      if (step?.approvalNotes?.trim()) {
        rows.push(
          <ReadOnlyEffectRow label="Approval notes">
            {step.approvalNotes.trim()}
          </ReadOnlyEffectRow>,
        );
      }

      if (!rows.length) return null;

      return (
        <Box mt="2" pr="2" style={{ paddingLeft: subRowIndent }}>
          <Flex direction="column" gap="2">
            {rows.map((row, index) => (
              <Box
                key={`readonly-effect-row-${index}`}
                px="2"
                py="2"
                style={{
                  border: "1px solid var(--gray-a5)",
                  borderRadius: "var(--radius-2)",
                }}
              >
                {row}
              </Box>
            ))}
          </Flex>
        </Box>
      );
    }

    const endRow = (
      <Box
        my={isReadOnlyView ? "4" : "2"}
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
        <Flex direction="column" gap="2" pl="2">
          <Flex align="center" gap="4" style={{ minHeight: 38 }}>
            <Box style={{ width: COL.num, flexShrink: 0, textAlign: "center" }}>
              <Text size="small" weight="medium" color="text-low">
                end
              </Text>
            </Box>
            {activeFields.has("coverage") && (
              <Box
                style={{
                  width: COL.coverage,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {isReadOnlyView ? (
                  <Text size="small" color="text-low">
                    {state.endPatch.coverage ?? 100}%
                  </Text>
                ) : (
                  <div
                    className={`position-relative ${styles.percentInputWrap}`}
                  >
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
                )}
              </Box>
            )}
            <Box flexGrow="1" />
            {!isReadOnlyView && (
              <Flex align="center" gap="2" pr="3" style={{ flexShrink: 0 }}>
                <DropdownMenu
                  open={openMenuIndex === "end"}
                  onOpenChange={(o) => setOpenMenuIndex(o ? "end" : null)}
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
                  {renderRuleEffectsMenuGroup(state.endPatch, (field) => {
                    setOpenMenuIndex(null);
                    const patchWithField =
                      field === "allEnvironments"
                        ? {
                            ...setPatchField(
                              state.endPatch,
                              "allEnvironments",
                              (
                                getDefaultFieldValueForNewEffect(
                                  "allEnvironments",
                                  "end",
                                ) as UIStepPatch
                              )?.allEnvironments ??
                                FIELD_DEFAULTS.allEnvironments,
                            ),
                            environments:
                              (
                                getDefaultFieldValueForNewEffect(
                                  "allEnvironments",
                                  "end",
                                ) as UIStepPatch
                              )?.environments ?? [],
                          }
                        : setPatchField(
                            state.endPatch,
                            field,
                            getDefaultFieldValueForNewEffect(field, "end"),
                          );
                    patchState({
                      endAdditionalEffectsOpen: true,
                      endPatch: patchWithField,
                    });
                  })}
                </DropdownMenu>
              </Flex>
            )}
          </Flex>
          {isReadOnlyView
            ? renderReadonlyPatchSubRows(state.endPatch)
            : renderPatchSubRows(
                state.endPatch,
                (field, value) =>
                  patchState({
                    endPatch: setPatchField(state.endPatch, field, value),
                  }),
                (field) => {
                  const nextPatch = setPatchField(
                    state.endPatch,
                    field,
                    undefined,
                  );
                  patchState({
                    endPatch: nextPatch,
                    endAdditionalEffectsOpen: hasSelectedRuleEffects(nextPatch),
                  });
                },
                (nextPatch) =>
                  patchState({
                    endPatch: nextPatch,
                    endAdditionalEffectsOpen: hasSelectedRuleEffects(nextPatch),
                  }),
                "end",
                state.endAdditionalEffectsOpen,
              )}
        </Flex>
      </Box>
    );

    return (
      <Box>
        <Flex
          align="center"
          gap="4"
          pb="1"
          pl="2"
          style={{ borderBottom: "1px solid var(--gray-a6)" }}
        >
          <ColHeader width={COL.num}>Step</ColHeader>
          {activeFields.has("coverage") && (
            <ColHeader width={COL.coverage}>Rollout %</ColHeader>
          )}
          <ColHeader width={COL.trigger}>Action</ColHeader>
          <Box flexGrow="1" />
          {!isReadOnlyView && saveTemplateButton}
        </Flex>

        {stepsForDisplay.map((step, i) => {
          const stepMarker = getReadOnlyStepMarker(i);
          return (
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
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 4,
                  borderRadius: "var(--radius-2) 0 0 var(--radius-2)",
                  backgroundColor: step.monitored
                    ? "var(--blue-9)"
                    : "var(--gray-a5)",
                }}
              />
              <Flex direction="column" pl="2">
                <Flex align="center" gap="4">
                  <Box
                    style={{
                      width: COL.num,
                      flexShrink: 0,
                      ...(isReadOnlyView
                        ? {
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }
                        : {}),
                    }}
                    pl={isReadOnlyView ? "0" : "3"}
                  >
                    {stepMarker ? (
                      <Tooltip body={stepMarker.tooltip}>
                        <Box
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "999px",
                            border: `2px solid ${stepMarker.borderColor}`,
                            color: stepMarker.textColor,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "var(--font-size-1)",
                            fontWeight: 600,
                            lineHeight: 1,
                          }}
                        >
                          {i + 1}
                        </Box>
                      </Tooltip>
                    ) : (
                      <Text size="small" color="text-low">
                        {i + 1}
                      </Text>
                    )}
                  </Box>

                  {activeFields.has("coverage") &&
                    (() => {
                      const maxCov = step.monitored ? 50 : 100;
                      const minCov = step.monitored ? 1 : 0;
                      return (
                        <Box style={{ width: COL.coverage, flexShrink: 0 }}>
                          {isReadOnlyView ? (
                            <Box
                              style={{
                                height: 38,
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              <Text size="small" color="text-low">
                                {formatReadonlyCoverage(step)}
                              </Text>
                            </Box>
                          ) : (
                            <div
                              className={`position-relative ${styles.percentInputWrap}`}
                            >
                              <Field
                                style={{ width: COL.coverage, minHeight: 38 }}
                                type="number"
                                min={minCov}
                                max={maxCov}
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
                                      maxCov,
                                      Math.max(
                                        minCov,
                                        parseInt(e.target.value) || 0,
                                      ),
                                    ),
                                  )
                                }
                              />
                              <span>%</span>
                            </div>
                          )}
                        </Box>
                      );
                    })()}
                  <Flex
                    align="center"
                    gap="2"
                    style={
                      step.triggerType === "approval"
                        ? { flex: 1, minWidth: COL.trigger }
                        : { width: COL.trigger + COL.duration, flexShrink: 0 }
                    }
                  >
                    {isReadOnlyView ? (
                      <Text size="small" color="text-low">
                        {formatReadonlyAction(step)}
                      </Text>
                    ) : (
                      <>
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
                            className="select-unfixed"
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
                              errorLevel={
                                isStepBelowCadence(step) ? "warning" : undefined
                              }
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
                                className="select-unfixed"
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
                                    updateStep(i, {
                                      approvalNotes: e.target.value,
                                    })
                                  }
                                  containerClassName="mb-0"
                                  style={{ minHeight: 38 }}
                                />
                              </Box>
                            )}
                          </Flex>
                        )}
                      </>
                    )}
                  </Flex>

                  <Box flexGrow="1" />

                  <Flex align="center" gap="2" pr="3" style={{ flexShrink: 0 }}>
                    {step.holdConditions?.minSampleSize != null && (
                      <Text size="small" color="text-low">
                        Min. sample:{" "}
                        {step.holdConditions.minSampleSize.toLocaleString()}
                      </Text>
                    )}
                    {isReadOnlyView && (
                      <Tooltip
                        body={
                          step.monitored
                            ? "This step is monitored"
                            : "This step is not monitored"
                        }
                      >
                        <Box
                          style={{
                            width: 28,
                            height: 28,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: step.monitored
                              ? "var(--indigo-11)"
                              : "var(--gray-8)",
                            opacity: step.monitored ? 1 : 0.6,
                          }}
                        >
                          <MonitoredIcon size={16} />
                        </Box>
                      </Tooltip>
                    )}
                    {!isReadOnlyView && (
                      <>
                        <Tooltip
                          body={
                            !hasSafeRolloutFeature
                              ? "Monitoring requires a Pro plan"
                              : step.monitored
                                ? "This step is monitored"
                                : "Monitor this step"
                          }
                        >
                          <Box
                            style={{
                              width: 28,
                              height: 28,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <IconButton
                              type="button"
                              variant={step.monitored ? "soft" : "ghost"}
                              color={step.monitored ? "indigo" : "gray"}
                              size="2"
                              radius="medium"
                              disabled={!hasSafeRolloutFeature}
                              onClick={() => {
                                const nowMonitored = !step.monitored;
                                const update: Partial<UIStep> = {
                                  monitored: nowMonitored,
                                };
                                if (nowMonitored) {
                                  const cov = step.patch.coverage ?? 0;
                                  if (cov === 0 || cov > 50) {
                                    update.patch = {
                                      ...step.patch,
                                      coverage: Math.min(50, Math.max(1, cov)),
                                    };
                                  }
                                }
                                updateStep(i, update);
                              }}
                              style={{
                                width: 28,
                                height: 28,
                                padding: 0,
                              }}
                            >
                              <MonitoredIcon size={16} />
                            </IconButton>
                          </Box>
                        </Tooltip>
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
                          {(() => {
                            const hasRuleEffects =
                              getAvailableRuleEffects(step.patch).length > 0;
                            return (
                              <>
                                {step.monitored && (
                                  <>
                                    <DropdownMenuGroup label="Monitoring settings">
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setOpenMenuIndex(null);
                                          setMinSamplePopoverIndex(i);
                                        }}
                                      >
                                        Minimum sample size
                                      </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                    <DropdownMenuSeparator />
                                  </>
                                )}
                                {renderRuleEffectsMenuGroup(
                                  step.patch,
                                  (field) => {
                                    setOpenMenuIndex(null);
                                    const patchWithField =
                                      field === "allEnvironments"
                                        ? {
                                            ...setPatchField(
                                              step.patch,
                                              "allEnvironments",
                                              (
                                                getDefaultFieldValueForNewEffect(
                                                  "allEnvironments",
                                                  i,
                                                ) as UIStepPatch
                                              )?.allEnvironments ??
                                                FIELD_DEFAULTS.allEnvironments,
                                            ),
                                            environments:
                                              (
                                                getDefaultFieldValueForNewEffect(
                                                  "allEnvironments",
                                                  i,
                                                ) as UIStepPatch
                                              )?.environments ?? [],
                                          }
                                        : setPatchField(
                                            step.patch,
                                            field,
                                            getDefaultFieldValueForNewEffect(
                                              field,
                                              i,
                                            ),
                                          );
                                    updateStep(i, {
                                      additionalEffectsOpen: true,
                                      patch: patchWithField,
                                    });
                                  },
                                )}
                                {hasRuleEffects ? (
                                  <DropdownMenuSeparator />
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
                                ) : null}
                              </>
                            );
                          })()}
                        </DropdownMenu>
                      </>
                    )}
                  </Flex>
                </Flex>

                {isReadOnlyView
                  ? renderReadonlyPatchSubRows(step.patch, step)
                  : renderPatchSubRows(
                      step.patch,
                      (field, value) => updateStepPatch(i, field, value),
                      (field) => {
                        const nextPatch = setPatchField(
                          step.patch,
                          field,
                          undefined,
                        );
                        updateStep(i, {
                          patch: nextPatch,
                          additionalEffectsOpen:
                            hasSelectedRuleEffects(nextPatch),
                        });
                      },
                      (nextPatch) =>
                        updateStep(i, {
                          patch: nextPatch,
                          additionalEffectsOpen:
                            hasSelectedRuleEffects(nextPatch),
                        }),
                      i,
                      step.additionalEffectsOpen,
                    )}
              </Flex>
            </Box>
          );
        })}

        {!isReadOnlyView && (
          <Box py="1">
            <Link size="2" onClick={addStep}>
              <PiPlusBold style={{ marginRight: 3, verticalAlign: "middle" }} />
              Add step
            </Link>
          </Box>
        )}

        {!isReadOnlyView &&
          minSamplePopoverIndex != null &&
          state.steps[minSamplePopoverIndex] && (
            <MinSampleDialog
              initialValue={
                state.steps[minSamplePopoverIndex]?.holdConditions
                  ?.minSampleSize
              }
              onSave={(val) => {
                const idx = minSamplePopoverIndex;
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
          )}

        {endRow}
      </Box>
    );
  }

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
    const resolvedMode =
      state.mode === "off" && !ruleRampSchedule ? "create" : state.mode;
    const newState = templateToSectionState(
      tmpl,
      resolvedMode === "edit" ? "edit" : "create",
    );
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
      builderMode: "advanced",
      linkedRampId: state.linkedRampId,
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
      builderMode: "simple",
      monitoring: state.monitoring,
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
          (templates.length === 0 ? "No templates" : "None")}
      </span>
      <PiCaretDownBold style={{ flexShrink: 0 }} />
    </Flex>
  );

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

  function patchMonitoring(update: Partial<RampMonitoringState>) {
    const merged = { ...state.monitoring, ...update };
    patchState({ monitoring: merged });
  }

  function handleSimpleDurationChange(duration: number, unit?: IntervalUnit) {
    const d = Math.max(1, duration);
    const u = unit ?? state.simpleDurationUnit ?? "days";
    const monitored = state.steps.some((s) => s.monitored);
    const steps = generateSimpleSteps(d, u).map((s) => ({
      ...s,
      monitored,
    }));
    patchState({
      simpleDurationDays: d,
      simpleDurationUnit: u,
      steps,
    });
  }

  const orgCadenceLabel = useMemo(() => {
    const s = settings?.updateSchedule;
    if (!s || s.type === "never") return "6 hours";
    if (s.type === "stale" && s.hours) {
      return `${s.hours} hour${s.hours === 1 ? "" : "s"}`;
    }
    if (s.type === "cron" && s.cron) return `cron: ${s.cron}`;
    return "6 hours";
  }, [settings?.updateSchedule]);

  const effectiveCadenceSeconds = useMemo(() => {
    if (!state.steps.some((s) => s.monitored)) return null;
    if (
      state.monitoring.updateScheduleMinutes != null &&
      state.monitoring.updateScheduleMinutes > 0
    ) {
      return state.monitoring.updateScheduleMinutes * 60;
    }
    const s = settings?.updateSchedule;
    if (s?.type === "stale" && s.hours) return s.hours * 3600;
    return 6 * 3600;
  }, [
    state.steps,
    state.monitoring.updateScheduleMinutes,
    settings?.updateSchedule,
  ]);

  function isStepBelowCadence(step: UIStep): boolean {
    if (!effectiveCadenceSeconds || !step.monitored) return false;
    if (step.triggerType !== "interval") return false;
    return (
      Math.max(1, step.intervalValue) * UNIT_MULT[step.intervalUnit] <=
      effectiveCadenceSeconds
    );
  }

  const anyCadenceWarning = useMemo(() => {
    if (!effectiveCadenceSeconds) return false;
    if (state.builderMode === "simple") {
      const unit = state.simpleDurationUnit ?? "days";
      const totalSeconds = state.simpleDurationDays * UNIT_MULT[unit];
      const perStepSeconds = totalSeconds / SIMPLE_COVERAGES.length;
      return perStepSeconds <= effectiveCadenceSeconds;
    }
    return state.steps.some(
      (s) =>
        s.monitored &&
        s.triggerType === "interval" &&
        Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit] <=
          effectiveCadenceSeconds,
    );
  }, [
    effectiveCadenceSeconds,
    state.builderMode,
    state.simpleDurationDays,
    state.simpleDurationUnit,
    state.steps,
  ]);

  const dsName =
    selectedDatasource?.name ??
    (datasources.length === 0 ? "No data sources" : "Select data source");
  const eqName =
    exposureQueries.find((q) => q.id === state.monitoring.exposureQueryId)
      ?.name ?? (exposureQueries.length > 0 ? "Select" : "—");

  const hasAdvancedOverrides =
    (state.monitoring.updateScheduleMinutes != null &&
      state.monitoring.updateScheduleMinutes > 0) ||
    !!state.monitoring.srmAction ||
    !!state.monitoring.noTrafficAction ||
    !!state.monitoring.multipleExposureAction;
  const [showAdvancedMonitoring, setShowAdvancedMonitoring] =
    useState(hasAdvancedOverrides);

  const monitoringConfigUI = (
    <Box>
      <Flex direction="column" gap="2">
        <Flex align="center" gap="1">
          <Text as="label" weight="medium" mb="0">
            Data source:
          </Text>
          <DropdownMenu
            trigger={
              <Link type="button" style={{ color: "var(--color-text-high)" }}>
                <Text mr="1">{dsName}</Text>
                <PiCaretDownFill />
              </Link>
            }
            menuPlacement="start"
            variant="soft"
          >
            <DropdownMenuGroup>
              {datasources.map((d) => (
                <DropdownMenuItem
                  key={d.id}
                  onClick={() => {
                    const eqs = d.settings?.queries?.exposure ?? [];
                    patchMonitoring({
                      datasourceId: d.id,
                      exposureQueryId: eqs[0]?.id ?? "",
                    });
                  }}
                >
                  {d.name}
                  {d.id === settings?.defaultDataSource ? " (default)" : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenu>
        </Flex>

        <Flex align="center" gap="1">
          <Text as="label" weight="medium" mb="0">
            Assignment table:
          </Text>
          <DropdownMenu
            trigger={
              <Link
                type="button"
                style={{
                  color: state.monitoring.datasourceId
                    ? "var(--color-text-high)"
                    : "var(--color-text-disabled)",
                }}
              >
                <Text mr="1">{eqName}</Text>
                <PiCaretDownFill />
              </Link>
            }
            menuPlacement="start"
            variant="soft"
          >
            <DropdownMenuGroup>
              {exposureQueries.map((q) => (
                <DropdownMenuItem
                  key={q.id}
                  onClick={() => patchMonitoring({ exposureQueryId: q.id })}
                >
                  {q.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenu>
        </Flex>

        <Box mt="4">
          <Text as="label" weight="medium" mb="1">
            Guardrail Metrics
          </Text>
          <Text as="div" size="small" mb="2">
            Automatically roll back the entire schedule if any of these metrics
            show a significant regression
          </Text>
          <MetricsSelector
            datasource={state.monitoring.datasourceId}
            exposureQueryId={state.monitoring.exposureQueryId}
            project={feature.project ?? ""}
            includeFacts
            includeGroups
            excludeQuantiles
            selected={state.monitoring.guardrailMetricIds}
            disabled={!state.monitoring.exposureQueryId}
            onChange={(v) => patchMonitoring({ guardrailMetricIds: v })}
          />
        </Box>

        <Box>
          <Text as="label" weight="medium" mb="1">
            Signal Metrics
          </Text>
          <Text as="div" size="small" mb="2">
            If any of these metrics show a significant regression, hold at the
            current step until they recover or until manually advanced
          </Text>
          <MetricsSelector
            datasource={state.monitoring.datasourceId}
            exposureQueryId={state.monitoring.exposureQueryId}
            project={feature.project ?? ""}
            includeFacts
            includeGroups
            excludeQuantiles
            selected={state.monitoring.signalMetricIds}
            disabled={!state.monitoring.exposureQueryId}
            onChange={(v) => patchMonitoring({ signalMetricIds: v })}
          />
        </Box>

        <div
          className="link-purple font-weight-bold mt-2"
          role="button"
          onClick={() => setShowAdvancedMonitoring((v) => !v)}
        >
          <PiCaretRightFill
            className="mr-1"
            style={{
              transform: showAdvancedMonitoring ? "rotate(90deg)" : undefined,
              transition: "transform 0.15s",
            }}
          />
          Advanced Settings
        </div>
        {showAdvancedMonitoring && (
          <Flex direction="column" gap="3" mt="2">
            <Box style={{ width: 180 }}>
              <Field
                label={
                  <>
                    Refresh results every{" "}
                    <Tooltip
                      body={
                        <>
                          {state.steps.some((s) => !s.monitored)
                            ? "For monitored steps, how"
                            : "How"}{" "}
                          frequently your guardrails will be analyzed.
                          {state.steps.some((s) => !s.monitored) && (
                            <p className="mt-2 mb-0">
                              Does not apply to unmonitored steps, which have a
                              minimum granularity of 1 minute.
                            </p>
                          )}
                          <p className="mt-2 mb-0">
                            Lower values give more granular data and enable
                            faster releases, but increase query costs against
                            your data source.
                          </p>
                        </>
                      }
                      flipTheme={false}
                    >
                      <PiInfo color="var(--color-text-low)" />
                    </Tooltip>
                  </>
                }
                append="hours"
                type="number"
                step="any"
                min={0.25}
                max={168}
                value={
                  state.monitoring.updateScheduleMinutes != null
                    ? String(state.monitoring.updateScheduleMinutes / 60)
                    : ""
                }
                placeholder="org default"
                onChange={(e) => {
                  const v = e.target.value;
                  patchMonitoring({
                    updateScheduleMinutes: v
                      ? Math.round(parseFloat(v) * 60)
                      : null,
                  });
                }}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!v || v <= 0) {
                    patchMonitoring({ updateScheduleMinutes: null });
                  } else {
                    const clamped = Math.min(168, Math.max(0.25, v));
                    patchMonitoring({
                      updateScheduleMinutes: Math.round(clamped * 60),
                    });
                  }
                }}
                helpText={`Blank = org default (${orgCadenceLabel})`}
                containerClassName="mb-0"
              />
            </Box>
            <Flex align="center" gap="1">
              <Text as="label" weight="medium" mb="0">
                If SRM detected:
              </Text>
              <DropdownMenu
                trigger={
                  <Link
                    type="button"
                    style={{ color: "var(--color-text-high)" }}
                  >
                    <Text mr="1">
                      {state.monitoring.srmAction === "rollback"
                        ? "Roll back"
                        : state.monitoring.srmAction === "warn"
                          ? "Warn only"
                          : "Hold step"}
                    </Text>
                    <PiCaretDownFill />
                  </Link>
                }
                menuPlacement="start"
                variant="soft"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => patchMonitoring({ srmAction: undefined })}
                  >
                    Hold step (default)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => patchMonitoring({ srmAction: "rollback" })}
                  >
                    Roll back
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => patchMonitoring({ srmAction: "warn" })}
                  >
                    Warn only
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenu>
            </Flex>
            <Flex align="center" gap="1">
              <Text as="label" weight="medium" mb="0">
                If no traffic:
              </Text>
              <DropdownMenu
                trigger={
                  <Link
                    type="button"
                    style={{ color: "var(--color-text-high)" }}
                  >
                    <Text mr="1">
                      {state.monitoring.noTrafficAction === "rollback"
                        ? "Roll back"
                        : state.monitoring.noTrafficAction === "warn"
                          ? "Warn only"
                          : "Hold step"}
                    </Text>
                    <PiCaretDownFill />
                  </Link>
                }
                menuPlacement="start"
                variant="soft"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() =>
                      patchMonitoring({ noTrafficAction: undefined })
                    }
                  >
                    Hold step (default)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      patchMonitoring({ noTrafficAction: "rollback" })
                    }
                  >
                    Roll back
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => patchMonitoring({ noTrafficAction: "warn" })}
                  >
                    Warn only
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenu>
            </Flex>
            <Flex align="center" gap="1">
              <Text as="label" weight="medium" mb="0">
                If multiple exposures:
              </Text>
              <DropdownMenu
                trigger={
                  <Link
                    type="button"
                    style={{ color: "var(--color-text-high)" }}
                  >
                    <Text mr="1">
                      {state.monitoring.multipleExposureAction === "rollback"
                        ? "Roll back"
                        : state.monitoring.multipleExposureAction === "warn"
                          ? "Warn only"
                          : "Hold step"}
                    </Text>
                    <PiCaretDownFill />
                  </Link>
                }
                menuPlacement="start"
                variant="soft"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() =>
                      patchMonitoring({ multipleExposureAction: undefined })
                    }
                  >
                    Hold step (default)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      patchMonitoring({ multipleExposureAction: "warn" })
                    }
                  >
                    Warn only
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      patchMonitoring({ multipleExposureAction: "rollback" })
                    }
                  >
                    Roll back
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenu>
            </Flex>
          </Flex>
        )}
      </Flex>
    </Box>
  );

  const isSimpleMode = state.builderMode === "simple";
  const hasTemplate = !!selectedTemplateId;
  const showAdvancedEditor = !isSimpleMode || hasTemplate;

  const hasSafeRolloutFeature = hasCommercialFeature("safe-rollout");

  const allMonitored =
    state.steps.length > 0 && state.steps.every((s) => s.monitored);
  const noneMonitored = state.steps.every((s) => !s.monitored);

  useEffect(() => {
    if (noneMonitored || state.monitoring.datasourceId) return;
    const defaultDs =
      datasources.find((d) => d.id === settings?.defaultDataSource) ??
      datasources[0];
    if (!defaultDs) return;
    const eqs = defaultDs.settings?.queries?.exposure ?? [];
    patchMonitoring({
      datasourceId: defaultDs.id,
      exposureQueryId: eqs[0]?.id ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noneMonitored, state.monitoring.datasourceId]);
  const monitorCheckboxValue: boolean | "indeterminate" = allMonitored
    ? true
    : noneMonitored
      ? false
      : "indeterminate";
  const showMonitoringConfig = !noneMonitored;

  function handleMonitorToggle(checked: boolean) {
    patchState({
      steps: state.steps.map((s) => {
        const updated = { ...s, monitored: checked };
        if (checked && (s.patch.coverage ?? 0) === 0) {
          updated.patch = { ...s.patch, coverage: 1 };
        }
        return updated;
      }),
    });
  }

  const monitorCheckbox = (
    <>
      <Flex align="center" gap="2" mb="4">
        <Checkbox
          value={monitorCheckboxValue}
          setValue={handleMonitorToggle}
          label={
            !hasSafeRolloutFeature ? (
              <>
                Monitor this release{" "}
                <PaidFeatureBadge commercialFeature="safe-rollout" />
              </>
            ) : (
              "Monitor this release"
            )
          }
          description="Enable guardrail monitoring and auto-rollback for monitored steps"
          disabled={!hasSafeRolloutFeature}
        />
      </Flex>

      {showMonitoringConfig && (
        <Box
          mb="4"
          px="5"
          pt="3"
          pb="4"
          style={{
            backgroundColor: "var(--violet-a2)",
            borderRadius: "var(--radius-2)",
          }}
        >
          <Flex align="center" gap="2" mb="4">
            <MonitoredIcon size={18} />
            <Text weight="semibold">Monitoring Settings</Text>
          </Flex>
          {monitoringConfigUI}
        </Box>
      )}
    </>
  );

  const templateDropdown =
    templates.length > 0 && hasRampSchedulesFeature && !hideTemplateSave ? (
      <Box mb="4">
        <Text as="div" weight="semibold" mb="1">
          Template
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
            None
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
      </Box>
    ) : null;

  const durationSummary = useMemo(() => {
    let totalSeconds = 0;
    let approvals = 0;
    let hasMonitored = false;
    for (const step of state.steps) {
      if (step.triggerType === "interval") {
        totalSeconds +=
          Math.max(1, step.intervalValue) * UNIT_MULT[step.intervalUnit];
      } else {
        approvals++;
      }
      if (step.monitored) hasMonitored = true;
    }
    const isPure = approvals === 0 && !hasMonitored;
    const parts: string[] = [];
    if (totalSeconds > 0) {
      parts.push(formatRemainingDuration(totalSeconds));
    }
    if (approvals > 0) {
      parts.push(`${approvals} approval step${approvals > 1 ? "s" : ""}`);
    }
    if (hasMonitored) {
      parts.push("monitored steps");
    }
    return { isPure, totalSeconds, label: parts.join(" + ") || "0" };
  }, [state.steps]);

  const durationInput = (
    <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
      <Box style={{ width: 70 }}>
        <Text as="label" weight="medium" mb="0">
          Duration
        </Text>
      </Box>
      {isSimpleMode ? (
        <Flex align="center" justify="between" style={{ width: 150 }}>
          <Field
            type="number"
            min="1"
            value={String(state.simpleDurationDays)}
            onFocus={(e) => e.target.select()}
            onChange={(e) =>
              patchState({ simpleDurationDays: parseInt(e.target.value) || 1 })
            }
            onBlur={(e) =>
              handleSimpleDurationChange(
                Math.max(1, parseInt(e.target.value) || 1),
              )
            }
            containerClassName="mb-0"
            style={{ width: 60, minHeight: 38 }}
            errorLevel={anyCadenceWarning ? "warning" : undefined}
          />
          <SelectField
            value={state.simpleDurationUnit ?? "days"}
            options={[
              { value: "minutes", label: "min" },
              { value: "hours", label: "hrs" },
              { value: "days", label: "days" },
            ]}
            onChange={(v) => {
              const u = v as IntervalUnit;
              patchState({ simpleDurationUnit: u });
              handleSimpleDurationChange(state.simpleDurationDays, u);
            }}
            containerClassName="mb-0"
            containerStyle={{ width: 80 }}
            className="select-unfixed"
          />
        </Flex>
      ) : (
        <Text color="text-mid">
          {durationSummary.isPure
            ? durationSummary.label
            : `~${durationSummary.label}`}
        </Text>
      )}
    </Flex>
  );

  const cutoffInput = (
    <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
      <Box style={{ width: 70 }}>
        <Flex align="center" gap="1">
          <Text as="label" weight="medium" mb="0">
            Disable
          </Text>
          <Tooltip
            body={
              <>
                <Text as="div" mb="2">
                  Automatically disables the rule on this date.
                </Text>
                <Text as="div" mb="2">
                  Note: If incomplete, the Ramp-up is automatically completed on
                  this date.
                </Text>
              </>
            }
          >
            <PiInfo color="var(--color-text-low)" />
          </Tooltip>
        </Flex>
      </Box>
      <SelectField
        value={state.cutoffDate ? "on-date" : "none"}
        options={[
          { value: "none", label: "Never" },
          { value: "on-date", label: "On date" },
        ]}
        onChange={(v) => {
          if (v === "none") {
            patchState({ cutoffDate: "" });
          } else {
            const d = new Date();
            d.setDate(d.getDate() + 14);
            d.setSeconds(0, 0);
            patchState({ cutoffDate: d.toISOString().slice(0, 16) });
          }
        }}
        containerClassName="mb-0"
        containerStyle={{ minHeight: 38, width: 150 }}
      />
      {state.cutoffDate && (
        <DatePicker
          date={state.cutoffDate || undefined}
          setDate={(d) => patchState({ cutoffDate: d ? d.toISOString() : "" })}
          precision="datetime"
          containerClassName="mb-0"
          disableBefore={new Date().toISOString()}
        />
      )}
    </Flex>
  );

  const customizeLink =
    !hasTemplate && isSimpleMode ? (
      <Box mb="4">
        <Button
          variant="ghost"
          onClick={() => {
            const unit = state.simpleDurationUnit ?? "days";
            const dur = state.simpleDurationDays;
            const monitored = state.steps.some((s) => s.monitored);
            const steps = generateSimpleSteps(dur, unit).map((s) => ({
              ...s,
              monitored,
            }));
            patchState({ builderMode: "advanced", steps });
            setSelectedTemplateId("");
          }}
          icon={<PiCalendarBlank />}
        >
          Edit Schedule
        </Button>
      </Box>
    ) : null;

  const startInput = !hideTemplateSave ? (
    <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
      <Box style={{ width: 70 }}>
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
            patchState({ startDate: "" });
          } else {
            const d = new Date();
            d.setSeconds(0, 0);
            patchState({ startDate: d.toISOString().slice(0, 16) });
          }
        }}
        containerClassName="mb-0"
        containerStyle={{ minHeight: 38, width: 150 }}
      />
      {state.startDate && (
        <DatePicker
          date={state.startDate || undefined}
          setDate={(d) => patchState({ startDate: d ? d.toISOString() : "" })}
          precision="datetime"
          containerClassName="mb-0"
        />
      )}
    </Flex>
  ) : null;

  const simplifyLink =
    showAdvancedEditor && !hasTemplate ? (
      <Box mb="3">
        <Button
          variant="ghost"
          onClick={() => {
            const unit = state.simpleDurationUnit ?? "days";
            const dur = state.simpleDurationDays;
            const monitored = state.steps.some((s) => s.monitored);
            const steps = generateSimpleSteps(dur, unit).map((s) => ({
              ...s,
              monitored,
            }));
            patchState({ builderMode: "simple", steps });
            setSelectedTemplateId("");
          }}
          icon={<PiArrowCounterClockwise />}
        >
          Simple Schedule
        </Button>
      </Box>
    ) : null;

  const readOnlySettings =
    isReadOnlyView && ruleRampSchedule ? (
      <Box mb="3">
        {(() => {
          const monitoringConfig = ruleRampSchedule.monitoringConfig;
          const monitoringDatasource = monitoringConfig?.datasourceId
            ? getDatasourceById(monitoringConfig.datasourceId)
            : null;
          const monitoringExposureQuery = monitoringConfig
            ? getExposureQuery(
                monitoringDatasource?.settings,
                monitoringConfig.exposureQueryId,
              )
            : null;
          const userUnitLabel = formatUserUnitLabel(
            monitoringExposureQuery?.userIdType,
          );
          const formatMetricNames = (metricIds: string[] = []) => {
            if (!metricIds.length) return "None";
            return metricIds
              .map((id) => getExperimentMetricById(id)?.name || id)
              .join(", ");
          };

          return (
            <>
              <Text size="small" weight="medium" mb="1">
                Ramp settings
              </Text>
              <Box
                px="2"
                py="2"
                mb="3"
                style={{
                  border: "1px solid var(--gray-a5)",
                  borderRadius: "var(--radius-2)",
                }}
              >
                {!hideTemplateSave && (
                  <ReadOnlySettingRow label="Start">
                    {ruleRampSchedule.startDate
                      ? formatScheduledDate(ruleRampSchedule.startDate)
                      : "Immediately"}
                  </ReadOnlySettingRow>
                )}
                <ReadOnlySettingRow label="Duration">
                  {formatReadonlyDurationFromSchedule(ruleRampSchedule)}
                </ReadOnlySettingRow>
                {!hideTemplateSave && (
                  <ReadOnlySettingRow label="Disable">
                    {ruleRampSchedule.cutoffDate
                      ? formatScheduledDate(ruleRampSchedule.cutoffDate)
                      : "Never"}
                  </ReadOnlySettingRow>
                )}
                <ReadOnlySettingRow label="Lock feature">
                  {ruleRampSchedule.lockdownConfig?.mode === "locked"
                    ? "Yes"
                    : "No"}
                </ReadOnlySettingRow>
              </Box>

              <Text size="small" weight="medium" mb="1">
                Monitoring settings
              </Text>
              <Box
                px="2"
                py="2"
                style={{
                  border: "1px solid var(--gray-a5)",
                  borderRadius: "var(--radius-2)",
                }}
              >
                {monitoringConfig ? (
                  <>
                    <ReadOnlySettingRow label="Mode">
                      {(monitoringConfig.monitoringMode ??
                        (monitoringConfig.autoUpdate === false
                          ? "manual"
                          : "auto")) === "manual"
                        ? "Manual updates"
                        : "Automatic updates"}
                    </ReadOnlySettingRow>
                    <ReadOnlySettingRow label="Datasource">
                      {monitoringDatasource?.name ||
                        monitoringConfig.datasourceId}
                    </ReadOnlySettingRow>
                    <ReadOnlySettingRow label="Assignment table">
                      {monitoringExposureQuery?.name ||
                        monitoringConfig.exposureQueryId}
                    </ReadOnlySettingRow>
                    <ReadOnlySettingRow label="Unit">
                      {userUnitLabel || "Users"}
                    </ReadOnlySettingRow>
                    <ReadOnlySettingRow label="Guardrail metrics">
                      {formatMetricNames(monitoringConfig.guardrailMetricIds)}
                    </ReadOnlySettingRow>
                    <ReadOnlySettingRow label="Signal metrics">
                      {formatMetricNames(
                        monitoringConfig.signalMetricIds ?? [],
                      )}
                    </ReadOnlySettingRow>
                    <ReadOnlySettingRow label="Update cadence">
                      {monitoringConfig.updateScheduleMinutes
                        ? `Every ${monitoringConfig.updateScheduleMinutes} min`
                        : "Default"}
                    </ReadOnlySettingRow>
                  </>
                ) : (
                  <ReadOnlySettingRow label="Status">
                    Not configured
                  </ReadOnlySettingRow>
                )}
              </Box>
            </>
          );
        })()}
      </Box>
    ) : null;

  const readOnlyHelperText =
    isReadOnlyView && ruleRampSchedule ? (
      <HelperText status="info" size="sm" mb="5">
        This schedule is read-only. Pause the schedule to make changes.
      </HelperText>
    ) : null;

  const createContent = (
    <>
      {templateDropdown}

      <Flex direction="column" gap="1" mb="4">
        {startInput}
        {durationInput}
        {!hideTemplateSave && cutoffInput}

        <Flex align="center" my="2">
          <Checkbox
            value={state.lockFeature}
            setValue={(v) => patchState({ lockFeature: v })}
            label="Lock feature while running"
          />
          <Tooltip
            body={
              <>
                <Text as="div" mb="2">
                  Blocks publishing draft changes to this feature while the ramp
                  is actively progressing.
                </Text>
                <Text as="div">
                  Does not apply when Ramp-up is paused, completed, or rolled
                  back.
                </Text>
              </>
            }
          >
            <PiInfo color="var(--color-text-low)" className="ml-1" />
          </Tooltip>
        </Flex>
      </Flex>

      {monitorCheckbox}

      {customizeLink}

      {simplifyLink}

      {anyCadenceWarning && effectiveCadenceSeconds && (
        <HelperText status="warning" mb="3">
          Monitored steps shorter than the update cadence (
          {formatRemainingDuration(effectiveCadenceSeconds)}) will hold until a
          fresh analysis completes, taking longer than configured.
        </HelperText>
      )}

      {showAdvancedEditor && (
        <>
          {state.steps.some(
            (s) =>
              s.triggerType === "interval" &&
              Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit] <
                POLL_INTERVAL_SECONDS,
          ) && (
            <Callout status="warning" mb="3">
              One or more steps are shorter than the minimum check interval (1
              min). Short steps may be applied together rather than at their
              exact scheduled times.
            </Callout>
          )}

          {boxStepGrid ? (
            <div className="appbox px-3 pt-3 pb-2 bg-light">
              {renderStepGrid()}
            </div>
          ) : (
            renderStepGrid()
          )}
        </>
      )}
    </>
  );

  const content = (
    <>
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
          {readOnlyHelperText}
          {isReadOnlyView && readOnlySettings}
          {state.mode !== "create" && isReadOnlyView && renderStepGrid()}
        </Box>
      )}
      {ruleRampSchedule &&
        hideNameField &&
        state.mode !== "create" &&
        isReadOnlyView && (
          <>
            {readOnlyHelperText}
            {readOnlySettings}
            {renderStepGrid()}
          </>
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
        !isReadOnlyView &&
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

export function reconstructUIPatch(
  patch?: FeatureRulePatch | null,
  monitored?: boolean,
): UIStepPatch {
  if (!patch) return {};
  const p: UIStepPatch = {};
  if (patch.coverage != null)
    p.coverage = Math.round(
      monitored ? (patch.coverage * 100) / 2 : patch.coverage * 100,
    );
  if ("condition" in patch) {
    const condition = patch.condition;
    p.condition =
      condition == null || isEmptyConditionValue(condition) ? null : condition;
  }
  if ("savedGroups" in patch) {
    const savedGroups = patch.savedGroups as SavedGroupTargeting[] | null;
    p.savedGroups = savedGroups && savedGroups.length > 0 ? savedGroups : null;
  }
  if ("prerequisites" in patch) {
    const prerequisites = patch.prerequisites as FeaturePrerequisite[] | null;
    p.prerequisites =
      prerequisites && prerequisites.length > 0 ? prerequisites : null;
  }
  if (patch.allEnvironments != null) p.allEnvironments = patch.allEnvironments;
  if (patch.environments != null)
    p.environments = patch.environments as string[];
  if (patch.force !== undefined) {
    p.force =
      typeof patch.force === "string"
        ? patch.force
        : JSON.stringify(patch.force);
  }
  return p;
}

export function reconstructUIStep(step: RampStep): UIStep {
  const patch = reconstructUIPatch(step.actions[0]?.patch, step.monitored);
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
      monitored: step.monitored ?? false,
      holdConditions: step.holdConditions ?? undefined,
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
    monitored: step.monitored ?? false,
    holdConditions: step.holdConditions ?? undefined,
  };
}

export function reconstructUIEndPatch(
  endActions: RampScheduleInterface["endActions"],
): UIStepPatch {
  if (!endActions?.length) return { coverage: 100 };
  return reconstructUIPatch(endActions[0]?.patch);
}

export function rampScheduleToSectionState(
  rs: RampScheduleInterface,
): RampSectionState {
  const endPatch = reconstructUIEndPatch(rs.endActions);
  const uiSteps = rs.steps.map(reconstructUIStep);
  const isSimple = stepsMatchSimplePattern(uiSteps, endPatch);
  const firstStep = uiSteps[0];
  return {
    mode: "edit",
    name: rs.name,
    startDate: rs.startDate ? new Date(rs.startDate).toISOString() : "",
    steps: uiSteps,
    endScheduleAt: rs.cutoffDate ? new Date(rs.cutoffDate).toISOString() : "",
    endPatch,
    linkedRampId: rs.id,
    endAdditionalEffectsOpen:
      VALID_STEP_FIELDS.some((f) => endPatch[f] !== undefined) ||
      (endPatch.coverage !== undefined && endPatch.coverage !== 100),
    cutoffDate: rs.cutoffDate ? new Date(rs.cutoffDate).toISOString() : "",
    lockFeature: rs.lockdownConfig?.mode === "locked",
    builderMode: isSimple ? "simple" : "advanced",
    monitoring: rs.monitoringConfig
      ? {
          datasourceId: rs.monitoringConfig.datasourceId,
          exposureQueryId: rs.monitoringConfig.exposureQueryId,
          guardrailMetricIds: [...rs.monitoringConfig.guardrailMetricIds],
          signalMetricIds: [...(rs.monitoringConfig.signalMetricIds ?? [])],
          updateScheduleMinutes:
            rs.monitoringConfig.updateScheduleMinutes ?? null,
          srmAction: rs.monitoringConfig.srmAction,
          noTrafficAction: rs.monitoringConfig.noTrafficAction,
          multipleExposureAction: rs.monitoringConfig.multipleExposureAction,
        }
      : { ...DEFAULT_MONITORING },
    simpleDurationUnit: isSimple && firstStep ? firstStep.intervalUnit : "days",
    simpleDurationDays:
      isSimple && firstStep
        ? firstStep.intervalValue * SIMPLE_COVERAGES.length
        : 7,
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
    steps: generateSimpleSteps(5, "days"),
    endScheduleAt: "",
    endPatch: { coverage: 100 },
    linkedRampId: "",
    endAdditionalEffectsOpen: false,
    cutoffDate: "",
    lockFeature: false,
    builderMode: "simple",
    monitoring: { ...DEFAULT_MONITORING },
    simpleDurationDays: 5,
    simpleDurationUnit: "days",
  };
}

export function createActionToSectionState(
  action: RevisionRampCreateAction,
): RampSectionState {
  const endPatch = reconstructUIEndPatch(action.endActions);
  const uiSteps = action.steps.map(reconstructUIStep);
  const isSimple = stepsMatchSimplePattern(uiSteps, endPatch);
  const firstStep = uiSteps[0];
  return {
    mode: "create",
    name: action.name ?? "",
    startDate: action.startDate ? new Date(action.startDate).toISOString() : "",
    steps: uiSteps,
    endScheduleAt: action.cutoffDate
      ? new Date(action.cutoffDate).toISOString()
      : "",
    endPatch,
    linkedRampId: "",
    endAdditionalEffectsOpen:
      VALID_STEP_FIELDS.some((f) => endPatch[f] !== undefined) ||
      (endPatch.coverage !== undefined && endPatch.coverage !== 100),
    cutoffDate: action.cutoffDate
      ? new Date(action.cutoffDate).toISOString()
      : "",
    lockFeature: action.lockdownConfig?.mode === "locked",
    builderMode: isSimple ? "simple" : "advanced",
    monitoring: action.monitoringConfig
      ? {
          datasourceId: action.monitoringConfig.datasourceId,
          exposureQueryId: action.monitoringConfig.exposureQueryId,
          guardrailMetricIds: [...action.monitoringConfig.guardrailMetricIds],
          signalMetricIds: [...(action.monitoringConfig.signalMetricIds ?? [])],
          updateScheduleMinutes:
            action.monitoringConfig.updateScheduleMinutes ?? null,
          srmAction: action.monitoringConfig.srmAction,
          noTrafficAction: action.monitoringConfig.noTrafficAction,
          multipleExposureAction:
            action.monitoringConfig.multipleExposureAction,
        }
      : { ...DEFAULT_MONITORING },
    simpleDurationUnit: isSimple && firstStep ? firstStep.intervalUnit : "days",
    simpleDurationDays:
      isSimple && firstStep
        ? firstStep.intervalValue * SIMPLE_COVERAGES.length
        : 7,
  };
}

export function templateToSectionState(
  template: RampScheduleTemplateInterface,
  mode: "create" | "edit" = "create",
): RampSectionState {
  const rawEndPatch = template.endPatch;
  const endPatch: UIStepPatch = rawEndPatch
    ? reconstructUIPatch(rawEndPatch as RampStepAction["patch"])
    : { coverage: 100 };
  const mc = template.monitoringConfig;
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
    cutoffDate: "",
    lockFeature: template.lockdownConfig?.mode === "locked",
    builderMode: "advanced",
    monitoring: mc
      ? {
          datasourceId: mc.datasourceId,
          exposureQueryId: mc.exposureQueryId,
          guardrailMetricIds: mc.guardrailMetricIds,
          signalMetricIds: mc.signalMetricIds ?? [],
          updateScheduleMinutes: mc.updateScheduleMinutes ?? null,
          srmAction: mc.srmAction,
          noTrafficAction: mc.noTrafficAction,
          multipleExposureAction: mc.multipleExposureAction,
        }
      : { ...DEFAULT_MONITORING },
    simpleDurationDays: 5,
  };
}

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

  const rawEndPatch = buildPatch(state.endPatch, PLACEHOLDER_RULE);
  const { ruleId: _ruleId, enabled: _enabled, ...endPatchFields } = rawEndPatch;
  const endPatch: TemplateEndPatch =
    Object.keys(endPatchFields).length > 0
      ? (endPatchFields as TemplateEndPatch)
      : undefined!;

  const monitoringConfig = buildMonitoringConfig(state.monitoring, state.steps);

  return {
    name: state.name || "template",
    steps,
    ...(endPatch ? { endPatch } : {}),
    ...(monitoringConfig ? { monitoringConfig } : {}),
    ...(state.lockFeature
      ? { lockdownConfig: { mode: "locked" as const } }
      : {}),
  };
}
