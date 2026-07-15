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
  PiXBold,
  PiCheck,
} from "react-icons/pi";
import type {
  FeatureInterface,
  SavedGroupTargeting,
  FeaturePrerequisite,
} from "shared/types/feature";
import type { SDKAttributeSchema } from "shared/types/organization";
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
  type RevisionRampUpdateAction,
  type StepHoldConditions,
  isReadyForApproval,
  resolveStartApproval,
  DEFAULT_NO_TRAFFIC_GRACE_PERIOD_HOURS,
} from "shared/validators";
import { date as formatDate } from "shared/dates";
import { parsePlainJSONObject } from "shared/util";
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
import LoadingSpinner from "@/components/LoadingSpinner";
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
import { SparsePatchIndicator } from "@/components/Features/SparsePatchToggle";
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
import { allConnectionsSupportBucketingV2 } from "@/components/Experiment/HashVersionSelector";
import useSDKConnections from "@/hooks/useSDKConnections";
import { RolloutHashingOptions } from "@/components/Features/RolloutPercentInput";
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
  noTrafficGracePeriodHours: number | null;
  multipleExposureAction?: "warn" | "hold" | "rollback";
}

export interface RampSectionState {
  mode: RampMode;
  name: string;
  // ISO datetime string. Empty means start immediately.
  startDate: string;
  // When true, the ramp holds at the start (rule disabled, zero traffic) until
  // a human approves. Mutually exclusive with startDate in the UI (the Start
  // selector is enum-like), but stored as a boolean so it can compose.
  requiresStartApproval: boolean;
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
  noTrafficGracePeriodHours: null,
};

const UNIT_MULT: Record<IntervalUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

function bestUnitFromSeconds(seconds: number): {
  value: number;
  unit: IntervalUnit;
} {
  const round2 = (v: number) => Math.round(v * 100) / 100;
  if (seconds >= 96 * 3600) {
    return { value: round2(seconds / 86400), unit: "days" };
  }
  if (seconds >= 3600) {
    return { value: round2(seconds / 3600), unit: "hours" };
  }
  return { value: round2(seconds / 60), unit: "minutes" };
}

const SIMPLE_COVERAGES = [1, 5, 10, 25, 50];
// Each ramp step (non-last) gets this fraction of total duration; last step gets the rest.
const SIMPLE_RAMP_FRACTION = 0.1;

export function generateSimpleSteps(
  duration: number,
  unit: IntervalUnit = "hours",
): UIStep[] {
  return generateSimpleStepsFromSeconds(duration * UNIT_MULT[unit]);
}

function generateSimpleStepsFromSeconds(totalSeconds: number): UIStep[] {
  const rampCount = SIMPLE_COVERAGES.length - 1;
  const rampSeconds = Math.max(
    60,
    Math.round(totalSeconds * SIMPLE_RAMP_FRACTION),
  );
  const holdSeconds = Math.max(60, totalSeconds - rampCount * rampSeconds);

  return SIMPLE_COVERAGES.map((cov, i) => {
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
      monitored: false,
    };
  });
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
  const totalSeconds = steps.reduce(
    (sum, s) => sum + s.intervalValue * UNIT_MULT[s.intervalUnit],
    0,
  );
  const expectedSimpleSteps = generateSimpleStepsFromSeconds(totalSeconds).map(
    (s) => ({
      ...s,
      monitored: firstStep.monitored,
      holdConditions: firstStep.holdConditions,
    }),
  );
  const normalizeSimpleStep = (s: UIStep) => ({
    triggerType: s.triggerType,
    intervalSeconds: s.intervalValue * UNIT_MULT[s.intervalUnit],
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
  steps: {
    interval: number | null;
    holdConditions?: StepHoldConditions;
  }[],
): string {
  const count = steps.length;
  const approvals = steps.filter(
    (s) => !!s.holdConditions?.requiresApproval,
  ).length;
  const parts = [`${count} step${count !== 1 ? "s" : ""}`];
  if (approvals)
    parts.push(`${approvals} approval${approvals !== 1 ? "s" : ""}`);
  return parts.join(", ");
}

// A template is "monitored" if it carries monitoring config or any monitored
// step. Used to keep auto-selected defaults aligned with the rule's release
// strategy (plain Ramp-up vs Monitored Ramp-up).
export function isMonitoredTemplate(
  t: Pick<RampScheduleTemplateInterface, "monitoringConfig" | "steps">,
): boolean {
  return !!t.monitoringConfig || t.steps.some((s) => s.monitored);
}

const COL = {
  num: 30, // "1" / "2" / "start" / "end"
  trigger: 175, // trigger type select
  duration: 200, // trigger details (interval inputs, datetime, "Awaiting approval")
  coverage: 80, // [number] %
} as const;

function isEmptyConditionValue(value: string | null | undefined): boolean {
  if ((value ?? null) === null) return true;
  const trimmed = (value as string).trim();
  return trimmed === "" || trimmed === "{}";
}

export function buildPatch(
  patch: UIStepPatch,
  ruleId: string,
): RampStepAction["patch"] {
  const out: RampStepAction["patch"] = { ruleId };

  if (patch.coverage !== undefined) out.coverage = patch.coverage / 100;
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
      noTrafficGracePeriodHours: number | null;
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
    noTrafficGracePeriodHours: monitoring.noTrafficGracePeriodHours,
    multipleExposureAction: monitoring.multipleExposureAction,
  };
}

