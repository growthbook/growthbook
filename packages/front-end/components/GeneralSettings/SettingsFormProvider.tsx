import cronstrue from "cronstrue";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/router";
import { FormProvider, useForm, UseFormReturn } from "react-hook-form";
import isEqual from "lodash/isEqual";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
  DEFAULT_TEST_QUERY_DAYS,
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS,
  DEFAULT_EXPERIMENT_MAX_LENGTH_DAYS,
  DEFAULT_DECISION_FRAMEWORK_ENABLED,
  DEFAULT_REQUIRE_PROJECT_FOR_FEATURES,
  DEFAULT_REQUIRE_PROJECT_FOR_SDK_CONNECTIONS,
  DEFAULT_POST_STRATIFICATION_ENABLED,
  DEFAULT_LEARNING_STATUSES,
  FEATURE_KEY_PATTERN,
} from "shared/constants";
import {
  DEFAULT_MAX_METRIC_SLICE_LEVELS,
  DEFAULT_TOP_VALUES_LOOKBACK_VALUE,
} from "shared/settings";
import { OrganizationSettings } from "shared/types/organization";
import { PRESET_DECISION_CRITERIA } from "shared/enterprise";
import { CUSTOMIZABLE_PROMPT_TYPES, getProviderForAIModel } from "shared/ai";
import { getRequireRegisteredAttributesSettings } from "shared/util";
import { isCloud } from "@/services/env";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useCurrency } from "@/hooks/useCurrency";
import useApi from "@/hooks/useApi";
import { applyApprovalFlowEntitlements } from "@/hooks/useOrgSettings";
import {
  OrganizationSettingsWithMetricDefaults,
  useOrganizationMetricDefaults,
} from "@/hooks/useOrganizationMetricDefaults";
import { isSettingsRoute } from "@/components/Layout/sidebarNav";
import { sectionForField } from "./settingsSections";

const isAbsent = (v: unknown) =>
  v === undefined || v === null || v === "" || Number.isNaN(v);

/** A saved model dropped from the registry reads as unset, so it falls back to the default. */
const knownTextModel = <T extends string>(model: T | undefined) =>
  model && getProviderForAIModel("text", model) ? model : undefined;

export type OrgDetailsForm = {
  name: string;
  ownerEmail: string;
  installationName: string;
};

type SettingsFormContextValue = {
  form: UseFormReturn<OrganizationSettingsWithMetricDefaults>;
  promptForm: UseFormReturn;
  /** Organization name, owner, and installation name, saved with the settings. */
  orgForm: UseFormReturn<OrgDetailsForm>;
  cronString: string;
  updateCronString: (cron?: string) => void;
  codeRefsBranchesToFilterStr: string;
  setCodeRefsBranchesToFilterStr: (value: string) => void;
  dirtyCount: number;
  dirtySectionIds: string[];
  saveMsg: boolean;
  setSaveMsg: (value: boolean) => void;
  submitError: string | null;
  setSubmitError: (value: string | null) => void;
  save: () => Promise<void>;
  discard: () => void;
};

const SettingsFormContext = createContext<SettingsFormContextValue | null>(
  null,
);

export function useSettingsForm() {
  const ctx = useContext(SettingsFormContext);
  if (!ctx) {
    throw new Error("useSettingsForm must be used within SettingsFormProvider");
  }
  return ctx;
}

/**
 * Holds the General settings form above the pages, so an unsaved draft survives
 * moving between General and Organization pages and can be saved from either.
 * Leaving Settings altogether discards the draft.
 */
