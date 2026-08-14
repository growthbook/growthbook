import { FormProvider, useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
  ScheduleRule,
} from "shared/types/feature";
import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import uniqId from "uniqid";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  filterEnvironmentsByFeature,
  generateVariationId,
  isProjectListValidForProject,
  getReviewSetting,
  getTargetingProjectIds,
  stemRuleId,
  parsePlainJSONObject,
  stripDefaultsForSparse,
} from "shared/util";
import { PiCaretRight } from "react-icons/pi";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { getScopedSettings } from "shared/settings";
import { getAllVariations, getLatestPhaseVariations } from "shared/experiments";
import { cloneDeep, kebabCase } from "lodash";
import { Box, Flex } from "@radix-ui/themes";
import {
  CreateSafeRolloutInterface,
  SafeRolloutInterface,
  SafeRolloutRule,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RampStepAction,
} from "shared/validators";
import {
  PostFeatureRuleBody,
  PutFeatureRuleBody,
  PutFeatureRuleConflict,
} from "shared/types/feature-rule";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import {
  NewExperimentRefRule,
  getDefaultRuleValue,
  getFeatureDefaultValue,
  useAttributeSchema,
  useEnvironments,
  validateFeatureRule,
} from "@/services/features";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import useSDKConnections from "@/hooks/useSDKConnections";
import useApi from "@/hooks/useApi";
import { allConnectionsSupportBucketingV2 } from "@/components/Experiment/HashVersionSelector";
import Modal from "@/components/Modal";
import {
  CompactInlineDiff,
  stringifyForRawDiff,
} from "@/components/Reviews/Feature/RevisionDiffUtils";
import { normalizeFeatureRules } from "@/components/Features/FeatureDiffRenders";
import { getNewExperimentDatasourceDefaults } from "@/components/Experiment/NewExperimentForm";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import RadioCards from "@/ui/RadioCards";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import PagedModal from "@/components/Modal/PagedModal";
import StandardRuleFields, {
  type ScheduleType,
  deriveScheduleType,
} from "@/components/Features/RuleModal/StandardRuleFields";
import { scheduleAutoName } from "@/components/Features/RuleModal/ScheduleInputs";
import ExperimentRefFields from "@/components/Features/RuleModal/ExperimentRefFields";
import ExperimentRefNewFields from "@/components/Features/RuleModal/ExperimentRefNewFields";
import Page from "@/components/Modal/Page";
import BanditRefFields from "@/components/Features/RuleModal/BanditRefFields";
import BanditRefNewFields from "@/components/Features/RuleModal/BanditRefNewFields";
import { useIncrementer } from "@/hooks/useIncrementer";

import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";
import { useTemplates } from "@/hooks/useTemplates";
import SafeRolloutFields from "@/components/Features/RuleModal/SafeRolloutFields";
import RampScheduleSection from "@/components/Features/RuleModal/RampScheduleSection";
import {
  type RampSectionState,
  defaultRampSectionState,
  rampScheduleToSectionState,
  createActionToSectionState,
  updateActionToSectionState,
  buildRampSteps,
  buildEndActions,
  buildMonitoringConfig,
  isRampSectionConfigured,
  getMonitoringValidationError,
  scrubRampStateForRuleType,
} from "@/components/Features/RuleModal/RampScheduleSection";

function buildRampStartActionsFromRule(
  values: FeatureRule,
  targetId: string,
  ruleId: string,
): RampStepAction[] {
  if (values.type !== "force" && values.type !== "rollout") return [];

  const ruleState = values as FeatureRule & {
    coverage?: number;
    value?: unknown;
  };
  const patch: RampStepAction["patch"] = {
    ruleId,
    coverage: ruleState.coverage ?? null,
    condition: ruleState.condition ?? null,
    savedGroups: ruleState.savedGroups ?? null,
    prerequisites: ruleState.prerequisites ?? null,
    allEnvironments: ruleState.allEnvironments ?? null,
    environments: ruleState.environments ?? null,
  };

  if ("value" in ruleState) {
    patch.force = ruleState.value;
  }

  return [
    {
      targetType: "feature-rule",
      targetId,
      patch,
    },
  ];
}

// A future-dated or approval-gated ramp publishes its rule disabled (zero
// traffic) until the schedule activates or is approved. Only applies pre-start:
// once the schedule is running the ramp owns the rule's enabled state, so a
// later edit must not re-disable a live rollout (requiresStartApproval stays set
// after start — e.g. a running 0-step approval schedule).
function shouldPublishRuleDisabled(
  ramp: Record<string, unknown> | undefined,
  existingScheduleStatus?: string,
): boolean {
  if (!ramp) return false;
  const preStart =
    existingScheduleStatus === undefined ||
    existingScheduleStatus === "pending" ||
    existingScheduleStatus === "ready";
  if (!preStart) return false;
  return (
    ("startDate" in ramp && !!ramp.startDate) ||
    ("requiresStartApproval" in ramp && !!ramp.requiresStartApproval)
  );
}
export interface Props {
  close: () => void;
  // Merged feature (base + draft changes). Use baseFeature to check live/published state.
  feature: FeatureInterface;
  // Published feature before draft changes are applied. Required so we can
  // distinguish a draft-only rule (not yet in live) from a published rule
  // being edited; falling back to `feature` here would silently mis-classify
  // draft-added rules as "live".
  baseFeature: FeatureInterface;
  setVersion: (version: number) => void;
  mutate: () => void;
  // Global flat index in `feature.rules`. Positions new rules; ignored for edit/duplicate.
  i: number;
  environment: string;
  // Required for edit/duplicate.
  ruleId?: string;
  defaultType?: string;
  mode: "create" | "edit" | "duplicate";
  safeRolloutsMap?: Map<string, SafeRolloutInterface>;
  revisionList?: MinimalFeatureRevisionInterface[];
  rampSchedules?: RampScheduleInterface[];
  detachRampOnSave?: boolean;
  draftRevision?: FeatureRevisionInterface | null;
}

type RadioSelectorRuleType =
  | "force"
  | "rollout"
  | "experiment"
  | "bandit"
  | "safe-rollout";
type OverviewRuleType =
  | "force"
  | "rollout"
  | "experiment-ref"
  | "experiment-ref-new"
  | "safe-rollout";

export type SafeRolloutRuleCreateFields = SafeRolloutRule & {
  safeRolloutFields: CreateSafeRolloutInterface;
} & {
  sameSeed?: boolean;
};

