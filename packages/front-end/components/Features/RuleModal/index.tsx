import { FormProvider, useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
  ScheduleRule,
} from "shared/types/feature";
import { useMemo, useState, useEffect } from "react";
import uniqId from "uniqid";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  filterEnvironmentsByFeature,
  generateVariationId,
  isProjectListValidForProject,
  getReviewSetting,
} from "shared/util";
import { PiCaretRight } from "react-icons/pi";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { getScopedSettings } from "shared/settings";
import { getAllVariations, getLatestPhaseVariations } from "shared/experiments";
import { kebabCase } from "lodash";
import { Text } from "@radix-ui/themes";
import {
  CreateSafeRolloutInterface,
  SafeRolloutInterface,
  SafeRolloutRule,
  RampScheduleInterface,
} from "shared/validators";
import {
  PostFeatureRuleBody,
  PutFeatureRuleBody,
} from "shared/types/feature-rule";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import {
  NewExperimentRefRule,
  getDefaultRuleValue,
  getFeatureDefaultValue,
  getRules,
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
import { allConnectionsSupportBucketingV2 } from "@/components/Experiment/HashVersionSelector";
import Modal from "@/components/Modal";
import { getNewExperimentDatasourceDefaults } from "@/components/Experiment/NewExperimentForm";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import RadioCards from "@/ui/RadioCards";
import RadioGroup from "@/ui/RadioGroup";
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
import HelperText from "@/ui/HelperText";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import { useTemplates } from "@/hooks/useTemplates";
import { useBatchPrerequisiteStates } from "@/hooks/usePrerequisiteStates";
import SafeRolloutFields from "@/components/Features/RuleModal/SafeRolloutFields";
import EnvironmentSelect from "@/components/Features/FeatureModal/EnvironmentSelect";
import {
  type RampSectionState,
  defaultRampSectionState,
  rampScheduleToSectionState,
  createActionToSectionState,
  buildRampSteps,
  buildStartActions,
  buildEndScheduleActions,
  validateRampSectionState,
  isRampSectionConfigured,
  scrubRampStateForRuleType,
} from "@/components/Features/RuleModal/RampScheduleSection";
export interface Props {
  close: () => void;
  feature: FeatureInterface;
  setVersion: (version: number) => void;
  mutate: () => void;
  i: number;
  environment: string;
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

export default function RuleModal({
  close,
  feature,
  i,
  mutate,
  environment,
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

  const rules = getRules(feature, environment);
  const rule: (typeof rules)[number] | undefined = rules[i];
  const safeRollout =
    rule?.type === "safe-rollout"
      ? safeRolloutsMap?.get(rule?.safeRolloutId)
      : undefined;

  // Pre-generate a rule ID so we can reference it in the ramp schedule creation
  // without an extra round-trip. The back-end preserves a truthy id sent by the client.
  const [pregenRuleId] = useState(() => uniqId("fr_"));

  // Find any existing ramp schedule that already targets this specific rule
  const ruleRampSchedule = rule?.id
    ? rampSchedules.find((rs) => rs.targets.some((t) => t.ruleId === rule.id))
    : undefined;

  // Check if there's a pending detach action for this rule in the draft.
  // When true, the ramp section should open as "off" so users don't think
  // the schedule is still active. Re-enabling and saving will clear the detach.
  const hasPendingDetach =
    rule?.id != null &&
    (draftRevision?.rampActions ?? []).some(
      (a) => a.mode === "detach" && a.ruleId === rule.id,
    );

  // Find a pending create action for this rule, if any (used when no live schedule exists yet).
  const pendingCreateAction =
    !ruleRampSchedule && !hasPendingDetach && rule?.id
      ? (draftRevision?.rampActions ?? []).find(
          (a) => a.mode === "create" && a.ruleId === rule.id,
        )
      : undefined;
  const pendingCreateActionTyped =
    pendingCreateAction?.mode === "create" ? pendingCreateAction : undefined;

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
      return defaultRampSectionState(ruleRampSchedule);
    },
  );
  const { datasources, project: currentProject } = useDefinitions();
  const { experimentsMap, mutateExperiments } = useExperiments();
  const { templates: allTemplates } = useTemplates();
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);

  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] =
    useState(false);
  const [disableBanditConversionWindow, setDisableBanditConversionWindow] =
    useState(false);

  const settings = useOrgSettings();
  const { settings: scopedSettings } = getScopedSettings({ organization });

  const defaultDraft = useDefaultDraft(revisionList);

  const [draftMode, setDraftMode] = useState<DraftMode>(
    defaultDraft != null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  // Determines which draft/revision to target in the API call.
  const targetVersion =
    draftMode === "existing" && selectedDraft != null
      ? selectedDraft
      : feature.version;

  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature]);

  const defaultRuleValues = getDefaultRuleValue({
    defaultValue: getFeatureDefaultValue(feature),
    ruleType: defaultType,
    attributeSchema,
    isSafeRolloutAutoRollbackEnabled: true,
  });

  const convertRuleToFormValues = (rule: FeatureRule) => {
    if (rule?.type === "safe-rollout") {
      return {
        ...rule,
        safeRolloutFields: safeRollout,
      };
    }
    return rule;
  };

  const defaultValues = {
    ...defaultRuleValues,
    ...convertRuleToFormValues(rule),
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

  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>(
    settings.defaultFeatureRulesInAllEnvs
      ? environments.map((env) => env.id)
      : [environment],
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

  const hasSafeRolloutsFeature = hasCommercialFeature("safe-rollout");

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
    text +=
      ruleType === "safe-rollout"
        ? ` in ${environment}`
        : ` in ${selectedEnvironments[0]}${
            selectedEnvironments.length > 1
              ? ` + ${selectedEnvironments.length - 1} more`
              : ""
          }`;
    return text;
  }, [ruleType, experimentType, mode, environment, selectedEnvironments]);

  const trackingEventModalType = useMemo(
    () => kebabCase(headerText),
    [headerText],
  );

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    feature.project,
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

  const prerequisites = form.watch("prerequisites") || [];

  const { checkRulePrerequisitesCyclic } = useBatchPrerequisiteStates({
    baseFeatureId: feature.id,
    featureIds: [],
    environments: [environment],
    enabled: prerequisites.length > 0,
    checkRulePrerequisites:
      prerequisites.length > 0
        ? {
            environment,
            ruleIndex: i,
            prerequisites: prerequisites.map((p) => ({
              id: p.id,
              condition: p.condition,
            })),
          }
        : undefined,
  });

  const isCyclic = checkRulePrerequisitesCyclic?.wouldBeCyclic ?? false;
  const cyclicFeatureId = checkRulePrerequisitesCyclic?.cyclicFeatureId ?? null;

  const [prerequisiteTargetingSdkIssues, setPrerequisiteTargetingSdkIssues] =
    useState(false);
  const canSubmit = useMemo(() => {
    return !isCyclic && !prerequisiteTargetingSdkIssues;
  }, [isCyclic, prerequisiteTargetingSdkIssues]);

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
      scheduleType === "ramp" &&
      rampSectionState.mode !== "off" &&
      (rampSectionState.steps.some(
        (step) => step.patch.coverage !== undefined,
      ) ||
        rampSectionState.startPatch.coverage !== undefined ||
        rampSectionState.endPatch.coverage !== undefined);

    // Determine target rule type and coverage based on current state
    let targetType: "force" | "rollout" =
      currentType === "rollout" ? "rollout" : "force";
    let targetCoverage = currentCoverage ?? 1;

    // If there's a ramp with coverage, must be rollout
    if (hasRampWithCoverage) {
      targetType = "rollout";
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
      if (targetType === "rollout" && !form.getValues("hashAttribute")) {
        const defaultHash =
          attributeSchema?.find((a) => a.hashAttribute)?.property ||
          attributeSchema?.[0]?.property ||
          "id";
        form.setValue("hashAttribute", defaultHash);
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

    // unset the ID if we're duplicating the rule.
    if (mode === "duplicate") {
      values.id = "";
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
          variations: values.values.map((v, i) => ({
            id: uniqId("var_"),
            key: i + "",
            name: v.name || (i ? `Variation ${i}` : "Control"),
            screenshots: [],
          })),
          phases: [
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
              variationWeights: values.values.map((v) => v.weight),
            },
          ],
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
            values.experimentType === "standard"
              ? feature.holdout?.id
              : undefined,
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
          condition: "",
          savedGroups: [],
          enabled: values.enabled ?? true,
          variations: values.values.map((v, i) => ({
            value: v.value,
            variationId: getAllVariations(res.experiment)[i]?.id || "",
          })),
          scheduleRules: values.scheduleRules || [],
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
        // Force rules don't support hashAttribute or seed; strip them from the form
        // They're only in the form state to be ready if converted to rollout
        // eslint-disable-next-line
        delete (values as any).hashAttribute;
        // eslint-disable-next-line
        delete (values as any).seed;
      }
      if (
        values.scheduleRules &&
        values.scheduleRules.length === 0 &&
        !rule?.scheduleRules
      ) {
        delete values.scheduleRules;
      }

      const correctedRule = validateFeatureRule(values, feature);
      if (correctedRule) {
        form.reset(correctedRule);
        throw new Error(
          "We fixed some errors in the rule. If it looks correct, submit again.",
        );
      }

      const rampValidationError = validateRampSectionState(rampSectionState);
      if (rampValidationError) {
        throw new Error(rampValidationError);
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
        scheduleType === "ramp" &&
        rampSectionState.mode !== "off" &&
        (rampSectionState.steps.some((s) => s.patch.coverage !== undefined) ||
          rampSectionState.startPatch.coverage !== undefined);
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
        if (values.type === "safe-rollout") {
          res = await apiCall(`/safe-rollout/${values.safeRolloutId}`, {
            method: "PUT",
            body: JSON.stringify({
              environment,
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

              // A "schedule" type with both start=immediately and end=never is a no-op —
              // no schedule should be created or updated in this case.
              const isNoOpSchedule =
                isScheduleMode &&
                rampState.startMode !== "specific-time" &&
                !rampState.endScheduleAt;

              // For simple schedules, patches are irrelevant — the schedule only
              // controls enable/disable via disableRuleBefore/disableRuleAfter.
              const effectiveStartPatch = isScheduleMode
                ? {}
                : rampState.startPatch;
              const effectiveEndPatch = isScheduleMode
                ? {}
                : rampState.endPatch;

              if (
                rampState.mode === "create" &&
                !isNoOpSchedule &&
                rampState.name.trim()
              ) {
                const startActions = buildStartActions(
                  effectiveStartPatch,
                  "t1",
                  ruleId,
                );
                const endActions = buildEndScheduleActions(
                  effectiveEndPatch,
                  "t1",
                  ruleId,
                );
                const startTrigger =
                  rampState.startMode === "manual"
                    ? ({ type: "manual" } as const)
                    : rampState.startMode === "specific-time" &&
                        rampState.startTime
                      ? ({
                          type: "scheduled",
                          at: rampState.startTime,
                        } as const)
                      : ({ type: "immediately" } as const);
                rampScheduleInline = {
                  mode: "create",
                  name: isScheduleMode
                    ? scheduleAutoName(rampState)
                    : rampState.name.trim(),
                  environment,
                  steps: buildRampSteps(rampState.steps, "t1", ruleId),
                  startCondition: {
                    trigger: startTrigger,
                    actions: startActions.length ? startActions : undefined,
                  },
                  disableRuleBefore: rampState.disableRuleBefore || undefined,
                  disableRuleAfter: rampState.disableRuleAfter || undefined,
                  endEarlyWhenStepsComplete:
                    rampState.endEarlyWhenStepsComplete,
                  endCondition: rampState.endScheduleAt
                    ? {
                        trigger: {
                          type: "scheduled",
                          at: rampState.endScheduleAt,
                        },
                        actions: endActions.length ? endActions : undefined,
                      }
                    : endActions.length
                      ? { actions: endActions }
                      : undefined,
                };
              } else if (
                !isNoOpSchedule &&
                rampState.mode === "edit" &&
                ruleRampSchedule?.id &&
                !["running", "ready", "pending-approval"].includes(
                  ruleRampSchedule.status,
                )
              ) {
                const startActions = buildStartActions(
                  effectiveStartPatch,
                  "t1",
                  ruleId,
                );
                const endActions = buildEndScheduleActions(
                  effectiveEndPatch,
                  "t1",
                  ruleId,
                );
                const startTrigger =
                  rampState.startMode === "manual"
                    ? ({ type: "manual" } as const)
                    : rampState.startMode === "specific-time" &&
                        rampState.startTime
                      ? ({
                          type: "scheduled",
                          at: rampState.startTime,
                        } as const)
                      : ({ type: "immediately" } as const);
                rampScheduleInline = {
                  mode: "update",
                  rampScheduleId: ruleRampSchedule.id,
                  name: isScheduleMode
                    ? scheduleAutoName(rampState)
                    : rampState.name.trim() || undefined,
                  steps: buildRampSteps(rampState.steps, "t1", ruleId),
                  startCondition: {
                    trigger: startTrigger,
                    actions: startActions.length ? startActions : undefined,
                  },
                  disableRuleBefore: rampState.disableRuleBefore || undefined,
                  disableRuleAfter: rampState.disableRuleAfter || undefined,
                  endEarlyWhenStepsComplete:
                    rampState.endEarlyWhenStepsComplete,
                  endCondition: rampState.endScheduleAt
                    ? {
                        trigger: {
                          type: "scheduled",
                          at: rampState.endScheduleAt,
                        },
                        actions: endActions.length ? endActions : undefined,
                      }
                    : endActions.length
                      ? { actions: endActions }
                      : null,
                };
              } else if (rampState.mode === "off" && ruleRampSchedule?.id) {
                // User unchecked the ramp schedule checkbox — detach this rule from the ramp
                rampScheduleInline = {
                  mode: "detach",
                  rampScheduleId: ruleRampSchedule.id,
                  deleteScheduleWhenEmpty: true,
                };
              } else if (rampState.mode === "off" && pendingCreateAction) {
                // Pending-create schedule only exists in the draft (not yet published) —
                // user removed the schedule, so clear the create action from the draft.
                rampScheduleInline = { mode: "clear" };
              } else if (rampState.mode === "off" && hasPendingDetach) {
                // User saved without re-configuring a schedule while a pending detach exists —
                // clear the detach action from the draft (cancel the pending removal)
                rampScheduleInline = { mode: "clear" };
              }
            }
          }

          // Fix 5a: if disableRuleBefore is set with a non-immediate start,
          // publish the rule as disabled in this revision so the draft includes
          // the enabled:false state from the start.
          if (
            rampScheduleInline &&
            "disableRuleBefore" in rampScheduleInline &&
            rampScheduleInline.disableRuleBefore &&
            "startCondition" in rampScheduleInline &&
            rampScheduleInline.startCondition?.trigger?.type !== "immediately"
          ) {
            values = { ...values, enabled: false };
          }

          res = await apiCall<{ version: number }>(
            `/feature/${feature.id}/${targetVersion}/rule`,
            {
              method: "PUT",
              body: JSON.stringify({
                rule: values,
                environment,
                i,
                ...(rampScheduleInline
                  ? { rampSchedule: rampScheduleInline }
                  : {}),
              } as PutFeatureRuleBody),
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
            isScheduleMode &&
            rampState.startMode !== "specific-time" &&
            !rampState.endScheduleAt;
          const effectiveStartPatch = isScheduleMode
            ? {}
            : rampState.startPatch;
          const effectiveEndPatch = isScheduleMode ? {} : rampState.endPatch;
          if (rampState.mode === "create" && !isNoOpSchedule) {
            const startActions = buildStartActions(
              effectiveStartPatch,
              "t1",
              effectiveRuleId,
            );
            const endActions = buildEndScheduleActions(
              effectiveEndPatch,
              "t1",
              effectiveRuleId,
            );
            const startTrigger =
              rampState.startMode === "manual"
                ? ({ type: "manual" } as const)
                : rampState.startMode === "specific-time" && rampState.startTime
                  ? ({
                      type: "scheduled",
                      at: rampState.startTime,
                    } as const)
                  : ({ type: "immediately" } as const);
            rampScheduleInline = {
              mode: "create",
              name: isScheduleMode
                ? scheduleAutoName(rampState)
                : rampState.name.trim(),
              environment,
              steps: buildRampSteps(rampState.steps, "t1", effectiveRuleId),
              startCondition: {
                trigger: startTrigger,
                actions: startActions.length ? startActions : undefined,
              },
              disableRuleBefore: rampState.disableRuleBefore || undefined,
              disableRuleAfter: rampState.disableRuleAfter || undefined,
              endEarlyWhenStepsComplete: rampState.endEarlyWhenStepsComplete,
              endCondition: rampState.endScheduleAt
                ? {
                    trigger: {
                      type: "scheduled",
                      at: rampState.endScheduleAt,
                    },
                    actions: endActions.length ? endActions : undefined,
                  }
                : endActions.length
                  ? { actions: endActions }
                  : undefined,
            };
          }
        }

        // Fix 5a: if disableRuleBefore is set with a non-immediate start,
        // include enabled:false directly in the rule payload so the revision
        // publishes with the rule disabled from the outset.
        if (
          rampScheduleInline &&
          "disableRuleBefore" in rampScheduleInline &&
          rampScheduleInline.disableRuleBefore &&
          "startCondition" in rampScheduleInline &&
          rampScheduleInline.startCondition?.trigger?.type !== "immediately"
        ) {
          values = { ...values, enabled: false };
        }

        res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${targetVersion}/rule`,
          {
            method: "POST",
            body: JSON.stringify({
              rule: values,
              environments:
                values.type === "safe-rollout"
                  ? [environment]
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
      throw e;
    }
  });

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
        ctaEnabled={!!overviewRuleType && selectedEnvironments.length > 0}
        header="New Rule"
        useRadixButton={true}
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
          <Text size="4" weight="bold" as="div" mb="4">
            Select Implementation
          </Text>
          <RadioCards
            mt="4"
            mb="2"
            width="100%"
            options={[
              {
                value: "force",
                label: "Rule",
                description:
                  "Assign a specific feature value to groups of users or control the rollout percentage",
              },
              {
                value: "safe-rollout",
                disabled: !hasSafeRolloutsFeature || datasources.length === 0,
                label: (
                  <PremiumTooltip
                    commercialFeature="safe-rollout"
                    usePortal={true}
                  >
                    Safe rollout
                  </PremiumTooltip>
                ),
                description: (
                  <>
                    <div>
                      Gradually release a value with automatic monitoring of
                      guardrail metrics
                    </div>
                    {datasources.length === 0 && (
                      <HelperText status="info" size="sm" mt="2">
                        Create a data source to use Safe Rollouts
                      </HelperText>
                    )}
                  </>
                ),
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
            setValue={(
              v: "force" | "rollout" | "safe-rollout" | "experiment" | "bandit",
            ) => {
              setOverviewRadioSelectorRuleType(v);
              if (v === "force") {
                setOverviewRuleType("force");
              } else if (v === "rollout") {
                setOverviewRuleType("rollout");
              } else if (v === "safe-rollout") {
                setOverviewRuleType("safe-rollout");
              } else {
                setOverviewRuleType("experiment-ref-new");
              }
            }}
          />
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

        {environments.length > 1 && overviewRuleType !== "safe-rollout" && (
          <EnvironmentSelect
            environments={environments}
            project={feature.project}
            environmentSettings={Object.fromEntries(
              environments.map((env) => [
                env.id,
                { enabled: selectedEnvironments.includes(env.id) },
              ]),
            )}
            setValue={(env, enabled) => {
              if (enabled) {
                setSelectedEnvironments((prev) => [
                  ...new Set([...prev, env.id]),
                ]);
              } else {
                setSelectedEnvironments((prev) =>
                  prev.filter((id) => id !== env.id),
                );
              }
            }}
            label="Create Rule in Environments"
          />
        )}
      </Modal>
    );
  }

  return (
    <FormProvider {...form}>
      <PagedModal
        trackingEventModalType={trackingEventModalType}
        close={close}
        size="lg"
        cta="Save to Draft"
        ctaEnabled={newRuleOverviewPage ? ruleType !== undefined : canSubmit}
        header={headerText}
        docSection={
          ruleType === "experiment-ref-new"
            ? "experimentConfiguration"
            : undefined
        }
        step={step}
        setStep={setStep}
        hideNav={ruleType !== "experiment-ref-new" && ruleType !== "experiment"}
        backButton={true}
        onBackFirstStep={
          mode === "create" ? () => setNewRuleOverviewPage(true) : undefined
        }
        submit={submit}
        useRadixButton={true}
        bodyPrefix={
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
        }
      >
        {(ruleType === "force" || ruleType === "rollout") && (
          <StandardRuleFields
            ruleType={ruleType}
            feature={feature}
            environments={selectedEnvironments}
            defaultValues={defaultValues}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
            isCyclic={isCyclic}
            cyclicFeatureId={cyclicFeatureId}
            conditionKey={conditionKey}
            scheduleToggleEnabled={scheduleToggleEnabled}
            setScheduleToggleEnabled={setScheduleToggleEnabled}
            featureRampSchedules={rampSchedules}
            ruleRampSchedule={ruleRampSchedule}
            rampSectionState={rampSectionState}
            setRampSectionState={setRampSectionState}
            scheduleType={scheduleType}
            setScheduleType={setScheduleType}
            pendingDetach={hasPendingDetach}
          />
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
          />
        ) : null}

        {(ruleType === "experiment-ref" || ruleType === "experiment") &&
        experimentType === "bandit" ? (
          <BanditRefFields
            feature={feature}
            existingRule={mode === "edit"}
            changeRuleType={changeRuleType}
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
                  environments={selectedEnvironments}
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
                  environments={selectedEnvironments}
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
                />
              </Page>
            ))
          : null}
      </PagedModal>
    </FormProvider>
  );
}