export function SettingsFormProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const active = isSettingsRoute(router.route);
  const {
    refreshOrganization,
    settings,
    hasCommercialFeature,
    organization,
    installationName,
    users,
  } = useUser();
  const { setOrgName } = useAuth();
  // Shares the composer's cache key, so revalidating here updates its `/` menu.
  const { mutate: mutateAgentSkills } = useApi("/agent/skills", {
    shouldRun: () => !!settings.aiEnabled,
  });
  const [saveMsg, setSaveMsg] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [originalValue, setOriginalValue] = useState<OrganizationSettings>({});
  const [cronString, setCronString] = useState("");
  const [codeRefsBranchesToFilterStr, setCodeRefsBranchesToFilterStr] =
    useState<string>("");
  const displayCurrency = useCurrency();

  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
  const hasRequireApprovals = hasCommercialFeature("require-approvals");

  const promptForm = useForm();
  const orgForm = useForm<OrgDetailsForm>({
    defaultValues: { name: "", ownerEmail: "", installationName: "" },
  });
  const orgDetails: OrgDetailsForm = {
    name: organization.name || "",
    ownerEmail: organization.ownerEmail || "",
    installationName: installationName || "",
  };
  const orgKey = JSON.stringify(orgDetails);
  useEffect(() => {
    orgForm.reset(JSON.parse(orgKey));
  }, [orgKey, orgForm]);

  const { metricDefaults } = useOrganizationMetricDefaults();
  const form = useForm<OrganizationSettingsWithMetricDefaults>({
    defaultValues: {
      visualEditorEnabled: false,
      pastExperimentsMinLength: 6,
      metricAnalysisDays: 90,
      northStar: {
        //enabled: false,
        title: "",
        metricIds: [],
        //target: [],
        //window: "",
        //resolution?: string;
        //startDate?: Date;
      },
      metricDefaults: {
        priorSettings: metricDefaults.priorSettings,
        minimumSampleSize: metricDefaults.minimumSampleSize,
        maxPercentageChange: metricDefaults.maxPercentageChange * 100,
        minPercentageChange: metricDefaults.minPercentageChange * 100,
        targetMDE: metricDefaults.targetMDE * 100,
      },
      updateSchedule: {
        type: "stale",
        hours: 6,
        cron: "0 */6 * * *",
      },
      runHealthTrafficQuery: false,
      srmThreshold: DEFAULT_SRM_THRESHOLD,
      multipleExposureMinPercent: 0.01,
      confidenceLevel: 0.95,
      pValueThreshold: DEFAULT_P_VALUE_THRESHOLD,
      pValueCorrection: null,
      statsEngine: DEFAULT_STATS_ENGINE,
      regressionAdjustmentEnabled: DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      regressionAdjustmentDays: DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      sequentialTestingEnabled: false,
      sequentialTestingTuningParameter:
        DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
      attributionModel: "firstExposure",
      displayCurrency,
      secureAttributeSalt: "",
      killswitchConfirmation: false,
      requireReviews: [
        {
          requireReviewOn: false,
          resetReviewOnChange: false,
          environments: [],
          projects: [],
          featureRequireEnvironmentReview: true,
          featureRequireMetadataReview: true,
        },
      ],
      targetingReviewMode: settings.targetingReviewMode ?? [],
      restApiBypassesReviews: settings.restApiBypassesReviews ?? false,
      requireRebaseBeforePublish: settings.requireRebaseBeforePublish ?? false,
      revertsBypassApproval: settings.revertsBypassApproval ?? false,
      configsExtensibleByDefault: settings.configsExtensibleByDefault ?? true,
      configExperimentGuardDefault:
        settings.configExperimentGuardDefault ?? false,
      blockPublishOnSchemaError: settings.blockPublishOnSchemaError ?? true,
      maxConcurrentDrafts: settings.maxConcurrentDrafts ?? 0,
      defaultDataSource: settings.defaultDataSource || "",
      testQueryDays: DEFAULT_TEST_QUERY_DAYS,
      disablePrecomputedDimensions:
        settings.disablePrecomputedDimensions ?? true,
      useStickyBucketing: false,
      stickyBucketingOnByDefault: false,
      useFallbackAttributes: false,
      codeReferencesEnabled: false,
      codeRefsBranchesToFilter: [],
      codeRefsPlatformUrl: "",
      featureKeyExample: "",
      featureRegexValidator: "",
      sparseJSONRulesByDefault: false,
      featureListMarkdown: settings.featureListMarkdown || "",
      featurePageMarkdown: settings.featurePageMarkdown || "",
      experimentListMarkdown: settings.experimentListMarkdown || "",
      metricListMarkdown: settings.metricListMarkdown || "",
      metricPageMarkdown: settings.metricPageMarkdown || "",
      banditScheduleValue: settings.banditScheduleValue ?? 1,
      banditScheduleUnit: settings.banditScheduleUnit ?? "days",
      banditBurnInValue: settings.banditBurnInValue ?? 1,
      banditBurnInUnit: settings.banditBurnInUnit ?? "days",
      requireExperimentTemplates: settings.requireExperimentTemplates ?? false,
      requireUniqueExperimentTrackingKeys:
        settings.requireUniqueExperimentTrackingKeys ?? false,
      experimentKeyExample: settings.experimentKeyExample ?? "",
      experimentKeyRegexValidator: settings.experimentKeyRegexValidator ?? "",
      experimentMinLengthDays:
        settings.experimentMinLengthDays ?? DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS,
      experimentMaxLengthDays:
        settings.experimentMaxLengthDays ?? DEFAULT_EXPERIMENT_MAX_LENGTH_DAYS,
      decisionFrameworkEnabled:
        settings.decisionFrameworkEnabled ?? DEFAULT_DECISION_FRAMEWORK_ENABLED,
      defaultDecisionCriteriaId:
        settings.defaultDecisionCriteriaId ?? PRESET_DECISION_CRITERIA.id,
      blockFileUploads: settings.blockFileUploads ?? false,
      requireProjectForFeatures:
        settings.requireProjectForFeatures ??
        DEFAULT_REQUIRE_PROJECT_FOR_FEATURES,
      requireProjectForSdkConnections:
        settings.requireProjectForSdkConnections ??
        DEFAULT_REQUIRE_PROJECT_FOR_SDK_CONNECTIONS,
      requireRegisteredAttributes: getRequireRegisteredAttributesSettings(
        settings.requireRegisteredAttributes,
      ),
      aiEnabled: settings.aiEnabled ?? false,
      aiAskDataEnabled: settings.aiAskDataEnabled ?? false,
      aiAutocompleteEnabled: settings.aiAutocompleteEnabled ?? true,
      aiAutocompleteModel: knownTextModel(settings.aiAutocompleteModel),
      disabledAgentSkills: settings.disabledAgentSkills ?? [],
      // Seeding a model on Cloud would persist it on the next save of any
      // setting, silently taking the org off the managed default.
      defaultAIModel:
        knownTextModel(settings.defaultAIModel) ||
        (isCloud() ? undefined : "gpt-4o-mini"),
      embeddingModel: settings.embeddingModel || "text-embedding-ada-002",
      sttModel: settings.sttModel,
      visualEditorAIModel: knownTextModel(settings.visualEditorAIModel),
      visualEditorImageModel: settings.visualEditorImageModel || "",
      visualEditorAIContext: settings.visualEditorAIContext || "",
      disableLegacyMetricCreation:
        settings.disableLegacyMetricCreation ?? false,
      requireScopedFeatureRules: settings.requireScopedFeatureRules ?? false,
      preferredEnvironment: settings.preferredEnvironment || "",
      maxMetricSliceLevels:
        settings.maxMetricSliceLevels ?? DEFAULT_MAX_METRIC_SLICE_LEVELS,
      topValuesLookbackValue:
        settings.topValuesLookbackValue ?? DEFAULT_TOP_VALUES_LOOKBACK_VALUE,
      savedGroupSizeLimit: undefined,
      enforceSavedGroupProjectScope:
        settings.enforceSavedGroupProjectScope ?? false,
      postStratificationEnabled:
        settings.postStratificationEnabled ??
        DEFAULT_POST_STRATIFICATION_ENABLED,
      approvalFlows: applyApprovalFlowEntitlements(
        settings.approvalFlows,
        hasRequireApprovals,
      ),
      learningStatuses: settings.learningStatuses ?? DEFAULT_LEARNING_STATUSES,
    },
  });
  const { apiCall } = useAuth();
  const values = form.watch();
  // Compared field by field against the loaded settings: `setValue` without
  // `shouldDirty` is common here, so react-hook-form's dirty state misses edits.
  const dirtyFields = Object.keys(originalValue).filter((k) => {
    const current = (values as Record<string, unknown>)[k];
    const original = (originalValue as Record<string, unknown>)[k];
    // A remounted empty number input reads NaN or "" where the saved value is undefined.
    if (isAbsent(current) && isAbsent(original)) return false;
    return !isEqual(current, original);
  });
  const dirtyPromptFields = Object.keys(promptForm.formState.dirtyFields);
  const orgValues = orgForm.watch();
  const dirtyOrgFields = (
    Object.keys(orgDetails) as (keyof OrgDetailsForm)[]
  ).filter((k) => (orgValues[k] ?? "") !== orgDetails[k]);
  const dirtyCount =
    dirtyFields.length + dirtyPromptFields.length + dirtyOrgFields.length;
  const dirtySectionIds = [
    ...new Set([
      ...(dirtyOrgFields.length ? ["organization"] : []),
      ...dirtyFields.map(sectionForField),
      ...(dirtyPromptFields.length ? ["ai"] : []),
    ]),
  ].filter((id): id is string => !!id);
  const updateCronString = useCallback(
    (cron?: string) => {
      cron = cron || form.getValues("updateSchedule")?.cron || "";

      if (!cron) {
        setCronString("");
      }
      setCronString(
        `${cronstrue.toString(cron, {
          throwExceptionOnParseError: false,
          verbose: true,
        })} (UTC time)`,
      );
    },
    [form],
  );

  useEffect(() => {
    if (settings) {
      const newVal = { ...form.getValues() };
      Object.keys(newVal).forEach((k) => {
        if (k === "metricDefaults") {
          // Metric defaults are nested, so take existing metric defaults only if
          // they exist and are not empty
          const existingMaxChange = settings?.[k]?.maxPercentageChange;
          const existingMinChange = settings?.[k]?.minPercentageChange;
          const existingTargetMDE = settings?.[k]?.targetMDE;
          newVal[k] = {
            ...newVal[k],
            ...settings?.[k],
            // Existing values are stored as a multiplier, e.g. 50% on the UI is stored as 0.5
            // Transform these values from the UI format
            ...(existingMaxChange !== undefined
              ? {
                  maxPercentageChange: existingMaxChange * 100,
                }
              : {}),
            ...(existingMinChange !== undefined
              ? {
                  minPercentageChange: existingMinChange * 100,
                }
              : {}),
            ...(existingTargetMDE !== undefined
              ? {
                  targetMDE: existingTargetMDE * 100,
                }
              : {}),
          };
        } else if (k === "requireRegisteredAttributes") {
          // Stored as either a legacy boolean or the canonical object shape;
          // normalize to the object so the form always works with one type.
          newVal.requireRegisteredAttributes =
            getRequireRegisteredAttributesSettings(
              settings?.requireRegisteredAttributes,
            );
        } else if (k === "enforceSavedGroupProjectScope") {
          newVal.enforceSavedGroupProjectScope =
            settings.enforceSavedGroupProjectScope ?? false;
        } else if (k === "approvalFlows") {
          newVal.approvalFlows = applyApprovalFlowEntitlements(
            settings?.approvalFlows,
            hasRequireApprovals,
          );
        } else {
          newVal[k] = settings?.[k] || newVal[k];
        }

        if (k === "confidenceLevel" && (newVal?.confidenceLevel ?? 0.95) <= 1) {
          newVal.confidenceLevel = (newVal.confidenceLevel ?? 0.95) * 100;
        }
        if (
          k === "multipleExposureMinPercent" &&
          (newVal?.multipleExposureMinPercent ?? 0.01) <= 1
        ) {
          newVal.multipleExposureMinPercent =
            (newVal.multipleExposureMinPercent ?? 0.01) * 100;
        }

        if (k === "useStickyBucketing") {
          newVal.useStickyBucketing = hasStickyBucketFeature
            ? newVal.useStickyBucketing
            : false;
        }
      });
      form.reset(newVal);
      setOriginalValue(newVal);
      updateCronString(newVal.updateSchedule?.cron || "");
      if (newVal.codeRefsBranchesToFilter) {
        setCodeRefsBranchesToFilterStr(
          newVal.codeRefsBranchesToFilter.join(", "),
        );
      }
    }
  }, [
    settings,
    hasRequireApprovals,
    form,
    hasStickyBucketFeature,
    updateCronString,
  ]);

  useEffect(() => {
    form.setValue(
      "codeRefsBranchesToFilter",
      codeRefsBranchesToFilterStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [codeRefsBranchesToFilterStr, form]);

  const discardChanges = () => {
    form.reset(originalValue as OrganizationSettingsWithMetricDefaults);
    promptForm.reset();
    orgForm.reset(orgDetails);
    updateCronString(originalValue.updateSchedule?.cron || "");
    setCodeRefsBranchesToFilterStr(
      (originalValue.codeRefsBranchesToFilter ?? []).join(", "),
    );
    setSubmitError(null);
  };

  const savePrompts = promptForm.handleSubmit(async (promptValues) => {
    const formattedPrompts = CUSTOMIZABLE_PROMPT_TYPES.map((type) => ({
      type,
      prompt: promptValues[type],
      overrideModel: promptValues[`${type}-model`] || undefined,
    }));
    await apiCall(`/ai/prompts`, {
      method: "POST",
      body: JSON.stringify({ prompts: formattedPrompts }),
    });
  });

  const saveSettings = form.handleSubmit(async (value) => {
    const transformedOrgSettings = {
      ...value,
      metricDefaults: {
        ...value.metricDefaults,
        maxPercentageChange: value.metricDefaults.maxPercentageChange / 100,
        minPercentageChange: value.metricDefaults.minPercentageChange / 100,
        targetMDE: value.metricDefaults.targetMDE / 100,
      },
      confidenceLevel: (value.confidenceLevel ?? 0.95) / 100,
      multipleExposureMinPercent:
        (value.multipleExposureMinPercent ?? 0.01) / 100,
      preferredEnvironment: value.preferredEnvironment || null,
      // A cleared number input yields NaN — normalize to 0 (cap disabled)
      maxConcurrentDrafts: value.maxConcurrentDrafts || 0,
      approvalFlows: applyApprovalFlowEntitlements(
        value.approvalFlows,
        hasRequireApprovals,
      ),
    };

    // Make sure the feature key example is valid
    if (
      transformedOrgSettings.featureKeyExample &&
      !new RegExp(FEATURE_KEY_PATTERN).test(
        transformedOrgSettings.featureKeyExample,
      )
    ) {
      throw new Error(
        "Feature key examples can only include letters, numbers, and the characters _, -, ., :, and |.",
      );
    }

    // If the regex validator exists, then the feature key example must match the regex and be valid.
    if (transformedOrgSettings.featureRegexValidator) {
      if (
        !transformedOrgSettings.featureKeyExample ||
        !transformedOrgSettings.featureRegexValidator
      ) {
        throw new Error(
          "Feature key example must not be empty when a regex validator is defined.",
        );
      }

      const regexValidator = transformedOrgSettings.featureRegexValidator;
      if (
        !new RegExp(regexValidator).test(
          transformedOrgSettings.featureKeyExample,
        )
      ) {
        throw new Error(
          `Feature key example does not match the regex validator. '${transformedOrgSettings.featureRegexValidator}' Example: '${transformedOrgSettings.featureKeyExample}'`,
        );
      }
    }

    const { experimentKeyExample, experimentKeyRegexValidator } =
      transformedOrgSettings;
    if (experimentKeyRegexValidator && !experimentKeyExample) {
      throw new Error(
        "Experiment key example must not be empty when a regex validator is defined.",
      );
    }
    if (
      experimentKeyRegexValidator &&
      !new RegExp(experimentKeyRegexValidator).test(experimentKeyExample ?? "")
    ) {
      throw new Error(
        `Experiment key example must match the regex validator. '${experimentKeyRegexValidator}' Example: '${experimentKeyExample ?? ""}'`,
      );
    }

    // Organization details ride along only when edited, since they need their own permission.
    const org = orgForm.getValues();
    const orgPatch: Partial<OrgDetailsForm> = {};
    if (dirtyOrgFields.length) {
      if (!org.name.trim())
        throw new Error("Organization name cannot be empty");
      if (!org.ownerEmail.trim())
        throw new Error("Owner email cannot be empty");
      const emails = Array.from(users).map(([, u]) => u.email);
      if (!emails.includes(org.ownerEmail.trim())) {
        throw new Error(
          "This email is not associated with any user in your organization",
        );
      }
      orgPatch.name = org.name.trim();
      orgPatch.ownerEmail = org.ownerEmail.trim();
      if (dirtyOrgFields.includes("installationName")) {
        orgPatch.installationName = org.installationName.trim();
      }
    }

    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        ...orgPatch,
        settings: transformedOrgSettings,
      }),
    });
    // Update org name in global context (e.g. top nav)
    if (orgPatch.name && setOrgName) setOrgName(orgPatch.name);
    await Promise.all([refreshOrganization(), mutateAgentSkills()]);

    // show the user that the settings have saved:
    setSaveMsg(true);
  });

  const save = async () => {
    setSubmitError(null);
    await saveSettings();
    // Only save prompts if the prompt form has changes
    if (dirtyPromptFields.length) {
      await savePrompts();
      promptForm.reset(promptForm.getValues());
    }
  };

  // The draft lives only while inside Settings.
  useEffect(() => {
    if (!active && dirtyCount > 0) discardChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <SettingsFormContext.Provider
      value={{
        form,
        promptForm,
        orgForm,
        cronString,
        updateCronString,
        codeRefsBranchesToFilterStr,
        setCodeRefsBranchesToFilterStr,
        dirtyCount,
        dirtySectionIds,
        saveMsg,
        setSaveMsg,
        submitError,
        setSubmitError,
        save,
        discard: discardChanges,
      }}
    >
      <FormProvider {...form}>{children}</FormProvider>
    </SettingsFormContext.Provider>
  );
}