export function buildRampSteps(
  steps: UIStep[],
  targetId: string,
  ruleId: string,
) {
  return steps.map((s) => {
    const patch = buildPatch(s.patch, ruleId);
    const hasInterval = s.triggerType === "interval";
    // Pure approval steps always emit `requiresApproval: true` in
    // holdConditions; composite (interval + approval) preserves any
    // user-configured approval flag.
    const approvalRequired =
      !hasInterval || !!s.holdConditions?.requiresApproval;
    const mergedHoldConditions: StepHoldConditions | undefined = (() => {
      const base = s.holdConditions ?? {};
      const merged: StepHoldConditions = {
        ...base,
        ...(approvalRequired ? { requiresApproval: true } : {}),
      };
      if (!s.monitored) delete merged.minSampleSize;
      return Object.keys(merged).length > 0 ? merged : undefined;
    })();
    return {
      interval: hasInterval
        ? Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit]
        : null,
      actions: [{ targetType: "feature-rule" as const, targetId, patch }],
      ...(approvalRequired && s.approvalNotes
        ? { approvalNotes: s.approvalNotes }
        : {}),
      monitored: !!s.monitored,
      ...(mergedHoldConditions && (s.monitored || approvalRequired)
        ? { holdConditions: mergedHoldConditions }
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
    if (step.interval !== null) {
      totalSeconds += step.interval;
    }
    if (step.holdConditions?.requiresApproval) {
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

function NoTrafficGracePopoverContent({
  initialValue,
  onSave,
  onClose,
}: {
  initialValue?: number | null;
  onSave: (value: number | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(
    (initialValue ?? null) !== null ? String(initialValue) : "",
  );

  const save = () => {
    const val = parseFloat(draft);
    onSave(val && val > 0 ? Math.floor(val * 100) / 100 : null);
    onClose();
  };

  return (
    <Flex direction="column" gap="3" style={{ width: 210 }}>
      <Text weight="medium" size="medium">
        No-traffic grace period
      </Text>
      <Text as="span" size="small" color="text-mid">
        Wait before checking for no traffic. Empty defaults to{" "}
        {DEFAULT_NO_TRAFFIC_GRACE_PERIOD_HOURS}h.
      </Text>
      <Field
        type="number"
        step="any"
        placeholder={`${DEFAULT_NO_TRAFFIC_GRACE_PERIOD_HOURS} (default)`}
        autoFocus
        append="hours"
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
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={save}>
          Done
        </Button>
      </Flex>
    </Flex>
  );
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
    (initialValue ?? null) !== null ? String(initialValue) : "",
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
  // Prefetched by the parent so templates are resolved before this mounts;
  // falls back to the local fetch when absent.
  preloadedTemplates?: RampScheduleTemplateInterface[];
  // Shows pending removal before the draft is saved.
  pendingDetach?: boolean;
  // Hash attribute + seed — shown below date controls when ramp has coverage steps.
  hashAttribute?: string;
  setHashAttribute?: (v: string) => void;
  seed?: string;
  setSeed?: (v: string) => void;
  hashVersion?: 1 | 2;
  setHashVersion?: (v: 1 | 2) => void;
  attributeSchema?: SDKAttributeSchema;
  ruleId?: string;
  featureId?: string;
  // Whether the parent rule is a sparse patch. The ramp's value edits inherit
  // this — sparse interpretation belongs to the rule, not the schedule.
  sparse?: boolean;
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
  preloadedTemplates,
  pendingDetach = false,
  hashAttribute,
  setHashAttribute,
  seed,
  setSeed,
  hashVersion,
  setHashVersion,
  attributeSchema,
  ruleId,
  featureId,
  sparse = false,
}: Props) {
  const [open, setOpen] = useState(embedded || state.mode !== "off");
  const [seedOpen, setSeedOpen] = useState(
    // Mirror RolloutPercentInput: for new schedules (ruleRampSchedule===undefined),
    // v1 is just the org-safe default — don't expand unless the user has
    // actively set a custom seed or there's an SDK compatibility warning.
    // Only auto-expand for v1 when editing an existing schedule that already uses it.
    !!seed ||
      (!!ruleRampSchedule && hashVersion !== undefined && hashVersion !== 2),
  );

  const { data: sdkConnectionsData } = useSDKConnections();
  const hashVersionSdkWarning =
    hashVersion === 2 &&
    !allConnectionsSupportBucketingV2(
      sdkConnectionsData?.connections,
      feature?.project,
    );

  useEffect(() => {
    if (hashVersionSdkWarning) setSeedOpen(true);
  }, [hashVersionSdkWarning]);

  const [openMenuIndex, setOpenMenuIndex] = useState<number | "end" | null>(
    null,
  );
  const [minSamplePopoverIndex, setMinSamplePopoverIndex] = useState<
    number | null
  >(null);
  const [noTrafficGraceOpen, setNoTrafficGraceOpen] = useState(false);
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
  // Prefer the parent's prefetched list; fall back to the local request.
  const templatesLoaded =
    preloadedTemplates !== undefined || templatesData !== undefined;
  const templates =
    templatesData?.rampScheduleTemplates ?? preloadedTemplates ?? [];

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [presetOpen, setPresetOpen] = useState(false);
  const hasAutoSelected = useRef(false);
  // True once the initial preset auto-select has run; gates the step editor and
  // the monitoring-default effects until then.
  const [autoSelectDone, setAutoSelectDone] = useState(false);
  // The monitored-ness reflected by the last selection sync, so we can detect a
  // strategy flip that bypassed `patchState` (e.g. a page-1 release-strategy
  // switch reseeds the parent state directly).
  const lastSyncedMonitored = useRef<boolean | null>(null);

  useEffect(() => {
    // Wait for templates to resolve (an empty list is still "loaded").
    if (!templatesLoaded) return;
    const stateMonitored = state.steps.some((s) => s.monitored);

    // Initial load: adopt an exact match, or pre-apply the first official
    // template matching the chosen release strategy for a brand-new ramp.
    if (!hasAutoSelected.current) {
      hasAutoSelected.current = true;
      lastSyncedMonitored.current = stateMonitored;
      const matchId = findMatchingTemplate(state, templates);
      if (matchId) {
        // findMatchingTemplate compares a lossy projection (it ignores `force`
        // and conditionally-dropped step fields), so a match doesn't guarantee
        // the rendered steps equal the template. For a brand-new ramp, apply the
        // matched template so the displayed steps actually reflect the preset
        // (otherwise the dropdown shows it while the basic default steps remain).
        // For an existing schedule, only reflect the selection — its
        // reconstructed steps are the source of truth and must not be overwritten.
        const matched = templates.find((t) => t.id === matchId);
        if (matched && !ruleRampSchedule && !hideTemplateSave) {
          applyTemplate(matched);
        } else {
          setSelectedTemplateId(matchId);
        }
      } else if (!ruleRampSchedule && !hideTemplateSave) {
        const defaultTemplate = templates.find(
          (t) => t.official && isMonitoredTemplate(t) === stateMonitored,
        );
        if (defaultTemplate) applyTemplate(defaultTemplate);
      }
      setAutoSelectDone(true);
      return;
    }

    // After init, a strategy flip that didn't go through `patchState` (a page-1
    // switch reseeds steps directly) re-syncs the selection to an exact match or
    // none/custom — never re-applies a default, so a customized ramp is never
    // clobbered. In-editor edits/toggles are handled by `patchState`.
    if (lastSyncedMonitored.current !== stateMonitored) {
      lastSyncedMonitored.current = stateMonitored;
      setSelectedTemplateId(findMatchingTemplate(state, templates));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templatesLoaded, state.steps]);

  // A brand-new ramp hides the step editor until auto-select applies its preset,
  // so the basic default never flashes.
  const awaitingTemplateAutoSelect =
    !ruleRampSchedule && !hideTemplateSave && !autoSelectDone;

  // Derive monitoring cadence from step durations, unless already set. Gated on
  // autoSelectDone: running before the preset is applied lets patchState's
  // whole-state merge clobber the applied steps from a stale closure.
  useEffect(() => {
    if (!autoSelectDone) return;
    if (state.builderMode !== "simple") return;
    if (state.monitoring.updateScheduleMinutes !== null) return;
    const overrides = deriveMonitoringOverrides(state.steps);
    if (
      overrides.updateScheduleMinutes === null &&
      overrides.noTrafficGracePeriodHours === null
    )
      return;
    patchState({
      monitoring: { ...state.monitoring, ...overrides },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSelectDone]);

  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  function patchState(partial: Partial<RampSectionState>) {
    const newState = { ...state, ...partial };
    // Any edit that ejects from the selected template re-syncs the selection to
    // an exact template match or none/custom — it never pulls in a default, so a
    // customized ramp (e.g. after toggling monitored) is preserved.
    const match = findMatchingTemplate(newState, templates);
    if (match !== selectedTemplateId) {
      setSelectedTemplateId(match);
      lastSyncedMonitored.current = newState.steps.some((s) => s.monitored);
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
    patchState({
      steps: newSteps,
      monitoring: {
        ...state.monitoring,
        ...deriveMonitoringOverrides(newSteps),
      },
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
    !["running", "conflict"].includes(ruleRampSchedule.status);
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

      if (isReadyForApproval(ruleRampSchedule)) {
        return {
          borderColor: "var(--yellow-9)",
          textColor: "var(--yellow-11)",
          tooltip:
            "Pending approval: ramp is waiting for manual approval on this step.",
        };
      }

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
          <Box mb="3">
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
          <Box mb="3">
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
          <Box mb="3">
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
              <Flex align="center" gap="2">
                <Text as="div" weight="semibold">
                  Default value
                </Text>
                {sparse &&
                  feature.valueType === "json" &&
                  parsePlainJSONObject(feature.defaultValue) !== null && (
                    <SparsePatchIndicator />
                  )}
              </Flex>
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
              sparse={sparse}
              condensed
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

      const hasHoldConditions =
        (step?.monitored &&
          (step?.holdConditions?.minSampleSize ?? null) !== null) ||
        // requiresApproval is only a secondary "Then:" condition when there's
        // also an interval — when triggerType === "approval" it IS the primary
        // action and is already shown as the step label.
        (step?.triggerType !== "approval" &&
          step?.holdConditions?.requiresApproval);

      if (!rows.length && !hasHoldConditions) return null;

      return (
        <Box mt="1" pr="2" style={{ paddingLeft: subRowIndent }}>
          <Flex direction="column" gap="1">
            {hasHoldConditions && (
              <Flex direction="column" gap="1">
                <Text as="div" size="small" weight="medium" color="text-low">
                  {step?.triggerType === "approval" ? "Also:" : "Then:"}
                </Text>
                <Flex direction="column" gap="1" style={{ paddingLeft: 12 }}>
                  {step?.triggerType !== "approval" &&
                    step?.holdConditions?.requiresApproval && (
                      <Flex wrap="wrap" gap="2" align="baseline">
                        <Text size="small" weight="medium">
                          Hold for approval
                        </Text>
                        {step?.approvalNotes?.trim() && (
                          <Text size="small" color="text-low">
                            {step.approvalNotes.trim()}
                          </Text>
                        )}
                      </Flex>
                    )}
                  {step?.monitored &&
                    (step?.holdConditions?.minSampleSize ?? null) !== null && (
                      <Flex wrap="wrap" gap="2" align="baseline">
                        <Text size="small" weight="medium">
                          Hold for min. sample
                        </Text>
                        <Text size="small" color="text-low">
                          {step!.holdConditions!.minSampleSize!.toLocaleString()}
                        </Text>
                      </Flex>
                    )}
                </Flex>
              </Flex>
            )}
            {rows.map((row, index) => (
              <Box
                key={`readonly-effect-row-${index}`}
                px="2"
                py="2"
                mt={index === 0 && hasHoldConditions ? "2" : undefined}
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
                    flexGrow="1"
                    style={
                      step.triggerType === "approval"
                        ? { flex: 1, minWidth: COL.trigger }
                        : {
                            width: COL.trigger + COL.duration + 80,
                            flexShrink: 0,
                          }
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
                                label: "Hold for",
                                tooltip:
                                  "Apply this step's effects, then hold for the interval before advancing",
                              },
                              {
                                value: "approval",
                                label: "Hold for approval",
                                tooltip:
                                  "Apply this step's effects, then hold for manual approval before advancing",
                              },
                            ]}
                            onChange={(v) => {
                              const next = v as "interval" | "approval";
                              const update: Partial<UIStep> = {
                                triggerType: next,
                              };
                              if (next === "approval") {
                                // Dropping the interval; approval is now the
                                // only gate so requiresApproval moves into the
                                // top-level approval step (holdConditions not
                                // needed). Show notes if the user had already
                                // typed something.
                                update.holdConditions = {
                                  ...step.holdConditions,
                                  requiresApproval: undefined,
                                };
                                update.notesOpen = !!step.approvalNotes?.trim();
                              } else {
                                // Adding an interval to a pure-approval step.
                                // Carry the approval gate over so the "Then:"
                                // section and any notes the user wrote survive.
                                update.holdConditions = {
                                  ...step.holdConditions,
                                  requiresApproval: true,
                                };
                                update.intervalValue = step.intervalValue || 10;
                                update.intervalUnit =
                                  step.intervalUnit || "minutes";
                              }
                              updateStep(i, update);
                            }}
                            className="select-unfixed"
                            containerStyle={{ minHeight: 38 }}
                            useMultilineLabels
                            formatOptionLabel={(option, meta) => {
                              if (meta.context === "value")
                                return <>{option.label}</>;
                              return (
                                <div>
                                  <div>
                                    {option.value === "interval"
                                      ? "Hold for time"
                                      : option.label}
                                  </div>
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
                              min="0"
                              step="any"
                              onFocus={(e) => e.target.select()}
                              value={String(step.intervalValue)}
                              onChange={(e) =>
                                updateStep(i, {
                                  intervalValue:
                                    parseFloat(e.target.value) || 0,
                                })
                              }
                              onBlur={(e) =>
                                updateStep(i, {
                                  intervalValue: Math.max(
                                    0.01,
                                    Math.floor(
                                      (parseFloat(e.target.value) || 0.01) *
                                        100,
                                    ) / 100,
                                  ),
                                })
                              }
                              containerStyle={{ width: 75, flexShrink: 0 }}
                              errorLevel={
                                isStepBelowCadence(step) ? "warning" : undefined
                              }
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
                                  updateStep(i, {
                                    intervalUnit: v as IntervalUnit,
                                  })
                                }
                                className="select-unfixed"
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
                                    updateStep(i, {
                                      approvalNotes: e.target.value,
                                    })
                                  }
                                  style={{ minHeight: 38 }}
                                />
                              </Box>
                            )}
                          </Flex>
                        )}
                      </>
                    )}
                  </Flex>

                  <Flex align="center" gap="2" pr="3" style={{ flexShrink: 0 }}>
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
                              <MonitoredIcon size={18} />
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
                                {(step.monitored ||
                                  step.triggerType === "interval" ||
                                  step.triggerType === "approval") && (
                                  <>
                                    <DropdownMenuGroup label="Hold conditions">
                                      {step.monitored && (
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setOpenMenuIndex(null);
                                            setMinSamplePopoverIndex(i);
                                          }}
                                        >
                                          <Flex
                                            align="center"
                                            gap="2"
                                            justify="between"
                                            style={{ flex: 1 }}
                                          >
                                            <Flex
                                              align="center"
                                              gap="1"
                                              asChild
                                            >
                                              <span>
                                                {(step.holdConditions
                                                  ?.minSampleSize ?? null) !==
                                                  null && <PiCheck size={16} />}
                                                Minimum sample size
                                              </span>
                                            </Flex>
                                            <Box
                                              style={{
                                                opacity: 0.35,
                                                lineHeight: 0,
                                              }}
                                            >
                                              <MonitoredIcon size={16} />
                                            </Box>
                                          </Flex>
                                        </DropdownMenuItem>
                                      )}
                                      {step.triggerType === "interval" && (
                                        <DropdownMenuItem
                                          onClick={() => {
                                            const turningOn =
                                              !step.holdConditions
                                                ?.requiresApproval;
                                            setOpenMenuIndex(null);
                                            updateStep(i, {
                                              holdConditions: {
                                                ...step.holdConditions,
                                                requiresApproval: turningOn,
                                              },
                                              // Always start with notes hidden
                                              // behind "+Add notes" trigger when
                                              // enabling; clear when disabling.
                                              notesOpen: false,
                                              approvalNotes: turningOn
                                                ? step.approvalNotes
                                                : "",
                                            });
                                          }}
                                        >
                                          <Flex align="center" gap="1">
                                            {step.holdConditions
                                              ?.requiresApproval && (
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
                                              intervalValue: 10,
                                              intervalUnit: "minutes",
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

                {!isReadOnlyView &&
                  (step.holdConditions?.requiresApproval ||
                    (step.monitored &&
                      (step.holdConditions?.minSampleSize ?? null) !==
                        null)) && (
                    <Flex
                      direction="column"
                      gap="1"
                      mt="2"
                      style={{
                        paddingLeft: COL.num + 16 + COL.coverage + 16,
                      }}
                    >
                      <Text color="text-low" weight="medium">
                        {step.triggerType === "approval" ? "Also:" : "Then:"}
                      </Text>

                      {step.holdConditions?.requiresApproval &&
                        step.triggerType !== "approval" && (
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

                      {step.monitored &&
                        (step.holdConditions?.minSampleSize ?? null) !==
                          null && (
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

        {minSamplePopoverIndex !== null &&
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
    const mergedSteps = newState.steps.map((s, i) => ({
      ...s,
      patch: mergeForce(s.patch, state.steps[i]?.patch ?? {}),
    }));
    setState({
      ...newState,
      mode: resolvedMode,
      builderMode: "advanced",
      linkedRampId: state.linkedRampId,
      startDate: state.startDate,
      endPatch: mergeForce(newState.endPatch, state.endPatch),
      steps: mergedSteps,
    });
    setSelectedTemplateId(tmpl.id);
    // Mark this monitored-ness as synced so the selection-sync effect treats the
    // apply as explicit and doesn't re-derive the selection to "none".
    lastSyncedMonitored.current = mergedSteps.some((s) => s.monitored);
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
    lastSyncedMonitored.current = fresh.steps.some((s) => s.monitored);
  };

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
            (templates.length === 0 ? "No templates" : "None")}
        </span>
      </Flex>
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

  function deriveMonitoringOverrides(steps: UIStep[]): {
    updateScheduleMinutes: number | null;
    noTrafficGracePeriodHours: number | null;
  } {
    const intervalSteps = steps.filter((s) => s.triggerType === "interval");
    if (intervalSteps.length === 0) {
      return { updateScheduleMinutes: null, noTrafficGracePeriodHours: null };
    }
    const minStepSeconds = Math.min(
      ...intervalSteps.map(
        (s) => Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit],
      ),
    );
    const s = settings?.updateSchedule;
    const orgCadenceSeconds =
      s?.type === "stale" && s.hours ? s.hours * 3600 : 6 * 3600;

    const updateScheduleMinutes =
      minStepSeconds < orgCadenceSeconds
        ? Math.max(10, Math.floor(minStepSeconds / 60))
        : null;

    const effectiveCadenceHours =
      updateScheduleMinutes !== null
        ? updateScheduleMinutes / 60
        : orgCadenceSeconds / 3600;
    const gracePeriodHours = Math.max(
      Math.min(24, minStepSeconds / 7200),
      effectiveCadenceHours,
    );
    // Only override if different from default 24h — avoids a no-op override.
    const noTrafficGracePeriodHours =
      gracePeriodHours < 24 ? Math.floor(gracePeriodHours * 100) / 100 : null;

    if (updateScheduleMinutes !== null) {
      setShowAdvancedMonitoring(true);
    }

    return { updateScheduleMinutes, noTrafficGracePeriodHours };
  }

  function handleSimpleDurationChange(duration: number, unit?: IntervalUnit) {
    const d = Math.max(0.01, duration);
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
      monitoring: {
        ...state.monitoring,
        ...deriveMonitoringOverrides(steps),
      },
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
      state.monitoring.updateScheduleMinutes !== null &&
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
      Math.max(1, step.intervalValue) * UNIT_MULT[step.intervalUnit] <
      effectiveCadenceSeconds
    );
  }

  const anyCadenceWarning = useMemo(() => {
    if (!effectiveCadenceSeconds) return false;
    if (state.builderMode === "simple") {
      const unit = state.simpleDurationUnit ?? "days";
      const simpleSteps = generateSimpleSteps(state.simpleDurationDays, unit);
      const minStepSeconds = Math.min(
        ...simpleSteps.map((s) => s.intervalValue * UNIT_MULT[s.intervalUnit]),
      );
      return minStepSeconds < effectiveCadenceSeconds;
    }
    return state.steps.some(
      (s) =>
        s.monitored &&
        s.triggerType === "interval" &&
        Math.max(1, s.intervalValue) * UNIT_MULT[s.intervalUnit] <
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
    (state.monitoring.updateScheduleMinutes !== null &&
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
            Automatically roll back and disable the rule if any of these metrics
            show a significant regression.
          </Text>
          <MetricsSelector
            datasource={state.monitoring.datasourceId}
            exposureQueryId={state.monitoring.exposureQueryId}
            project={feature.project ?? ""}
            includeFacts
            includeGroups
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
            Pause at the current step while any of these metrics show a
            significant regression. Can be resumed manually or automatically
            when recovered.
          </Text>
          <MetricsSelector
            datasource={state.monitoring.datasourceId}
            exposureQueryId={state.monitoring.exposureQueryId}
            project={feature.project ?? ""}
            includeFacts
            includeGroups
            selected={state.monitoring.signalMetricIds}
            disabled={!state.monitoring.exposureQueryId}
            onChange={(v) => patchMonitoring({ signalMetricIds: v })}
          />
        </Box>

        <Link
          className="font-weight-bold mt-2"
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
        </Link>
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
                max={168}
                value={
                  state.monitoring.updateScheduleMinutes !== null
                    ? String(
                        Math.floor(
                          (state.monitoring.updateScheduleMinutes / 60) * 100,
                        ) / 100,
                      )
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
                    // min 10 minutes (≈0.1667h), max 168h; stored in minutes
                    const clamped = Math.max(10 / 60, Math.min(168, v));
                    patchMonitoring({
                      updateScheduleMinutes: Math.round(clamped * 60),
                    });
                  }
                }}
                helpText={`Blank = org default (${orgCadenceLabel})`}
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
              <Text as="span" weight="medium">
                {"If no traffic ("}
                <Popover
                  open={noTrafficGraceOpen}
                  onOpenChange={setNoTrafficGraceOpen}
                  triggerAsChild
                  showArrow={false}
                  align="center"
                  side="top"
                  trigger={
                    <Link type="button" className="hover-underline">
                      {state.monitoring.noTrafficGracePeriodHours !== null
                        ? `${state.monitoring.noTrafficGracePeriodHours}h`
                        : `${DEFAULT_NO_TRAFFIC_GRACE_PERIOD_HOURS}h`}
                    </Link>
                  }
                  content={
                    <NoTrafficGracePopoverContent
                      initialValue={state.monitoring.noTrafficGracePeriodHours}
                      onSave={(val) =>
                        patchMonitoring({ noTrafficGracePeriodHours: val })
                      }
                      onClose={() => setNoTrafficGraceOpen(false)}
                    />
                  }
                  contentStyle={{ padding: "12px 16px" }}
                />
                {"):"}
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

  const hasCustomizedSteps = useMemo(() => {
    return !stepsMatchSimplePattern(state.steps, state.endPatch);
  }, [state.steps, state.endPatch]);

  const hasSafeRolloutFeature = hasCommercialFeature("safe-rollout");

  const allMonitored =
    state.steps.length > 0 && state.steps.every((s) => s.monitored);
  const noneMonitored = state.steps.every((s) => !s.monitored);

  useEffect(() => {
    // Gated like the cadence effect above, for the same stale-closure reason.
    if (!autoSelectDone) return;
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
  }, [autoSelectDone, noneMonitored, state.monitoring.datasourceId]);
  const monitorCheckboxValue: boolean | "indeterminate" = allMonitored
    ? true
    : noneMonitored
      ? false
      : "indeterminate";
  const showMonitoringConfig = !noneMonitored;

  function handleMonitorToggle(checked: boolean) {
    const newSteps = state.steps.map((s) => {
      const updated = { ...s, monitored: checked };
      if (checked && (s.patch.coverage ?? 0) === 0) {
        updated.patch = { ...s.patch, coverage: 1 };
      }
      return updated;
    });
    patchState({
      steps: newSteps,
      monitoring: {
        ...state.monitoring,
        ...deriveMonitoringOverrides(newSteps),
      },
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
        <Box mb="4" px="5" pt="3" pb="4" className="bg-highlight rounded">
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
            .sort((a, b) => a.order - b.order)
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
                    <Flex align="center" gap="2" style={{ flexShrink: 0 }}>
                      <Text as="span" size="small" color="text-low">
                        {formatRampStepSummary(t.steps)}
                      </Text>
                      {/* Fixed-width slot keeps the icon column aligned across
                          rows (empty for non-monitored templates). */}
                      <Box
                        style={{
                          width: 16,
                          flexShrink: 0,
                          display: "flex",
                          justifyContent: "center",
                        }}
                      >
                        {isMonitoredTemplate(t) && <MonitoredIcon size={16} />}
                      </Box>
                    </Flex>
                  </Flex>
                </DropdownMenuItem>
              </React.Fragment>
            ))}
        </DropdownMenu>
        <Separator size="4" mt="5" />
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
            min="0"
            step="any"
            value={state.simpleDurationDays}
            onFocus={(e) => e.target.select()}
            onChange={(e) =>
              handleSimpleDurationChange(parseFloat(e.target.value) || 0)
            }
            onBlur={() =>
              handleSimpleDurationChange(
                Math.max(0.01, state.simpleDurationDays),
              )
            }
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

  const cutoffInput = !state.cutoffDate ? (
    <Box display="inline-block">
      <Link
        type="button"
        className="hover-underline"
        onClick={() => {
          const d = new Date();
          d.setDate(d.getDate() + 14);
          d.setSeconds(0, 0);
          patchState({ cutoffDate: d.toISOString() });
        }}
      >
        <PiPlusBold className="mr-1" />
        Disable on date
        <Tooltip
          body={
            <Text as="div">
              Automatically disables the rule on this date, whether or not the
              ramp-up has finished.
            </Text>
          }
        >
          <PiInfo color="var(--color-text-low)" className="ml-1" />
        </Tooltip>
      </Link>
    </Box>
  ) : (
    <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
      <Box style={{ width: 70 }}>
        <Flex align="center" gap="1">
          <Text as="label" weight="medium" mb="0">
            Disable
          </Text>
          <Tooltip
            body={
              <Text as="div">
                Automatically disables the rule on this date, whether or not the
                ramp-up has finished.
              </Text>
            }
          >
            <PiInfo color="var(--color-text-low)" />
          </Tooltip>
        </Flex>
      </Box>
      <DatePicker
        date={state.cutoffDate}
        setDate={(d) => patchState({ cutoffDate: d ? d.toISOString() : "" })}
        precision="datetime"
        disableBefore={new Date().toISOString()}
      />
      <IconButton
        variant="ghost"
        color="gray"
        size="2"
        radius="full"
        onClick={() => patchState({ cutoffDate: "" })}
      >
        <PiXBold />
      </IconButton>
    </Flex>
  );

  const customizeLink =
    !hasTemplate && isSimpleMode ? (
      <Box mb="4">
        {(() => {
          const coverageSteps = state.steps
            .map((s) => s.patch.coverage)
            .filter((c): c is number => c !== undefined);
          const finalCoverage = state.endPatch.coverage ?? 100;
          const progression =
            coverageSteps.length > 0
              ? [
                  "0%",
                  ...coverageSteps.map((c) => `${c}%`),
                  `${finalCoverage}%`,
                ].join(" → ")
              : null;
          return (
            <>
              {progression && (
                <Flex align="center" justify="between" mb="2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      patchState({ builderMode: "advanced" });
                      setSelectedTemplateId("");
                    }}
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
              )}
              {!progression && (
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
                  Edit Ramp-up Steps
                </Button>
              )}
            </>
          );
        })()}
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
        value={
          state.requiresStartApproval
            ? "on-approval"
            : state.startDate
              ? "on-date"
              : "immediately"
        }
        options={[
          { value: "immediately", label: "Immediately" },
          { value: "on-date", label: "On date" },
          { value: "on-approval", label: "On approval" },
        ]}
        onChange={(v) => {
          // Enum-like: each choice clears the other axis so the two never
          // coexist from the UI (the model still allows composing them).
          if (v === "immediately") {
            patchState({ startDate: "", requiresStartApproval: false });
          } else if (v === "on-approval") {
            patchState({ startDate: "", requiresStartApproval: true });
          } else {
            const d = new Date();
            d.setSeconds(0, 0);
            patchState({
              startDate: d.toISOString(),
              requiresStartApproval: false,
            });
          }
        }}
        containerStyle={{ minHeight: 38, width: 150 }}
      />
      {state.startDate && (
        <DatePicker
          date={state.startDate || undefined}
          setDate={(d) => patchState({ startDate: d ? d.toISOString() : "" })}
          precision="datetime"
        />
      )}
    </Flex>
  ) : null;

  const simplifyLink =
    showAdvancedEditor && !hasTemplate ? (
      <Box mb="3">
        <Tooltip
          body="Will erase any customizations you have made"
          shouldDisplay={hasCustomizedSteps}
          tipPosition="top"
        >
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

          const formatActionLabel = (
            action: "warn" | "hold" | "rollback" | undefined,
          ) =>
            action === "rollback"
              ? "Roll back"
              : action === "warn"
                ? "Warn only"
                : "Hold step (default)";

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
                {hashAttribute && (
                  <ReadOnlySettingRow label="Sample by">
                    {hashAttribute}
                  </ReadOnlySettingRow>
                )}
                {(seed || hashVersion === 1) && (
                  <>
                    {seed && (
                      <ReadOnlySettingRow label="Seed">
                        {seed}
                      </ReadOnlySettingRow>
                    )}
                    <ReadOnlySettingRow label="Hashing">
                      {hashVersion === 1 ? "V1 (Legacy)" : "V2 (Preferred)"}
                    </ReadOnlySettingRow>
                  </>
                )}
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
                    <ReadOnlySettingRow label="SRM detected">
                      {formatActionLabel(monitoringConfig.srmAction)}
                    </ReadOnlySettingRow>
                    <ReadOnlySettingRow label="No traffic">
                      {formatActionLabel(monitoringConfig.noTrafficAction)}
                      {(monitoringConfig.noTrafficGracePeriodHours ?? null) !==
                        null && (
                        <Text size="small" color="text-low" ml="1">
                          ({monitoringConfig.noTrafficGracePeriodHours}h grace)
                        </Text>
                      )}
                    </ReadOnlySettingRow>
                    <ReadOnlySettingRow label="Multiple exposures">
                      {formatActionLabel(
                        monitoringConfig.multipleExposureAction,
                      )}
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
      {hasRampSchedulesFeature && !hideTemplateSave && (
        <>
          <Text as="div" weight="semibold" mb="1">
            Template
          </Text>
          {!isReadOnlyView && (
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
          )}
        </>
      )}
      {templateDropdown}

      <Flex direction="column" gap="1" mb="4">
        {startInput}
        {durationInput}
        {!hideTemplateSave && cutoffInput}

        {setHashAttribute &&
          attributeSchema &&
          state.steps.some((s) => s.patch.coverage !== undefined) && (
            <Box mt="5" mb="4">
              <RolloutHashingOptions
                open={seedOpen}
                setOpen={setSeedOpen}
                seed={seed ?? ""}
                setSeed={setSeed ?? (() => {})}
                ruleId={ruleId}
                featureId={featureId}
                isLive={!!ruleRampSchedule}
                hashAttribute={hashAttribute}
                setHashAttribute={setHashAttribute}
                attributeSchema={attributeSchema}
                hasHashAttributes={true}
                hashVersion={hashVersion}
                setHashVersion={setHashVersion}
                project={feature?.project}
              />
            </Box>
          )}

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
                pendingDetach ? "red" : getRampBadgeColor(ruleRampSchedule)
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
      {open &&
        (awaitingTemplateAutoSelect ? (
          <Flex align="center" justify="center" py="6">
            <LoadingSpinner />
          </Flex>
        ) : (
          content
        ))}
    </Box>
  );
}

export function reconstructUIPatch(
  patch?: FeatureRulePatch | null,
): UIStepPatch {
  if (!patch) return {};
  const p: UIStepPatch = {};
  if ((patch.coverage ?? null) !== null)
    p.coverage = Math.round(patch.coverage! * 100);
  if ("condition" in patch) {
    const condition = patch.condition;
    p.condition =
      condition === null || isEmptyConditionValue(condition) ? null : condition;
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
  if ((patch.allEnvironments ?? null) !== null)
    p.allEnvironments = patch.allEnvironments ?? undefined;
  if ((patch.environments ?? null) !== null)
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
  const patch = reconstructUIPatch(step.actions[0]?.patch);
  const additionalEffectsOpen = VALID_STEP_FIELDS.some(
    (f) => patch[f] !== undefined,
  );
  // interval=null is a pure approval gate (or instant); editor mode is
  // "approval" with default placeholder timing. interval>0 is "interval"
  // mode; if it also has requiresApproval, the composite UI surfaces it
  // through holdConditions.
  if (step.interval === null) {
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
  const seconds = step.interval;
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
    approvalNotes: step.approvalNotes ?? "",
    notesOpen: !!(
      step.holdConditions?.requiresApproval && step.approvalNotes?.trim()
    ),
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
    requiresStartApproval: !!rs.requiresStartApproval,
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
          noTrafficGracePeriodHours:
            rs.monitoringConfig.noTrafficGracePeriodHours ?? null,
          multipleExposureAction: rs.monitoringConfig.multipleExposureAction,
        }
      : { ...DEFAULT_MONITORING },
    simpleDurationUnit:
      isSimple && firstStep
        ? bestUnitFromSeconds(
            uiSteps.reduce(
              (sum, s) => sum + s.intervalValue * UNIT_MULT[s.intervalUnit],
              0,
            ),
          ).unit
        : "hours",
    simpleDurationDays:
      isSimple && firstStep
        ? bestUnitFromSeconds(
            uiSteps.reduce(
              (sum, s) => sum + s.intervalValue * UNIT_MULT[s.intervalUnit],
              0,
            ),
          ).value
        : 120,
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
    requiresStartApproval: false,
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
    requiresStartApproval: !!action.requiresStartApproval,
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
          noTrafficGracePeriodHours:
            action.monitoringConfig.noTrafficGracePeriodHours ?? null,
          multipleExposureAction:
            action.monitoringConfig.multipleExposureAction,
        }
      : { ...DEFAULT_MONITORING },
    simpleDurationUnit:
      isSimple && firstStep
        ? bestUnitFromSeconds(
            uiSteps.reduce(
              (sum, s) => sum + s.intervalValue * UNIT_MULT[s.intervalUnit],
              0,
            ),
          ).unit
        : "hours",
    simpleDurationDays:
      isSimple && firstStep
        ? bestUnitFromSeconds(
            uiSteps.reduce(
              (sum, s) => sum + s.intervalValue * UNIT_MULT[s.intervalUnit],
              0,
            ),
          ).value
        : 120,
  };
}

export function updateActionToSectionState(
  action: RevisionRampUpdateAction,
  liveSchedule: RampScheduleInterface,
): RampSectionState {
  // Merge strategy: start from the live schedule as the base, then overlay
  // the pending update action's fields so that any un-changed fields retain
  // their current live values. This mirrors what createRampSchedulesForRevision
  // does on the backend when it applies an update action.
  const merged = createActionToSectionState({
    ...action,
    mode: "create",
    ruleId: action.ruleId,
  } as RevisionRampCreateAction);
  return {
    ...merged,
    mode: "edit",
    linkedRampId: liveSchedule.id,
    // Fields not included in the update action fall back to the live schedule.
    name: action.name ?? liveSchedule.name,
    requiresStartApproval: resolveStartApproval(
      action.requiresStartApproval,
      liveSchedule.requiresStartApproval,
    ),
    startDate: action.startDate
      ? new Date(action.startDate).toISOString()
      : liveSchedule.startDate
        ? new Date(liveSchedule.startDate).toISOString()
        : "",
    cutoffDate: action.cutoffDate
      ? new Date(action.cutoffDate).toISOString()
      : liveSchedule.cutoffDate
        ? new Date(liveSchedule.cutoffDate).toISOString()
        : "",
    endScheduleAt: action.cutoffDate
      ? new Date(action.cutoffDate).toISOString()
      : liveSchedule.cutoffDate
        ? new Date(liveSchedule.cutoffDate).toISOString()
        : "",
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
    // Start-gating is a per-launch decision, never stored on templates.
    requiresStartApproval: false,
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
          noTrafficGracePeriodHours: mc.noTrafficGracePeriodHours ?? null,
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
  "id" | "organization" | "dateCreated" | "dateUpdated" | "order"
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