function fmtTheirValue(v: unknown): string {
  if (v === undefined) return "(removed)";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (!s) return '""';
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

// Renders a contested chunk's their-side value: the bare value for a single
// field, or a small keyed object for exclusion chunks (env/project scope).
function fmtChunkValue(rule: FeatureRule | null, fields: string[]): string {
  if (!rule) return "(removed)";
  const rec = rule as unknown as Record<string, unknown>;
  if (fields.length === 1) return fmtTheirValue(rec[fields[0]]);
  return fmtTheirValue(
    Object.fromEntries(
      fields.filter((f) => rec[f] !== undefined).map((f) => [f, rec[f]]),
    ),
  );
}

export default function RuleModal({
  close,
  feature,
  baseFeature,
  i,
  mutate,
  environment,
  ruleId,
  defaultType = "",
  setVersion,
  mode,
  safeRolloutsMap,
  revisionList = [],
  rampSchedules = [],
  detachRampOnSave,
  draftRevision,
}: Props) {
  const { hasCommercialFeature, organization } = useUser();
  const { apiCall } = useAuth();

  const attributeSchema = useAttributeSchema(false, feature.project);
  // Unfiltered org-wide schema lets validateFeatureRule distinguish between
  // truly-unknown attributes and attributes that exist but aren't scoped to
  // this project, so the client-side error wording matches the server.
  const allAttributesSchema = useAttributeSchema(false);

  const flatRules = feature.rules ?? [];
  const rule: FeatureRule | undefined = ruleId
    ? flatRules.find((r) => r.id === ruleId)
    : undefined;
  // True when this rule already exists on the published feature. We use this
  // (not `defaultValues.id`, which is also set for newly-added draft rules) to
  // decide whether scheduling against a future date should warn about
  // overriding an already-live rule's state.
  const isLiveRule =
    !!ruleId && (baseFeature.rules ?? []).some((r) => r.id === ruleId);
  const safeRollout =
    rule?.type === "safe-rollout"
      ? safeRolloutsMap?.get(rule?.safeRolloutId)
      : undefined;

  // Pre-generate a rule ID so we can reference it in the ramp schedule creation
  // without an extra round-trip. The back-end preserves a truthy id sent by the client.
  const [pregenRuleId] = useState(() => uniqId("fr_"));

  // Optimistic-concurrency pins, captured once at modal open. `feature` is
  // reactive (a publish elsewhere revalidates it and advances feature.version
  // under the open modal), so saves must target what the user actually loaded.
  // The baseline rides the PUT; the server 409s if the rule changed since.
  const [pinnedFeatureVersion] = useState(() => feature.version);
  // Mutable on purpose: after a conflict is surfaced, the baseline is rebased
  // to the other person's version. The user has seen their changes, so the
  // form becomes the resolution — the next save passes the guard (while still
  // catching any third change that lands during resolution).
  const [baselineRule, setBaselineRule] = useState<FeatureRule | undefined>(
    () => (rule ? cloneDeep(rule) : undefined),
  );
  const [conflict, setConflict] = useState<
    | (PutFeatureRuleConflict & { baseAtConflict: FeatureRule | undefined })
    | null
  >(null);
  const [showConflictDetails, setShowConflictDetails] = useState(false);
  // Fields from the conflict the user pulled into the form via "Use theirs".
  // Per-contested-chunk acknowledgment: "mine" (keep the form's value) or
  // "theirs" (their value was applied into the form). Saving into the
  // conflicted target is blocked until every contested chunk is acked — or
  // the user switches to a new draft, which can't overwrite anyone.
  const [conflictResolutions, setConflictResolutions] = useState<
    Map<string, "mine" | "theirs">
  >(new Map());
  // Set when the save's error handler saw a 409, so the submit catch can
  // suppress the Modal's own error text — the banner is the single message.
  const conflictSignaledRef = useRef(false);

  // Find any existing ramp schedule that already targets this specific rule.
  // Uses stem matching so environment-suffixed rule IDs (e.g. fr_abc__production)
  // still resolve to the same schedule as their bare stem (fr_abc).
  const ruleRampSchedule = rule?.id
    ? rampSchedules.find((rs) =>
        rs.targets.some(
          (t) => t.ruleId && stemRuleId(t.ruleId) === stemRuleId(rule.id),
        ),
      )
    : undefined;

  // Prefetch templates on modal open so they're resolved before the ramp step
  // mounts RampScheduleSection.
  const { data: rampTemplatesData } = useApi<{
    rampScheduleTemplates: RampScheduleTemplateInterface[];
  }>("/ramp-schedule-templates");

  // Check if there's a pending detach action for this rule in the draft.
  // When true, the ramp section should open as "off" so users don't think
  // the schedule is still active. Re-enabling and saving will clear the detach.
  const hasPendingDetach =
    !!rule?.id &&
    (draftRevision?.rampActions ?? []).some(
      (a) =>
        a.mode === "detach" && stemRuleId(a.ruleId) === stemRuleId(rule.id),
    );

  // Find a pending create action for this rule, if any (used when no live schedule exists yet).
  const pendingCreateAction =
    !ruleRampSchedule && !hasPendingDetach && rule?.id
      ? (draftRevision?.rampActions ?? []).find(
          (a) =>
            a.mode === "create" && stemRuleId(a.ruleId) === stemRuleId(rule.id),
        )
      : undefined;
  const pendingCreateActionTyped =
    pendingCreateAction?.mode === "create" ? pendingCreateAction : undefined;

  // Find a pending update action for this rule, if any (used when a live schedule exists
  // but has already been modified in this draft session and the modal is re-opened).
  const pendingUpdateAction =
    ruleRampSchedule && !hasPendingDetach && rule?.id
      ? (draftRevision?.rampActions ?? []).find(
          (a) =>
            a.mode === "update" && stemRuleId(a.ruleId) === stemRuleId(rule.id),
        )
      : undefined;
  const pendingUpdateActionTyped =
    pendingUpdateAction?.mode === "update" ? pendingUpdateAction : undefined;

  const [rampSectionState, setRampSectionState] = useState<RampSectionState>(
    () => {
      if (hasPendingDetach) {
        // Start unchecked ("off"), but keep all the live schedule data so that
        // toggling the checkbox reveals the real steps/settings instead of an empty template.
        if (ruleRampSchedule) {
          return {
            ...rampScheduleToSectionState(ruleRampSchedule),
            mode: "off",
          };
        }
        return defaultRampSectionState(undefined);
      }
      // If a pending create action exists in the draft (not yet in DB), pre-populate from it
      if (pendingCreateActionTyped) {
        return createActionToSectionState(pendingCreateActionTyped);
      }
      // Duplicate starts fresh — no schedule carried over
      if (mode === "duplicate") {
        return defaultRampSectionState(undefined);
      }
      // If a pending update action exists (modal re-opened after a prior edit in this draft),
      // merge it on top of the live schedule so the user sees their pending changes.
      if (pendingUpdateActionTyped && ruleRampSchedule) {
        return updateActionToSectionState(
          pendingUpdateActionTyped,
          ruleRampSchedule,
        );
      }
      return defaultRampSectionState(ruleRampSchedule);
    },
  );
  const { datasources, project: currentProject } = useDefinitions();
  const { experimentsMap, mutateExperiments } = useExperiments();
  const { templates: allTemplates } = useTemplates();
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const disabledEnvironmentIds = environments
    .filter((e) => !feature.environmentSettings[e.id]?.enabled)
    .map((e) => e.id);

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    feature.project,
  );

  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] =
    useState(false);
  const [disableBanditConversionWindow, setDisableBanditConversionWindow] =
    useState(false);

  const settings = useOrgSettings();
  const { settings: scopedSettings } = getScopedSettings({ organization });

  const defaultDraft = useDefaultDraft(revisionList);

  const [draftMode, setDraftMode] = useState<DraftMode>(
    defaultDraft !== null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  // Determines which draft/revision to target in the API call. Uses the
  // pinned version, not the reactive feature.version — see pin above.
  const targetVersion =
    draftMode === "existing" && selectedDraft !== null
      ? selectedDraft
      : pinnedFeatureVersion;

  // Holdout a newly-created experiment should join: the holdout of the draft the
  // rule is being added to (revision.holdout), not just the live feature's — so
  // a holdout added in that same draft is picked up. Falls back to the merged
  // feature's holdout when the target revision isn't in context (e.g. a new
  // draft branched from the viewed version carries that holdout forward).
  const revisionsCtx = useFeatureRevisionsContext();
  const targetHoldoutId = useMemo(() => {
    const targetRev = revisionsCtx?.revisions.find(
      (r) => r.version === targetVersion,
    );
    return (targetRev ? targetRev.holdout : feature.holdout)?.id;
  }, [revisionsCtx, targetVersion, feature.holdout]);

  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature]);

  const defaultRuleValues = {
    ...getDefaultRuleValue({
      defaultValue: getFeatureDefaultValue(feature),
      ruleType: defaultType,
      attributeSchema,
      isSafeRolloutAutoRollbackEnabled: true,
      defaultHashVersion: hasSDKWithNoBucketingV2 ? 1 : 2,
    }),
    // hashVersion is computed for all rule types so the hashing widget always
    // has a value. getDefaultRuleValue only sets it for ruleType === "rollout";
    // other rule types ignore it at save time via their Zod validators.
    hashVersion: (hasSDKWithNoBucketingV2 ? 1 : 2) as 1 | 2,
  };

  const convertRuleToFormValues = (rule: FeatureRule | undefined) => {
    if (!rule) return undefined;
    if (rule.type === "safe-rollout") {
      return {
        ...rule,
        safeRolloutFields: safeRollout,
      };
    }
    if (rule.type === "rollout") {
      return {
        ...rule,
        // Existing rules without an explicit hashVersion have always used v1 implicitly.
        // Default to 1 here so a re-save never silently rebuckets existing traffic.
        hashVersion: (rule.hashVersion as 1 | 2 | undefined) ?? 1,
      };
    }
    return rule;
  };

  const defaultValues = {
    ...defaultRuleValues,
    ...convertRuleToFormValues(rule),
    // A duplicated rollout starts seedless so it buckets independently; the Seed
    // field stays editable to reuse the original's cohort. Safe-rollout has its
    // own "Same seed" checkbox, so it's excluded here.
    ...(mode === "duplicate" && rule?.type === "rollout" ? { seed: "" } : {}),
    // Pre-set the ID for new rollout rules so ramp creation can reference it
    // without a second round-trip. Back-end preserves a truthy id from the client.
    ...(mode === "create" && !rule ? { id: pregenRuleId } : {}),
    // Ensure coverage defaults to 1 (100%) for new force rules
    ...(mode === "create" &&
    !rule &&
    defaultRuleValues &&
    "type" in defaultRuleValues &&
    defaultRuleValues.type === "force"
      ? { coverage: 1 }
      : {}),
    // Populate hashAttribute and seed for new force rules so they're ready if converted to rollout
    ...(mode === "create" &&
    !rule &&
    defaultRuleValues &&
    "type" in defaultRuleValues &&
    defaultRuleValues.type === "force"
      ? {
          hashAttribute:
            attributeSchema?.find((a) => a.hashAttribute)?.property ||
            attributeSchema?.[0]?.property ||
            "id",
          seed: "",
        }
      : {}),
    // Backward-compat: rules saved before the stripping logic was removed may
    // have empty targeting on the rule with the real values in startActions.
    // For pre-start/terminal states, restore from startActions if the rule's
    // own fields are empty. For running/paused, the rule's live values are
    // managed by the engine and are always correct.
    ...(() => {
      const isPreStartOrTerminal =
        ruleRampSchedule == null ||
        ["pending", "ready", "rolled-back", "completed"].includes(
          ruleRampSchedule.status,
        );
      if (!isPreStartOrTerminal && !pendingCreateActionTyped) return {};

      const startActions =
        ruleRampSchedule?.startActions ??
        pendingCreateActionTyped?.startActions;
      if (!startActions?.length) return {};
      // Safe to use .find() (first match): per-env entries always share the
      // same targeting fields — only coverage differs across targets.
      const patch = startActions.find(
        (a) => a.targetType === "feature-rule",
      )?.patch;
      if (!patch) return {};
      const restored: Record<string, unknown> = {};
      if (patch.condition != null && !rule?.condition) {
        restored.condition = patch.condition;
      }
      if (patch.savedGroups != null && !rule?.savedGroups?.length) {
        restored.savedGroups = patch.savedGroups;
      }
      if (patch.prerequisites != null && !rule?.prerequisites?.length) {
        restored.prerequisites = patch.prerequisites;
      }
      return restored;
    })(),
  };

  // Overview Page
  const [newRuleOverviewPage, setNewRuleOverviewPage] = useState<boolean>(
    mode === "create",
  );
  const [overviewRadioSelectorRuleType, setOverviewRadioSelectorRuleType] =
    useState<RadioSelectorRuleType | "">("");
  const [overviewRuleType, setOverviewRuleType] = useState<
    OverviewRuleType | ""
  >("");

  // Paged modal
  const [step, setStep] = useState(0);

  const form = useForm<
    | Exclude<FeatureRule, SafeRolloutRule>
    | NewExperimentRefRule
    | SafeRolloutRuleCreateFields
  >({
    defaultValues,
  });

  // On edit/duplicate, seed scope from the existing rule. Legacy rules with
  // `environments === undefined` are treated as permissive (= all envs). On
  // create, seed from org default ("all envs") or fall back to the current
  // env tab.
  const existingRuleAllEnvs = rule?.allEnvironments === true;
  const existingRuleEnvList = Array.isArray(rule?.environments)
    ? (rule?.environments ?? [])
    : undefined;
  const existingRuleScopeIsAll =
    existingRuleAllEnvs ||
    (rule !== undefined &&
      rule.allEnvironments !== true &&
      existingRuleEnvList === undefined);

  const [scopeAllEnvs, setScopeAllEnvs] = useState<boolean>(() => {
    if (mode === "edit" || mode === "duplicate") return existingRuleScopeIsAll;
    // New rules: default to "All environments" only when no active env tab.
    return !environment;
  });
  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>(
    () => {
      if (mode === "edit" || mode === "duplicate") {
        if (existingRuleScopeIsAll) return [];
        return existingRuleEnvList ?? [environment];
      }
      // New rules: pre-select the active env tab (or empty if "All" fallback).
      return environment ? [environment] : [];
    },
  );

  // Rule-level project scope. Absent `allProjects`/`projects` (legacy/default)
  // means "all projects"; `allProjects === false` with a `projects` list scopes
  // the rule. On duplicate/edit, seed from the existing rule.
  const existingRuleAllProjects =
    rule === undefined || rule.allProjects !== false;
  const [scopeAllProjects, setScopeAllProjects] = useState<boolean>(
    () => existingRuleAllProjects,
  );
  const [selectedProjects, setSelectedProjects] = useState<string[]>(() =>
    Array.isArray(rule?.projects) ? (rule?.projects ?? []) : [],
  );

  const defaultHasSchedule = (defaultValues.scheduleRules || []).some(
    (scheduleRule) => scheduleRule.timestamp !== null,
  );
  const [scheduleToggleEnabled, setScheduleToggleEnabled] =
    useState(defaultHasSchedule);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(() =>
    deriveScheduleType(
      rampSectionState,
      defaultHasSchedule,
      defaultHasSchedule,
      undefined,
    ),
  );

  const orgStickyBucketing = !!settings.useStickyBucketing;
  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits",
  );

  const experimentId = form.watch("experimentId");
  const selectedExperiment = experimentsMap.get(experimentId) || null;

  const ruleType = form.watch("type");
  const experimentType = selectedExperiment
    ? selectedExperiment.type === "multi-armed-bandit"
      ? "bandit"
      : "experiment"
    : overviewRadioSelectorRuleType === "bandit"
      ? "bandit"
      : overviewRadioSelectorRuleType === "experiment"
        ? "experiment"
        : null;

  // Compute header text and tracking event type - must be before conditional returns
  const headerText = useMemo(() => {
    let text =
      mode === "duplicate"
        ? "Duplicate "
        : mode === "create"
          ? "Add "
          : "Edit ";
    text +=
      ruleType === "force"
        ? `${mode === "create" ? "new " : ""}Force Value Rule`
        : ruleType === "rollout"
          ? `${mode === "create" ? "new " : ""}Percentage Rollout Rule`
          : ["experiment-ref", "experiment-ref-new", "experiment"].includes(
                ruleType ?? "",
              ) && experimentType === "bandit"
            ? `${
                ruleType === "experiment-ref-new" ? "new" : "existing"
              } Bandit as Rule`
            : ["experiment-ref", "experiment-ref-new", "experiment"].includes(
                  ruleType ?? "",
                ) && experimentType === "experiment"
              ? `${
                  ruleType === "experiment-ref-new" ? "new" : "existing"
                } Experiment as Rule`
              : ruleType === "safe-rollout"
                ? "Safe Rollout Rule"
                : "Rule";
    if (ruleType === "safe-rollout") {
      if (environment) text += ` in ${environment}`;
    } else if (scopeAllEnvs) {
      text += ` in All Environments`;
    } else if (selectedEnvironments.length === 0) {
      text += ` (no environments)`;
    } else {
      text += ` in ${selectedEnvironments[0]}${
        selectedEnvironments.length > 1
          ? ` + ${selectedEnvironments.length - 1} more`
          : ""
      }`;
    }
    return text;
  }, [
    ruleType,
    experimentType,
    mode,
    environment,
    scopeAllEnvs,
    selectedEnvironments,
  ]);

  const trackingEventModalType = useMemo(
    () => kebabCase(headerText),
    [headerText],
  );

  const availableTemplates = currentProject
    ? allTemplates.filter((t) =>
        isProjectListValidForProject(
          t.project ? [t.project] : [],
          currentProject,
        ),
      )
    : allTemplates;

  const templateRequired =
    hasCommercialFeature("templates") &&
    experimentType !== "bandit" &&
    settings.requireExperimentTemplates &&
    availableTemplates.length >= 1;

  const [ruleCyclicResult, setRuleCyclicResult] = useState({
    wouldBeCyclic: false,
    cyclicFeatureId: null as string | null,
  });
  const isCyclic = ruleCyclicResult.wouldBeCyclic;
  const cyclicFeatureId = ruleCyclicResult.cyclicFeatureId;

  const onRuleCyclicChange = useCallback(
    (result: { wouldBeCyclic: boolean; cyclicFeatureId: string | null }) => {
      setRuleCyclicResult(result);
    },
    [],
  );

  const [prerequisiteTargetingSdkIssues, setPrerequisiteTargetingSdkIssues] =
    useState(false);
  const monitoringError =
    scheduleType === "ramp"
      ? getMonitoringValidationError(rampSectionState)
      : null;
  const canSubmit = useMemo(() => {
    return !isCyclic && !prerequisiteTargetingSdkIssues && !monitoringError;
  }, [isCyclic, prerequisiteTargetingSdkIssues, monitoringError]);

  // Contested chunks the user must ack before saving into the conflicted
  // target. Non-mergeable conflicts (restructured/removed) use one synthetic
  // key. Switching to a new draft is a compatible strategy — nothing gets
  // overwritten — so it unblocks the save without acks.
  const contestedKeys: string[] = conflict
    ? conflict.merge && !conflict.merge.wholeRule && conflict.currentRule
      ? conflict.merge.contested.map((c) => c.key)
      : ["__rule__"]
    : [];
  const conflictResolved =
    !conflict ||
    draftMode === "new" ||
    contestedKeys.every((k) => conflictResolutions.has(k));

  const isRampType = scheduleType === "ramp";
  const hasRampPage =
    isRampType && (ruleType === "force" || ruleType === "rollout");
  const rampIsEditable =
    !ruleRampSchedule || ruleRampSchedule.status !== "running";

  // Reset to page 1 when the ramp page disappears (user switched away from ramp).
  // Only applies to rollout/force rules — experiment rules have their own valid pages.
  useEffect(() => {
    if (
      !hasRampPage &&
      step > 0 &&
      (ruleType === "force" || ruleType === "rollout")
    ) {
      setStep(0);
    }
  }, [hasRampPage, step, ruleType]);

  const [conditionKey, forceConditionRender] = useIncrementer();

  // Watch the values we need to track
  const currentType = form.watch("type");
  const currentCoverage = form.watch("coverage");

  // Auto-manage rule type and coverage based on ramp state and coverage value.
  // Force rule → coverage 100%
  // Coverage < 100% → rollout rule
  // Coverage back to 100% → force rule (clean state)
  // Has ramp affecting coverage → rollout rule
  useEffect(() => {
    // Simple schedules never control coverage — only full ramp-ups do.
    const hasRampWithCoverage =
      isRampType &&
      rampSectionState.mode !== "off" &&
      (rampSectionState.steps.some(
        (step) => step.patch.coverage !== undefined,
      ) ||
        rampSectionState.endPatch.coverage !== undefined);

    // Determine target rule type and coverage based on current state
    let targetType: "force" | "rollout" =
      currentType === "rollout" ? "rollout" : "force";
    let targetCoverage = currentCoverage ?? 1;

    // If there's a ramp with coverage, must be rollout
    if (hasRampWithCoverage) {
      targetType = "rollout";
      if (!isLiveRule) {
        targetCoverage = 0;
      }
    }
    // If coverage < 100%, must be rollout
    else if (currentCoverage !== undefined && currentCoverage < 1) {
      targetType = "rollout";
    }
    // If coverage is 100% (or undefined), can be force
    else if (currentCoverage === undefined || currentCoverage === 1) {
      targetType = "force";
      targetCoverage = 1; // Ensure force rules are always 100%
    }

    // Update type if it changed
    if (
      (currentType === "force" || currentType === "rollout") &&
      currentType !== targetType
    ) {
      form.setValue("type", targetType);
      // When auto-promoting to rollout, ensure hashAttribute has a sensible value
      if (targetType === "rollout") {
        if (!form.getValues("hashAttribute")) {
          const defaultHash =
            attributeSchema?.find((a) => a.hashAttribute)?.property ||
            attributeSchema?.[0]?.property ||
            "id";
          form.setValue("hashAttribute", defaultHash);
        }
      }
    }

    // Update coverage if it changed
    if (targetCoverage !== currentCoverage) {
      form.setValue("coverage", targetCoverage);
    }
  }, [
    currentType,
    currentCoverage,
    rampSectionState,
    scheduleType,
    isRampType,
    isLiveRule,
    form,
    attributeSchema,
  ]);

  function changeRuleType(v: string) {
    const existingCondition = form.watch("condition");
    const existingSavedGroups = form.watch("savedGroups");
    const existingHashAttribute = form.watch("hashAttribute");
    const existingSeed = form.watch("seed");
    const newVal = {
      ...getDefaultRuleValue({
        defaultValue: getFeatureDefaultValue(feature),
        ruleType: v,
        attributeSchema,
        settings,
        datasources,
        isSafeRolloutAutoRollbackEnabled: true,
        defaultHashVersion: hasSDKWithNoBucketingV2 ? 1 : 2,
      }),
      description: form.watch("description"),
    };
    if (existingCondition && existingCondition !== "{}") {
      newVal.condition = existingCondition;
    }
    if (existingSavedGroups) {
      newVal.savedGroups = existingSavedGroups;
    }
    // Always carry hashAttribute forward (fall back to schema default so rollout
    // rules are never left without a bucketing attribute).
    const resolvedHash =
      existingHashAttribute ||
      attributeSchema?.find((a) => a.hashAttribute)?.property ||
      attributeSchema?.[0]?.property ||
      "id";
    (newVal as Record<string, unknown>).hashAttribute = resolvedHash;
    if (existingSeed) {
      (newVal as Record<string, unknown>).seed = existingSeed;
    }
    // Org opt-in: new JSON rules start in sparse mode with a clean-slate value
    // (strip keys equal to the default) so the editor isn't pre-filled with the
    // whole default object. Only for eligible JSON features; new rules only.
    // Sparse is supported only on force/rollout/experiment-ref rules (and the
    // "experiment-ref-new" form type that becomes one). Legacy inline
    // "experiment" and safe-rollout have no sparse field, so skip them.
    const nv = newVal as Record<string, unknown>;
    const sparseSupportedType =
      nv.type === "force" ||
      nv.type === "rollout" ||
      nv.type === "experiment-ref" ||
      nv.type === "experiment-ref-new";
    if (
      mode === "create" &&
      !rule &&
      settings?.sparseJSONRulesByDefault &&
      sparseSupportedType
    ) {
      const def = getFeatureDefaultValue(feature);
      if (feature.valueType === "json" && parsePlainJSONObject(def) !== null) {
        nv.sparse = true;
        if (typeof nv.value === "string") {
          nv.value = stripDefaultsForSparse(nv.value, def);
        }
        // `values` = experiment-ref-new; `variations` = experiment-ref / bandit.
        // Both carry a per-entry `value` string.
        if (Array.isArray(nv.values)) {
          nv.values = (nv.values as { value: string }[]).map((v) => ({
            ...v,
            value: stripDefaultsForSparse(v.value, def),
          }));
        }
        if (Array.isArray(nv.variations)) {
          nv.variations = (nv.variations as { value: string }[]).map((v) => ({
            ...v,
            value: stripDefaultsForSparse(v.value, def),
          }));
        }
      }
    }
    form.reset(newVal);
    // Preserve the pre-generated rule ID so ramp patches stay in sync with
    // the rule after a type switch. getDefaultRuleValue returns id:"" which
    // would cause the backend to assign a new ID that doesn't match the patches.
    if (mode === "create" && !rule) {
      form.setValue("id", pregenRuleId);
    }
  }

  const submitOverview = () => {
    setNewRuleOverviewPage(false);
    changeRuleType(overviewRuleType);
    // set experiment type:
    if (overviewRuleType === "experiment-ref-new") {
      if (overviewRadioSelectorRuleType === "experiment") {
        form.setValue("experimentType", "standard");
        form.setValue("regressionAdjustmentEnabled", undefined);
        form.setValue("banditScheduleValue", undefined);
        form.setValue("banditScheduleUnit", undefined);
        form.setValue("banditBurnInValue", undefined);
        form.setValue("banditBurnInUnit", undefined);
      } else if (overviewRadioSelectorRuleType === "bandit") {
        form.setValue("experimentType", "multi-armed-bandit");
        form.setValue(
          "regressionAdjustmentEnabled",
          scopedSettings.regressionAdjustmentEnabled.value,
        );
        form.setValue(
          "banditScheduleValue",
          scopedSettings.banditScheduleValue.value,
        );
        form.setValue(
          "banditScheduleUnit",
          scopedSettings.banditScheduleUnit.value,
        );
        form.setValue(
          "banditBurnInValue",
          scopedSettings.banditBurnInValue.value,
        );
        form.setValue(
          "banditBurnInUnit",
          scopedSettings.banditScheduleUnit.value,
        );
      }
    }
  };
  const safeRolloutRuleHasChanges = (values: SafeRolloutRuleCreateFields) => {
    return Object.keys(values).some((key) => {
      if (key === "safeRolloutFields") return false;

      const value = values[key];
      const originalValue = defaultValues[key];

      const isDifferent =
        JSON.stringify(value) !== JSON.stringify(originalValue);
      return isDifferent;
    });
  };

  const submit = form.handleSubmit(async (values) => {
    const ruleAction = mode === "create" ? "add" : mode;

    // If the user built a schedule, but disabled the toggle, we ignore the schedule
    if (!scheduleToggleEnabled) {
      values.scheduleRules = [];
    }

    // Reuse pregenRuleId for duplicates so the inline ramp payload targets
    // the rule the backend creates. (Backend preserves a truthy client id.)
    if (mode === "duplicate") {
      values.id = pregenRuleId;
    }

    if (scopeAllEnvs) {
      values = {
        ...values,
        allEnvironments: true,
        environments: [],
      };
    } else {
      values = {
        ...values,
        allEnvironments: false,
        environments: selectedEnvironments,
      };
    }

    // An all-projects rule carries no explicit list, so project-deletion
    // cleanup can never later empty it into "all". A scoped rule keeps its
    // (possibly empty = "no project") list.
    if (scopeAllProjects) {
      values = { ...values, allProjects: true, projects: [] };
    } else {
      values = { ...values, allProjects: false, projects: selectedProjects };
    }

    // Loop through each scheduleRule and convert the timestamp to an ISOString()
    if (values.scheduleRules?.length) {
      values.scheduleRules?.forEach((scheduleRule: ScheduleRule) => {
        if (scheduleRule.timestamp === null) {
          return;
        }
        scheduleRule.timestamp = new Date(scheduleRule.timestamp).toISOString();
      });

      // We currently only support a start date and end date, and if both are null, set schedule to empty array
      if (
        values.scheduleRules[0].timestamp === null &&
        values.scheduleRules[1].timestamp === null
      ) {
        values.scheduleRules = [];
      }
    }

    let safeRolloutFields: Partial<CreateSafeRolloutInterface> | undefined;
    try {
      if (values.type === "experiment-ref-new") {
        // Make sure there's an experiment name
        if ((values.name?.length ?? 0) < 1) {
          setStep(0);
          throw new Error("Name must not be empty");
        }

        // Apply same validation as we do for legacy experiment rules
        const newRule = validateFeatureRule(
          {
            ...values,
            type: "experiment",
          },
          feature,
          {
            attributeSchema: allAttributesSchema,
            requireRegisteredAttributes: settings.requireRegisteredAttributes,
          },
        );
        if (newRule) {
          form.reset({
            ...newRule,
            type: "experiment-ref-new",
            name: values.name,
          });
          throw new Error(
            "We fixed some errors in the rule. If it looks correct, submit again.",
          );
        }

        if (!values.templateId && templateRequired) {
          setStep(0);
          throw new Error("You must select a template");
        }

        if (prerequisiteTargetingSdkIssues) {
          throw new Error("Prerequisite targeting issues must be resolved");
        }

        const shouldIncludeConversionWindow =
          values.experimentType === "multi-armed-bandit" &&
          !disableBanditConversionWindow &&
          (!settings.useStickyBucketing || values.disableStickyBucketing);
        if (values.experimentType === "multi-armed-bandit") {
          if (!hasCommercialFeature("multi-armed-bandits")) {
            throw new Error("Bandits are a premium feature");
          }
          values.statsEngine = "bayesian";
          if (!values.datasource) {
            throw new Error("You must select a datasource");
          }
          if ((values.goalMetrics?.length ?? 0) !== 1) {
            throw new Error("You must select 1 decision metric");
          }
          if (
            shouldIncludeConversionWindow &&
            (!values.banditConversionWindowValue ||
              !values.banditConversionWindowUnit)
          ) {
            throw new Error(
              "Enter a conversion window override or disable the conversion window override",
            );
          }
        }

        // @ts-expect-error Mangled types when coming from a feature rule
        if (values.skipPartialData === "strict") {
          values.skipPartialData = true;
        }
        // @ts-expect-error Mangled types when coming from a feature rule
        else if (values.skipPartialData === "loose") {
          values.skipPartialData = false;
        }

        const variations = values.values.map((v, i) => ({
          id: uniqId("var_"),
          key: i + "",
          name: v.name || (i ? `Variation ${i}` : "Control"),
          screenshots: [],
        }));
        const variationWeights = values.values.map((v) => v.weight);
        const phases = [
          {
            condition: values.condition || "",
            savedGroups: values.savedGroups || [],
            prerequisites: values.prerequisites || [],
            coverage: values.coverage ?? 1,
            dateStarted: new Date().toISOString().substr(0, 16),
            name: "Main",
            namespace: values.namespace || {
              enabled: false,
              name: "",
              range: [0, 1],
            },
            reason: "",
            variationWeights,
            variations: variations.map((v) => ({
              id: v.id,
              status: "active" as const,
            })),
          },
        ];
        // All looks good, create experiment
        const exp: Partial<ExperimentInterfaceStringDates> = {
          archived: false,
          autoSnapshots: true,
          // Use template datasource/exposure query id if available
          ...getNewExperimentDatasourceDefaults({
            datasources,
            settings,
            project: feature.project || "",
          }),
          hashAttribute: values.hashAttribute,
          fallbackAttribute: values.fallbackAttribute || "",
          disableStickyBucketing: values.disableStickyBucketing ?? false,
          datasource: values.datasource || undefined,
          exposureQueryId: values.exposureQueryId || "",
          goalMetrics: values.goalMetrics || [],
          secondaryMetrics: values.secondaryMetrics || [],
          guardrailMetrics: values.guardrailMetrics || [],
          activationMetric: values.activationMetric || "",
          segment: values.segment || "",
          skipPartialData: values.skipPartialData,
          name: values.name,
          hashVersion: (values.hashVersion ||
            (hasSDKWithNoBucketingV2 ? 1 : 2)) as 1 | 2,
          owner: "",
          status: "draft",
          tags: feature.tags || [],
          trackingKey: values.trackingKey || feature.id,
          description: values.description,
          hypothesis: values.hypothesis,
          linkedFeatures: [feature.id],
          attributionModel: settings?.attributionModel || "firstExposure",
          targetURLRegex: "",
          ideaSource: "",
          project: feature.project,
          variations,
          phases,
          sequentialTestingEnabled:
            values.experimentType === "multi-armed-bandit"
              ? false
              : (values.sequentialTestingEnabled ??
                !!settings?.sequentialTestingEnabled),
          sequentialTestingTuningParameter:
            values.sequentialTestingTuningParameter ??
            settings?.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
          regressionAdjustmentEnabled:
            values.regressionAdjustmentEnabled ?? undefined,
          statsEngine: values.statsEngine ?? undefined,
          type: values.experimentType,
          holdoutId:
            values.experimentType === "standard" ? targetHoldoutId : undefined,
        };

        if (values?.customFields) {
          exp.customFields = values.customFields;
        }
        if (values.experimentType === "multi-armed-bandit") {
          Object.assign(exp, {
            banditScheduleValue: values.banditScheduleValue ?? 1,
            banditScheduleUnit: values.banditScheduleUnit ?? "days",
            banditBurnInValue: values.banditBurnInValue ?? 1,
            banditBurnInUnit: values.banditBurnInUnit ?? "days",
            ...(shouldIncludeConversionWindow && {
              banditConversionWindowValue: values.banditConversionWindowValue,
              banditConversionWindowUnit: values.banditConversionWindowUnit,
            }),
          });
        }

        const res = await apiCall<
          | { experiment: ExperimentInterfaceStringDates }
          | { duplicateTrackingKey: true; existingId: string }
        >(
          `/experiments${
            allowDuplicateTrackingKey ? "?allowDuplicateTrackingKey=true" : ""
          }`,
          {
            method: "POST",
            body: JSON.stringify(exp),
          },
        );

        if ("duplicateTrackingKey" in res) {
          setAllowDuplicateTrackingKey(true);
          throw new Error(
            "Warning: An experiment with that tracking key already exists. To continue anyway, click 'Save' again.",
          );
        }

        track(
          values.experimentType === "multi-armed-bandit"
            ? "Create Bandit"
            : "Create Experiment",
          {
            source: "experiment-ref-new-rule-modal",
            numTags: feature.tags?.length || 0,
            numMetrics: 0,
            numVariations: values.values.length || 0,
          },
        );

        // Experiment created, treat it as an experiment ref rule now
        values = {
          type: "experiment-ref",
          description: "",
          experimentId: res.experiment.id,
          id: values.id,
          allEnvironments: values.allEnvironments ?? false,
          environments: values.environments,
          allProjects: values.allProjects ?? true,
          projects: values.projects,
          condition: "",
          savedGroups: [],
          enabled: values.enabled ?? true,
          variations: values.values.map((v, i) => ({
            value: v.value,
            variationId: getAllVariations(res.experiment)[i]?.id || "",
          })),
          scheduleRules: values.scheduleRules || [],
          ...(form.watch("sparse") ? { sparse: true } : {}),
        };
        mutateExperiments();
      } else if (values.type === "experiment-ref") {
        // Validate a proper experiment was chosen and it has a value for every variation id
        const experimentId = values.experimentId;
        const exp = experimentsMap.get(experimentId);
        if (!exp) throw new Error("Must select an experiment");

        const valuesByIndex = values.variations.map((v) => v.value);
        const valuesByVariationId = new Map(
          values.variations.map((v) => [v.variationId, v.value]),
        );

        values.variations = getLatestPhaseVariations(exp).map((v, i) => {
          return {
            variationId: v.id,
            value: valuesByVariationId.get(v.id) ?? valuesByIndex[i] ?? "",
          };
        });

        delete (values as FeatureRule).condition;
        delete (values as FeatureRule).savedGroups;
        delete (values as FeatureRule).prerequisites;
        // eslint-disable-next-line
        delete (values as any).value;
      } else if (values.type === "safe-rollout") {
        safeRolloutFields = values.safeRolloutFields;
        // Ensure we pass the ramp up schedule enabled flag to the backend (it builds the rest)
        const rampUpSchedule = safeRolloutFields["rampUpSchedule"] || {};
        // backend deals with the rest
        safeRolloutFields["rampUpSchedule"] = {};
        safeRolloutFields["rampUpSchedule"]["enabled"] =
          rampUpSchedule["enabled"] ?? true;

        // eslint-disable-next-line
        delete (values as any).safeRolloutFields;
        // eslint-disable-next-line
        delete (values as any).value; //saferollout uses controlValue so we want to remove the value
        // eslint-disable-next-line
        delete (values as any).trackingKey;
        if (mode === "duplicate" && !values.sameSeed) {
          // eslint-disable-next-line
          delete (values as any).seed;
        }
        // eslint-disable-next-line
        delete (values as any).sameSeed;

        if (safeRolloutFields?.maxDuration) {
          safeRolloutFields.maxDuration.unit = "days";
        }
      } else if (values.type === "force") {
        // Force rules don't support hashAttribute, seed, or hashVersion; strip
        // them from the form. They're only in the form state to be ready if
        // converted to rollout. hashVersion in particular is computed for the
        // hashing widget regardless of rule type, so without this a force-rule
        // edit (e.g. just changing a schedule's cutoff date) shows a spurious
        // "Hash Version: unset → 2" change in the draft.
        // eslint-disable-next-line
        delete (values as any).hashAttribute;
        // eslint-disable-next-line
        delete (values as any).seed;
        delete (values as { hashVersion?: number }).hashVersion;
      } else if (values.type === "rollout") {
        // An empty seed means "stamp this rule's own id" (the default for
        // duplicates) — omit it rather than submitting "".
        if (!values.seed) {
          // eslint-disable-next-line
          delete (values as any).seed;
        }
      }
      if (
        values.scheduleRules &&
        values.scheduleRules.length === 0 &&
        !rule?.scheduleRules
      ) {
        delete values.scheduleRules;
      }

      const correctedRule = validateFeatureRule(
        values as FeatureRule,
        feature,
        {
          attributeSchema: allAttributesSchema,
          requireRegisteredAttributes: settings.requireRegisteredAttributes,
        },
      );
      if (correctedRule) {
        form.reset(correctedRule);
        throw new Error(
          "We fixed some errors in the rule. If it looks correct, submit again.",
        );
      }

      if (
        (values.type === "rollout" || values.type === "force") &&
        rampSectionState.mode !== "off" &&
        !isRampSectionConfigured(rampSectionState)
      ) {
        throw new Error(
          "Ramp schedule requires either steps or scheduled start or end dates.",
        );
      }

      // Rollout rules with sub-100% coverage and ramp-up schedules that control
      // coverage both require a bucketing attribute to be set.
      const rampHasCoverage =
        isRampType &&
        rampSectionState.mode !== "off" &&
        rampSectionState.steps.some((s) => s.patch.coverage !== undefined);
      if (
        (values.type === "rollout" || rampHasCoverage) &&
        !(values as Record<string, unknown>).hashAttribute
      ) {
        throw new Error(
          'A "Sample based on attribute" must be selected when using coverage or a ramp schedule that controls coverage.',
        );
      }

      track("Save Feature Rule", {
        source: ruleAction,
        ruleIndex: i,
        environment,
        type: values.type,
        hasCondition: values.condition && values.condition.length > 2,
        hasSavedGroups: !!values.savedGroups?.length,
        hasPrerequisites: !!values.prerequisites?.length,
        hasDescription: values.description && values.description.length > 0,
        numEnvironments: selectedEnvironments.length,
      });
      let res: { version: number } | undefined;

      if (mode === "edit") {
        if (!ruleId) throw new Error("Missing ruleId for edit");
        if (values.type === "safe-rollout") {
          res = await apiCall(`/safe-rollout/${values.safeRolloutId}`, {
            method: "PUT",
            body: JSON.stringify({
              safeRolloutFields,
            }),
          });
        }
        if (
          values.type !== "safe-rollout" ||
          (values.type === "safe-rollout" &&
            safeRolloutRuleHasChanges(values as SafeRolloutRuleCreateFields))
        ) {
          // Build optional inline ramp payload to batch with the rule PUT
          let rampScheduleInline:
            | PutFeatureRuleBody["rampSchedule"]
            | undefined;
          // When removing a schedule that never fired, restore the rule to
          // enabled. New rules with a future schedule are stored as
          // enabled:false on POST; detaching/clearing the schedule before it
          // ran would otherwise leave the rule permanently disabled.
          let restoreEnabledOnDetach = false;
          const scheduleNeverFired =
            !ruleRampSchedule ||
            ruleRampSchedule.status === "pending" ||
            ruleRampSchedule.status === "ready";
          if (
            (values.type === "rollout" || values.type === "force") &&
            rule?.id
          ) {
            const ruleId = rule.id;

            // If detachRampOnSave flag is set, send a detach payload
            if (detachRampOnSave && ruleRampSchedule?.id) {
              rampScheduleInline = {
                mode: "detach",
                rampScheduleId: ruleRampSchedule.id,
                deleteScheduleWhenEmpty: true,
              };
              restoreEnabledOnDetach = scheduleNeverFired;
            } else if (hasPendingDetach && rampSectionState.mode === "edit") {
              // User re-enabled the ramp section to restore the detached schedule — cancel the removal
              rampScheduleInline = { mode: "clear" };
            } else {
              // Otherwise, use normal ramp section state logic
              // Defensively scrub patches to only include fields valid for this rule type
              const rampState =
                values.type === "force" || values.type === "rollout"
                  ? scrubRampStateForRuleType(rampSectionState)
                  : rampSectionState;
              // "schedule" mode = simple date window (no intermediate steps).
              // Driven by the RadioGroup selection — reliable regardless of step count in state.
              const isScheduleMode = scheduleType === "schedule";

              // A "schedule" type with no start date and no end date is a no-op —
              // no schedule should be created or updated in this case.
              // A ramp with zero steps and no bounding dates is equally meaningless
              // and would Zod-fail at publish time; treat it the same way.
              const isNoOpSchedule =
                (isScheduleMode &&
                  !rampState.startDate &&
                  !rampState.endScheduleAt) ||
                (!isScheduleMode &&
                  rampState.steps.length === 0 &&
                  !rampState.startDate &&
                  !rampState.cutoffDate);
              const activeTargetId =
                ruleRampSchedule?.targets.find((t) => t.status === "active")
                  ?.id ?? "t1";

              if (
                rampState.mode === "create" &&
                !isNoOpSchedule &&
                rampState.name.trim()
              ) {
                rampScheduleInline = {
                  mode: "create",
                  name: isScheduleMode
                    ? scheduleAutoName(rampState)
                    : rampState.name.trim(),
                  environment,
                  ...(!isScheduleMode
                    ? {
                        startActions: buildRampStartActionsFromRule(
                          values as FeatureRule,
                          "t1",
                          ruleId,
                        ),
                      }
                    : {}),
                  steps: buildRampSteps(rampState.steps, "t1", ruleId),
                  endActions: !isScheduleMode
                    ? buildEndActions(rampState.endPatch, ruleId)
                    : rampState.endScheduleAt
                      ? [
                          {
                            targetType: "feature-rule" as const,
                            targetId: "t1",
                            patch: { ruleId, enabled: false },
                          },
                        ]
                      : undefined,
                  startDate: rampState.startDate || null,
                  cutoffDate: isScheduleMode
                    ? rampState.endScheduleAt || null
                    : rampState.cutoffDate || null,
                  monitoringConfig: buildMonitoringConfig(
                    rampState.monitoring,
                    rampState.steps,
                  ),
                  requiresStartApproval: rampState.requiresStartApproval
                    ? true
                    : null,
                  ...(rampState.lockFeature
                    ? { lockdownConfig: { mode: "locked" as const } }
                    : { lockdownConfig: { mode: "none" as const } }),
                };
              } else if (
                !isNoOpSchedule &&
                rampState.mode === "edit" &&
                ruleRampSchedule?.id &&
                // Multi-step ramps can't be edited once running (re-capturing
                // steps/startDate mid-ramp is unsafe). Simple schedules have no
                // step machinery — editing a running one only changes its
                // cutoffDate/name, which the publish-time applier handles safely
                // (FeatureModel.createRampSchedulesForRevision) — so allow it.
                (isScheduleMode || ruleRampSchedule.status !== "running")
              ) {
                rampScheduleInline = {
                  mode: "update",
                  rampScheduleId: ruleRampSchedule.id,
                  name: isScheduleMode
                    ? scheduleAutoName(rampState)
                    : rampState.name.trim() || undefined,
                  ...(!isScheduleMode
                    ? {
                        // Only re-capture startActions for ramps that haven't
                        // started yet. Once a ramp is paused/running, startActions
                        // represent the pre-ramp rule state (the rollback restore
                        // point) and must not be overwritten with the current
                        // runtime coverage.
                        ...(["pending", "ready"].includes(
                          ruleRampSchedule?.status ?? "",
                        )
                          ? {
                              startActions: buildRampStartActionsFromRule(
                                values as FeatureRule,
                                activeTargetId,
                                ruleId,
                              ),
                            }
                          : {}),
                      }
                    : {}),
                  steps: buildRampSteps(
                    rampState.steps,
                    activeTargetId,
                    ruleId,
                  ),
                  endActions: !isScheduleMode
                    ? buildEndActions(rampState.endPatch, ruleId)
                    : rampState.endScheduleAt
                      ? [
                          {
                            targetType: "feature-rule" as const,
                            targetId: activeTargetId,
                            patch: { ruleId, enabled: false },
                          },
                        ]
                      : undefined,
                  startDate: rampState.startDate || null,
                  cutoffDate: isScheduleMode
                    ? rampState.endScheduleAt || null
                    : rampState.cutoffDate || null,
                  monitoringConfig: buildMonitoringConfig(
                    rampState.monitoring,
                    rampState.steps,
                  ),
                  requiresStartApproval: rampState.requiresStartApproval
                    ? true
                    : null,
                  ...(rampState.lockFeature
                    ? { lockdownConfig: { mode: "locked" as const } }
                    : { lockdownConfig: { mode: "none" as const } }),
                };
              } else if (
                isNoOpSchedule &&
                rampState.mode === "edit" &&
                ruleRampSchedule?.id
              ) {
                // Schedule became a no-op (e.g. user switched to "Immediately"
                // with no end date) — detach the existing schedule.
                rampScheduleInline = {
                  mode: "detach",
                  rampScheduleId: ruleRampSchedule.id,
                  deleteScheduleWhenEmpty: true,
                };
                restoreEnabledOnDetach = scheduleNeverFired;
              } else if (
                isNoOpSchedule &&
                rampState.mode === "create" &&
                pendingCreateAction
              ) {
                // Pending-create schedule reduced to a no-op (e.g. user cleared
                // the dates) — drop the pending create from the draft so we
                // don't publish a useless schedule doc.
                rampScheduleInline = { mode: "clear" };
                restoreEnabledOnDetach = true;
              } else if (rampState.mode === "off" && ruleRampSchedule?.id) {
                // User unchecked the ramp schedule checkbox — detach this rule from the ramp
                rampScheduleInline = {
                  mode: "detach",
                  rampScheduleId: ruleRampSchedule.id,
                  deleteScheduleWhenEmpty: true,
                };
                restoreEnabledOnDetach = scheduleNeverFired;
              } else if (rampState.mode === "off" && pendingCreateAction) {
                // Pending-create schedule only exists in the draft (not yet published) —
                // user removed the schedule, so clear the create action from the draft.
                rampScheduleInline = { mode: "clear" };
                restoreEnabledOnDetach = true;
              } else if (rampState.mode === "off" && hasPendingDetach) {
                // User saved without re-configuring a schedule while a pending detach exists —
                // clear the detach action from the draft (cancel the pending removal)
                rampScheduleInline = { mode: "clear" };
              }
            }
          }

          if (restoreEnabledOnDetach && !values.enabled) {
            values.enabled = true;
          }

          // Targeting fields (condition, savedGroups, prerequisites) are always
          // written directly to the rule — they must be live immediately. For
          // pre-start ramps (pending/ready), they're ALSO captured into
          // startActions by buildRampStartActionsFromRule above, so the ramp
          // knows the initial state for rollback purposes. We no longer strip
          // these fields from the rule: the ramp engine overlays them via
          // computeEffectivePatch (which seeds from startActions) when it
          // advances, but the rule must have them set immediately for the period
          // between publish and ramp-start (or if the ramp never starts).

          if (
            shouldPublishRuleDisabled(
              rampScheduleInline,
              ruleRampSchedule?.status,
            )
          ) {
            values = { ...values, enabled: false };
          }

          res = await apiCall<{ version: number }>(
            `/feature/${feature.id}/${targetVersion}/rule`,
            {
              method: "PUT",
              body: JSON.stringify({
                rule: values,
                ruleId,
                ...(baselineRule ? { baseline: { rule: baselineRule } } : {}),
                ...(rampScheduleInline
                  ? { rampSchedule: rampScheduleInline }
                  : {}),
              } as PutFeatureRuleBody),
            },
            (responseData) => {
              if (responseData?.status === 409 && responseData?.conflict) {
                conflictSignaledRef.current = true;
                const payload = responseData.conflict as PutFeatureRuleConflict;
                setConflict({ ...payload, baseAtConflict: baselineRule });
                setConflictResolutions(new Map());
                // The form is the merge preview: fields only THEY changed are
                // applied into the form so what the user sees is what a save
                // would keep. Contested fields stay as the user's version.
                if (
                  payload.merge &&
                  !payload.merge.wholeRule &&
                  payload.currentRule
                ) {
                  const cur = payload.currentRule as unknown as Record<
                    string,
                    unknown
                  >;
                  for (const f of payload.merge.theirFields) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    form.setValue(f as any, cur[f] as any, {
                      shouldDirty: true,
                    });
                  }
                }
                // Rebase: the user has now seen their version, so the next
                // save is an informed decision, not a silent overwrite.
                setBaselineRule(
                  payload.currentRule
                    ? cloneDeep(payload.currentRule)
                    : undefined,
                );
              }
            },
          );
        }
      } else {
        // Build optional inline ramp payload for atomic rule+ramp creation
        let rampScheduleInline: PostFeatureRuleBody["rampSchedule"] | undefined;
        if (
          (values.type === "rollout" || values.type === "force") &&
          rampSectionState.mode !== "off"
        ) {
          const effectiveRuleId = pregenRuleId;
          // Defensively scrub patches to only include fields valid for this rule type
          const rampState =
            values.type === "force" || values.type === "rollout"
              ? scrubRampStateForRuleType(rampSectionState)
              : rampSectionState;
          const isScheduleMode = scheduleType === "schedule";
          const isNoOpSchedule =
            isScheduleMode && !rampState.startDate && !rampState.endScheduleAt;
          if (rampState.mode === "create" && !isNoOpSchedule) {
            rampScheduleInline = {
              mode: "create",
              name: isScheduleMode
                ? scheduleAutoName(rampState)
                : rampState.name.trim(),
              // Single environment: scope patches to that env only.
              // Multiple environments: omit so the ramp applies to all matching ruleIds.
              environment:
                !scopeAllEnvs && selectedEnvironments.length === 1
                  ? selectedEnvironments[0]
                  : undefined,
              ...(!isScheduleMode
                ? {
                    startActions: buildRampStartActionsFromRule(
                      values as FeatureRule,
                      "t1",
                      effectiveRuleId,
                    ),
                  }
                : {}),
              steps: buildRampSteps(rampState.steps, "t1", effectiveRuleId),
              endActions: !isScheduleMode
                ? buildEndActions(rampState.endPatch, effectiveRuleId)
                : rampState.endScheduleAt
                  ? [
                      {
                        targetType: "feature-rule" as const,
                        targetId: "t1",
                        patch: { ruleId: effectiveRuleId, enabled: false },
                      },
                    ]
                  : undefined,
              startDate: rampState.startDate || null,
              cutoffDate: isScheduleMode
                ? rampState.endScheduleAt || null
                : rampState.cutoffDate || null,
              monitoringConfig: buildMonitoringConfig(
                rampState.monitoring,
                rampState.steps,
              ),
              requiresStartApproval: rampState.requiresStartApproval
                ? true
                : null,
              ...(rampState.lockFeature
                ? { lockdownConfig: { mode: "locked" as const } }
                : { lockdownConfig: { mode: "none" as const } }),
            };
          }
        }

        if (shouldPublishRuleDisabled(rampScheduleInline)) {
          values = { ...values, enabled: false };
        }

        // Targeting is always written directly to the rule so it's live
        // immediately. For pre-start ramps, buildRampStartActionsFromRule
        // (above) also captures it into startActions for rollback purposes.
        // We no longer strip condition/savedGroups/prerequisites from the rule.

        res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${targetVersion}/rule`,
          {
            method: "POST",
            body: JSON.stringify({
              rule: values,
              environments: scopeAllEnvs
                ? environments.map((e) => e.id)
                : selectedEnvironments,
              safeRolloutFields,
              rampSchedule: rampScheduleInline,
            } as PostFeatureRuleBody),
          },
        );
      }

      await mutate();
      setVersion(res?.version ?? targetVersion);
    } catch (e) {
      track("Feature Rule Error", {
        source: ruleAction,
        ruleIndex: i,
        environment,
        numEnvironments: selectedEnvironments.length,
        type: values.type,
        hasCondition: values.condition && values.condition.length > 2,
        hasSavedGroups: !!values.savedGroups?.length,
        hasPrerequisites: !!values.prerequisites?.length,
        hasDescription: values.description.length > 0,
        error: e.message,
      });
      forceConditionRender();
      // A conflict renders its own banner; an empty message keeps the Modal's
      // error display from duplicating it.
      if (conflictSignaledRef.current) {
        conflictSignaledRef.current = false;
        throw new Error("");
      }
      throw e;
    }
  });

  // One-line conflict warning inside the draft selector's selected option;
  // "View details" reveals only the raw diff. Per-field resolution callouts
  // (with their own CTAs) render below the selector — see conflictCallouts.
  const conflictAlert = conflict ? (
    <Box style={{ width: "100%" }}>
      <Flex align="center" gap="3" wrap="wrap">
        <HelperText status="warning">
          {!conflict.currentRule
            ? "This rule was removed while you had it open — saving re-adds it."
            : draftMode === "new"
              ? "This rule was also updated in the draft you started from — saving here keeps both versions."
              : "This rule was also updated here while you had it open — resolve the conflicting edits below, or save to a new draft."}
        </HelperText>
        {conflict.currentRule && (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowConflictDetails((s) => !s);
            }}
          >
            {showConflictDetails ? "Hide details" : "View details"}
          </a>
        )}
      </Flex>
      {showConflictDetails && conflict.currentRule && (
        <Box
          mt="2"
          style={{
            background: "var(--color-surface)",
            borderRadius: "var(--radius-2)",
            overflow: "hidden",
          }}
        >
          <CompactInlineDiff
            a={stringifyForRawDiff(
              conflict.baseAtConflict
                ? normalizeFeatureRules([conflict.baseAtConflict])
                : [],
            )}
            b={stringifyForRawDiff(
              normalizeFeatureRules([conflict.currentRule]),
            )}
            leftTitle="When you opened this editor"
            rightTitle="Their version"
          />
        </Box>
      )}
    </Box>
  ) : undefined;

  // One callout per contested chunk, immediately visible below the selector:
  // both values side by side, and an explicit Keep mine / Use theirs choice.
  // The save CTA stays disabled until every one is answered (or the user
  // switches to a new draft).
  const conflictCallouts = conflict ? (
    <>
      {conflict.merge && !conflict.merge.wholeRule && conflict.currentRule ? (
        conflict.merge.contested.map(({ key, fields }) => {
          const resolution = conflictResolutions.get(key);
          return (
            <Callout status="warning" mb="3" key={key}>
              <Flex align="center" gap="2" wrap="wrap">
                <Text weight="semibold">
                  {fields.length > 1 ? fields.join(" + ") : key}
                </Text>
                <Text>— you set</Text>
                <code
                  style={{
                    background: "var(--color-surface)",
                    borderRadius: "var(--radius-1)",
                    padding: "1px 6px",
                  }}
                >
                  {fmtChunkValue(
                    form.getValues() as unknown as FeatureRule,
                    fields,
                  )}
                </code>
                <Text>, they set</Text>
                <code
                  style={{
                    background: "var(--color-surface)",
                    borderRadius: "var(--radius-1)",
                    padding: "1px 6px",
                  }}
                >
                  {fmtChunkValue(conflict.currentRule, fields)}
                </code>
                {resolution ? (
                  <Text weight="semibold">
                    ✓ {resolution === "mine" ? "keeping yours" : "using theirs"}
                  </Text>
                ) : (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        setConflictResolutions(
                          (m) => new Map([...m, [key, "mine" as const]]),
                        );
                      }}
                    >
                      Keep mine
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const cur = conflict.currentRule as unknown as Record<
                          string,
                          unknown
                        >;
                        for (const f of fields) {
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          form.setValue(f as any, cur[f] as any, {
                            shouldDirty: true,
                          });
                        }
                        setConflictResolutions(
                          (m) => new Map([...m, [key, "theirs" as const]]),
                        );
                      }}
                    >
                      Use theirs
                    </Button>
                  </>
                )}
              </Flex>
            </Callout>
          );
        })
      ) : (
        <Callout status="warning" mb="3">
          <Flex align="center" gap="3" wrap="wrap">
            <Text>
              {conflict.currentRule
                ? "Their version can't be merged with yours automatically. Saving replaces it with this form."
                : "Saving will re-add this rule with what's in this form."}
            </Text>
            {conflictResolutions.has("__rule__") ? (
              <Text weight="semibold">✓ acknowledged</Text>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  setConflictResolutions(
                    (m) => new Map([...m, ["__rule__", "mine" as const]]),
                  )
                }
              >
                {conflict.currentRule ? "Replace their version" : "Re-add it"}
              </Button>
            )}
          </Flex>
        </Callout>
      )}
    </>
  ) : null;

  if (newRuleOverviewPage) {
    return (
      <Modal
        trackingEventModalType="feature-rule-overview"
        open={true}
        close={close}
        size="lg"
        cta={
          <>
            Next{" "}
            <PiCaretRight className="position-relative" style={{ top: -1 }} />
          </>
        }
        ctaEnabled={!!overviewRuleType}
        header="New Rule"
        submit={submitOverview}
        autoCloseOnSubmit={false}
      >
        <DraftSelectorForChanges
          feature={feature}
          revisionList={revisionList}
          mode={draftMode}
          setMode={setDraftMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={false}
          gatedEnvSet={gatedEnvSet}
        />
        <div className="bg-highlight rounded p-3 mb-3">
          <Text size="xl" weight="semibold" as="div" mb="4">
            Rule Type
          </Text>
          <RadioCards
            mt="4"
            mb="2"
            width="100%"
            options={[
              {
                value: "force",
                label: "Targeting rule",
                description:
                  "Release a feature value with optional targeting, schedule, ramp-up, and monitoring",
              },
              {
                value: "experiment",
                label: "Experiment",
                description:
                  "Measure the impact of this feature on your key metrics",
              },
              {
                value: "bandit",
                disabled: !hasMultiArmedBanditFeature,
                label: (
                  <PremiumTooltip
                    commercialFeature="multi-armed-bandits"
                    usePortal={true}
                  >
                    Bandit
                  </PremiumTooltip>
                ),
                description:
                  "Find a winner among many variations on one goal metric",
              },
            ]}
            value={overviewRadioSelectorRuleType}
            setValue={(v: "force" | "rollout" | "experiment" | "bandit") => {
              setOverviewRadioSelectorRuleType(v);
              if (v === "force") {
                setOverviewRuleType("force");
              } else if (v === "rollout") {
                setOverviewRuleType("rollout");
              } else {
                setOverviewRuleType("experiment-ref-new");
              }
            }}
          />

          <Callout status="wizard" mt="6" size="sm">
            <Flex align="center" gap="2">
              <Box flexGrow="1">
                <Text as="div">
                  Looking for <strong>Safe Rollouts</strong>?
                </Text>
                <Text as="div" size="sm" mt="1">
                  Guardrail monitoring can now be added to a Targeting
                  Rule&apos;s <strong>Ramp-up</strong> schedule
                </Text>
              </Box>
              {hasCommercialFeature("safe-rollout") ? (
                <Button
                  color="inherit"
                  variant="soft"
                  size="sm"
                  onClick={() => {
                    setOverviewRadioSelectorRuleType("rollout");
                    setOverviewRuleType("rollout");
                    setNewRuleOverviewPage(false);
                    changeRuleType("rollout");
                    setScheduleType("ramp");
                    setRampSectionState((prev) => ({
                      ...prev,
                      mode: prev.mode === "off" ? "create" : prev.mode,
                      steps: prev.steps.map((s) => ({
                        ...s,
                        monitored: true,
                      })),
                    }));
                  }}
                >
                  Show me
                </Button>
              ) : (
                <PremiumTooltip
                  commercialFeature="safe-rollout"
                  usePortal={true}
                >
                  <Button color="inherit" variant="soft" size="sm" disabled>
                    Show me
                  </Button>
                </PremiumTooltip>
              )}
            </Flex>
          </Callout>
        </div>

        {overviewRadioSelectorRuleType === "experiment" && (
          <>
            <h5>Add Experiment</h5>
            <RadioGroup
              options={[
                {
                  value: "experiment-ref-new",
                  label: "Create new Experiment",
                },
                {
                  value: "experiment-ref",
                  label: "Add existing Experiment",
                },
              ]}
              value={overviewRuleType}
              setValue={(v: OverviewRuleType) => setOverviewRuleType(v)}
              mb="4"
            />
          </>
        )}
        {overviewRadioSelectorRuleType === "bandit" && (
          <>
            <h5>Add Bandit</h5>
            <RadioGroup
              options={[
                {
                  value: "experiment-ref-new",
                  label: "Create new Bandit",
                },
                {
                  value: "experiment-ref",
                  label: "Add existing Bandit",
                },
              ]}
              value={overviewRuleType}
              setValue={(v: OverviewRuleType) => setOverviewRuleType(v)}
              mb="4"
            />
          </>
        )}
      </Modal>
    );
  }

  const envScopeProps = {
    environments,
    allEnvironments: scopeAllEnvs,
    setAllEnvironments: setScopeAllEnvs,
    selectedEnvironments,
    setSelectedEnvironments,
    disabledEnvironmentIds,
  };

  const projectScopeProps = {
    allProjects: scopeAllProjects,
    setAllProjects: setScopeAllProjects,
    selectedProjects,
    setSelectedProjects,
    // Limit scoping to the feature's delivery set (null = all projects).
    allowedProjectIds: getTargetingProjectIds(feature),
  };

  // Resolved env list used by child components that care about which envs the
  // rule currently covers (prereq cycle checks, targeting previews, etc).
  // When `allEnvironments` is on, treat every applicable env as in-scope.
  const effectiveEnvList = scopeAllEnvs
    ? environments.map((e) => e.id)
    : selectedEnvironments;

  return (
    <FormProvider {...form}>
      <PagedModal
        trackingEventModalType={trackingEventModalType}
        close={close}
        size="lg"
        cta={
          hasRampPage && step === 0 ? (
            <>
              Next: Ramp-up{" "}
              <PiCaretRight className="position-relative" style={{ top: -1 }} />
            </>
          ) : conflict ? (
            "Save my version"
          ) : (
            "Save to Draft"
          )
        }
        forceCtaText={hasRampPage && step === 0}
        ctaEnabled={
          newRuleOverviewPage
            ? ruleType !== undefined
            : hasRampPage && step === 0
              ? !isCyclic && !prerequisiteTargetingSdkIssues
              : canSubmit && conflictResolved
        }
        disabledMessage={
          hasRampPage && step === 0
            ? undefined
            : !conflictResolved
              ? "Resolve the conflicting edits above, or save to a new draft."
              : (monitoringError ?? undefined)
        }
        header={headerText}
        docSection={
          ruleType === "experiment-ref-new"
            ? "experimentConfiguration"
            : undefined
        }
        step={step}
        setStep={setStep}
        hideNav={
          !hasRampPage &&
          ruleType !== "experiment-ref-new" &&
          ruleType !== "experiment"
        }
        backButton={true}
        onBackFirstStep={
          mode === "create" ? () => setNewRuleOverviewPage(true) : undefined
        }
        submit={submit}
        bodyPrefix={
          <>
            <DraftSelectorForChanges
              feature={feature}
              revisionList={revisionList}
              mode={draftMode}
              setMode={setDraftMode}
              selectedDraft={selectedDraft}
              setSelectedDraft={setSelectedDraft}
              canAutoPublish={false}
              gatedEnvSet={gatedEnvSet}
              alert={conflictAlert}
            />
            {draftMode !== "new" && conflictCallouts}
          </>
        }
      >
        {(ruleType === "force" || ruleType === "rollout") && (
          <Page display="Rule Configuration">
            <StandardRuleFields
              ruleType={ruleType}
              feature={feature}
              environments={effectiveEnvList}
              defaultValues={defaultValues}
              setPrerequisiteTargetingSdkIssues={
                setPrerequisiteTargetingSdkIssues
              }
              isCyclic={isCyclic}
              cyclicFeatureId={cyclicFeatureId}
              conditionKey={conditionKey}
              scheduleToggleEnabled={scheduleToggleEnabled}
              setScheduleToggleEnabled={setScheduleToggleEnabled}
              ruleRampSchedule={ruleRampSchedule}
              rampSectionState={rampSectionState}
              setRampSectionState={setRampSectionState}
              scheduleType={scheduleType}
              setScheduleType={setScheduleType}
              envScope={envScopeProps!}
              projectScope={projectScopeProps}
              isLiveRule={isLiveRule}
              isNew={mode === "create"}
              onRuleCyclicChange={onRuleCyclicChange}
            />
          </Page>
        )}

        {hasRampPage && (
          <Page display="Ramp-up Schedule">
            <RampScheduleSection
              ruleRampSchedule={ruleRampSchedule}
              state={rampSectionState}
              setState={setRampSectionState}
              pendingDetach={hasPendingDetach}
              preloadedTemplates={rampTemplatesData?.rampScheduleTemplates}
              embedded
              readOnly={!!ruleRampSchedule && !rampIsEditable}
              hideNameField={true}
              feature={feature}
              environments={environments.map((e) => e.id)}
              hashAttribute={form.watch("hashAttribute") as string}
              setHashAttribute={(v) => form.setValue("hashAttribute", v)}
              seed={form.watch("seed") as string}
              setSeed={(v) => form.setValue("seed", v)}
              hashVersion={form.watch("hashVersion") as 1 | 2 | undefined}
              setHashVersion={(v: 1 | 2) => form.setValue("hashVersion", v)}
              attributeSchema={attributeSchema}
              ruleId={form.watch("id") as string}
              featureId={feature.id}
              sparse={!!form.watch("sparse")}
            />
          </Page>
        )}

        {ruleType === "safe-rollout" && (
          <SafeRolloutFields
            feature={feature}
            environment={environment}
            defaultValues={defaultValues}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
            isCyclic={isCyclic}
            cyclicFeatureId={cyclicFeatureId}
            conditionKey={conditionKey}
            scheduleToggleEnabled={scheduleToggleEnabled}
            setScheduleToggleEnabled={setScheduleToggleEnabled}
            mode={mode}
            isDraft={!safeRollout?.startedAt}
            envScope={envScopeProps}
            projectScope={projectScopeProps}
            onRuleCyclicChange={onRuleCyclicChange}
          />
        )}

        {(ruleType === "experiment-ref" || ruleType === "experiment") &&
        experimentType === "experiment" ? (
          <ExperimentRefFields
            feature={feature}
            existingRule={mode === "edit"}
            defaultValues={defaultValues}
            changeRuleType={changeRuleType}
            noSchedule={!defaultHasSchedule}
            scheduleToggleEnabled={scheduleToggleEnabled}
            setScheduleToggleEnabled={setScheduleToggleEnabled}
            envScope={envScopeProps!}
            projectScope={projectScopeProps}
          />
        ) : null}

        {(ruleType === "experiment-ref" || ruleType === "experiment") &&
        experimentType === "bandit" ? (
          <BanditRefFields
            feature={feature}
            existingRule={mode === "edit"}
            changeRuleType={changeRuleType}
            envScope={envScopeProps!}
            projectScope={projectScopeProps}
          />
        ) : null}

        {(ruleType === "experiment-ref-new" &&
          experimentType === "experiment") ||
        ruleType === "experiment"
          ? ["Overview", "Traffic", "Targeting", "Metrics"].map((p, i) => (
              <Page display={p} key={i}>
                <ExperimentRefNewFields
                  step={i}
                  source="rule"
                  feature={feature}
                  project={feature.project}
                  environments={effectiveEnvList}
                  defaultValues={defaultValues}
                  prerequisiteValue={form.watch("prerequisites") || []}
                  setPrerequisiteValue={(prerequisites) =>
                    form.setValue("prerequisites", prerequisites)
                  }
                  setPrerequisiteTargetingSdkIssues={
                    setPrerequisiteTargetingSdkIssues
                  }
                  isCyclic={isCyclic}
                  cyclicFeatureId={cyclicFeatureId}
                  savedGroupValue={form.watch("savedGroups") || []}
                  setSavedGroupValue={(savedGroups) =>
                    form.setValue("savedGroups", savedGroups)
                  }
                  defaultConditionValue={form.watch("condition") || ""}
                  setConditionValue={(value) =>
                    form.setValue("condition", value)
                  }
                  conditionKey={conditionKey}
                  scheduleToggleEnabled={scheduleToggleEnabled}
                  setScheduleToggleEnabled={setScheduleToggleEnabled}
                  coverage={form.watch("coverage") || 0}
                  setCoverage={(coverage) =>
                    form.setValue("coverage", coverage)
                  }
                  setWeight={(i, weight) =>
                    form.setValue(`values.${i}.weight`, weight)
                  }
                  variations={
                    form
                      .watch("values")
                      ?.map((v: ExperimentValue & { id?: string }) => {
                        return {
                          value: v.value || "",
                          name: v.name,
                          weight: v.weight,
                          id: v.id || generateVariationId(),
                        };
                      }) || []
                  }
                  setVariations={(variations) =>
                    form.setValue("values", variations)
                  }
                  variationValuesAsIds={false}
                  hideVariationIds={true}
                  startEditingIndexes={true}
                  orgStickyBucketing={orgStickyBucketing}
                  setCustomFields={(customFields) =>
                    form.setValue("customFields", customFields)
                  }
                  envScope={i === 0 ? envScopeProps : undefined}
                  projectScope={i === 0 ? projectScopeProps : undefined}
                  onRuleCyclicChange={onRuleCyclicChange}
                />
              </Page>
            ))
          : null}

        {ruleType === "experiment-ref-new" && experimentType === "bandit"
          ? ["Overview", "Traffic", "Targeting", "Metrics"].map((p, i) => (
              <Page display={p} key={i}>
                <BanditRefNewFields
                  step={i}
                  source="rule"
                  feature={feature}
                  project={feature.project}
                  environments={effectiveEnvList}
                  prerequisiteValue={form.watch("prerequisites") || []}
                  setPrerequisiteValue={(prerequisites) =>
                    form.setValue("prerequisites", prerequisites)
                  }
                  setPrerequisiteTargetingSdkIssues={
                    setPrerequisiteTargetingSdkIssues
                  }
                  isCyclic={isCyclic}
                  cyclicFeatureId={cyclicFeatureId}
                  savedGroupValue={form.watch("savedGroups") || []}
                  setSavedGroupValue={(savedGroups) =>
                    form.setValue("savedGroups", savedGroups)
                  }
                  defaultConditionValue={form.watch("condition") || ""}
                  setConditionValue={(value) =>
                    form.setValue("condition", value)
                  }
                  conditionKey={conditionKey}
                  coverage={form.watch("coverage") || 0}
                  setCoverage={(coverage) =>
                    form.setValue("coverage", coverage)
                  }
                  setWeight={(i, weight) =>
                    form.setValue(`values.${i}.weight`, weight)
                  }
                  variations={
                    form
                      .watch("values")
                      ?.map((v: ExperimentValue & { id?: string }) => {
                        return {
                          value: v.value || "",
                          name: v.name,
                          weight: v.weight,
                          id: v.id || generateVariationId(),
                        };
                      }) || []
                  }
                  setVariations={(variations) =>
                    form.setValue("values", variations)
                  }
                  disableBanditConversionWindow={disableBanditConversionWindow}
                  setDisableBanditConversionWindow={
                    setDisableBanditConversionWindow
                  }
                  envScope={i === 0 ? envScopeProps : undefined}
                  projectScope={i === 0 ? projectScopeProps : undefined}
                  onRuleCyclicChange={onRuleCyclicChange}
                />
              </Page>
            ))
          : null}
      </PagedModal>
    </FormProvider>
  );
}
