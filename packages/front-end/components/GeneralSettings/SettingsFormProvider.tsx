import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/router";
import {
  FieldErrors,
  FormProvider,
  useForm,
  UseFormReturn,
} from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import get from "lodash/get";
import set from "lodash/set";
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
import {
  AI_PROMPT_DEFAULTS,
  AIPromptInterface,
  AIPromptType,
  CUSTOMIZABLE_PROMPT_TYPES,
  getProviderForAIModel,
} from "shared/ai";
import { getRequireRegisteredAttributesSettings } from "shared/util";
import { isCloud } from "@/services/env";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useCurrency } from "@/hooks/useCurrency";
import useApi from "@/hooks/useApi";
import { applyApprovalFlowEntitlements } from "@/hooks/useOrgSettings";
import {
  OrganizationSettingsWithMetricDefaults,
  METRIC_DEFAULTS,
} from "@/hooks/useOrganizationMetricDefaults";
import { isSettingsRoute } from "@/components/Layout/sidebarNav";
import {
  interceptRouteChanges,
  runConfirmedNavigation,
} from "@/components/FactTables/MetricEditor/navigationCancellation";
import ConfirmDialog from "@/ui/ConfirmDialog";
import {
  describeUnsavedChanges,
  sameSetting,
  sectionForField,
  SETTINGS_SECTIONS,
  settingPaths,
  toPercent,
} from "./settingsSections";

/** A saved model dropped from the registry reads as unset, so it falls back to the default. */
const knownTextModel = <T extends string>(model: T | undefined) =>
  model && getProviderForAIModel("text", model) ? model : undefined;

// Each customizable prompt's text and its model override.
export type PromptFormValues = Partial<
  Record<AIPromptType | `${AIPromptType}-model`, string>
>;

type OrgDetailsForm = {
  name: string;
  ownerEmail: string;
  installationName: string;
};

export type SettingsChange = {
  id: string;
  label: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  discard: () => void;
};

type SettingsFormContextValue = {
  form: UseFormReturn<OrganizationSettingsWithMetricDefaults>;
  promptForm: UseFormReturn<PromptFormValues>;
  orgForm: UseFormReturn<OrgDetailsForm>;
  dirtyCount: number;
  dirtySectionIds: string[];
  // Paths into the settings form, or "org.<field>" and "prompt.<field>".
  isFieldDirty: (path: string) => boolean;
  savedSettings: OrganizationSettings;
  // The product default at a settings path, as placeholder text.
  defaultFor: (path: string) => string;
  changes: SettingsChange[];
  savedCount: number;
  setSavedCount: (value: number) => void;
  submitError: string | null;
  setSubmitError: (value: string | null) => void;
  save: () => Promise<void>;
  discard: () => void;
};

const SettingsFormContext = createContext<SettingsFormContextValue | null>(
  null,
);

// For components also rendered outside Settings, where there is no provider.
export function useOptionalSettingsForm() {
  return useContext(SettingsFormContext);
}

export function useSettingsForm() {
  const ctx = useContext(SettingsFormContext);
  if (!ctx) {
    throw new Error("useSettingsForm must be used within SettingsFormProvider");
  }
  return ctx;
}

// Mounted on Settings routes only, so the draft survives moving between Settings pages and ends on leaving.
export function SettingsFormProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
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
  const [savedCount, setSavedCount] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [originalValue, setOriginalValue] = useState<OrganizationSettings>({});
  const originalRef = useRef<OrganizationSettings>({});
  const displayCurrency = useCurrency();

  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
  const hasRequireApprovals = hasCommercialFeature("require-approvals");

  const promptForm = useForm<PromptFormValues>();
  // Prompts live here too, so an AI section remount cannot reset a draft.
  const { data: promptData, mutate: mutatePrompts } = useApi<{
    prompts: AIPromptInterface[];
  }>("/ai/prompts");
  const savedPrompts = useMemo(() => {
    if (!promptData) return null;
    const values: PromptFormValues = {};
    CUSTOMIZABLE_PROMPT_TYPES.forEach((type) => {
      const p = promptData.prompts.find((x) => x.type === type);
      values[type] = p?.prompt || AI_PROMPT_DEFAULTS[type];
      values[`${type}-model`] = knownTextModel(p?.overrideModel) ?? "";
    });
    return values;
  }, [promptData]);
  useEffect(() => {
    // Saved values become the defaults; edited fields keep their draft.
    if (savedPrompts) promptForm.reset(savedPrompts, { keepDirtyValues: true });
  }, [savedPrompts, promptForm]);
  const orgDetails: OrgDetailsForm = {
    name: organization.name || "",
    ownerEmail: organization.ownerEmail || "",
    installationName: installationName || "",
  };
  // Seeded with the server values, or the first paint reads every field as edited.
  const orgForm = useForm<OrgDetailsForm>({ defaultValues: orgDetails });
  const orgKey = JSON.stringify(orgDetails);
  useEffect(() => {
    // Server values become the defaults; fields being edited keep their draft.
    orgForm.reset(JSON.parse(orgKey), { keepDirtyValues: true });
  }, [orgKey, orgForm]);

  // Product defaults only; the reload effect lays the saved values over them.
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
        priorSettings: METRIC_DEFAULTS.priorSettings,
        minimumSampleSize: METRIC_DEFAULTS.minimumSampleSize,
        maxPercentageChange: toPercent(METRIC_DEFAULTS.maxPercentageChange),
        minPercentageChange: toPercent(METRIC_DEFAULTS.minPercentageChange),
        targetMDE: toPercent(METRIC_DEFAULTS.targetMDE),
      },
      updateSchedule: {
        type: "stale",
        hours: 6,
        cron: "0 */6 * * *",
      },
      runHealthTrafficQuery: false,
      srmThreshold: DEFAULT_SRM_THRESHOLD,
      multipleExposureMinPercent: 1,
      confidenceLevel: 95,
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
      targetingReviewMode: [],
      restApiBypassesReviews: false,
      requireRebaseBeforePublish: false,
      revertsBypassApproval: false,
      configsExtensibleByDefault: true,
      configExperimentGuardDefault: false,
      blockPublishOnSchemaError: true,
      maxConcurrentDrafts: 0,
      defaultDataSource: "",
      testQueryDays: DEFAULT_TEST_QUERY_DAYS,
      disablePrecomputedDimensions: true,
      useStickyBucketing: false,
      stickyBucketingOnByDefault: false,
      useFallbackAttributes: false,
      codeReferencesEnabled: false,
      codeRefsBranchesToFilter: [],
      codeRefsPlatformUrl: "",
      featureKeyExample: "",
      featureRegexValidator: "",
      sparseJSONRulesByDefault: false,
      featureListMarkdown: "",
      featurePageMarkdown: "",
      experimentListMarkdown: "",
      experimentPageMarkdown: "",
      metricListMarkdown: "",
      metricPageMarkdown: "",
      banditScheduleValue: 1,
      banditScheduleUnit: "days",
      banditBurnInValue: 1,
      banditBurnInUnit: "days",
      requireExperimentTemplates: false,
      requireUniqueExperimentTrackingKeys: false,
      experimentKeyExample: "",
      experimentKeyRegexValidator: "",
      experimentMinLengthDays: DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS,
      experimentMaxLengthDays: DEFAULT_EXPERIMENT_MAX_LENGTH_DAYS,
      decisionFrameworkEnabled: DEFAULT_DECISION_FRAMEWORK_ENABLED,
      defaultDecisionCriteriaId: PRESET_DECISION_CRITERIA.id,
      blockFileUploads: false,
      requireProjectForFeatures: DEFAULT_REQUIRE_PROJECT_FOR_FEATURES,
      requireProjectForSdkConnections:
        DEFAULT_REQUIRE_PROJECT_FOR_SDK_CONNECTIONS,
      requireRegisteredAttributes:
        getRequireRegisteredAttributesSettings(undefined),
      aiEnabled: false,
      aiAskDataEnabled: false,
      aiAutocompleteEnabled: true,
      aiAutocompleteModel: undefined,
      disabledAgentSkills: [],
      // On Cloud a seeded model would be saved later and leave the managed default.
      defaultAIModel: isCloud() ? undefined : "gpt-4o-mini",
      embeddingModel: "text-embedding-ada-002",
      sttModel: undefined,
      visualEditorAIModel: undefined,
      visualEditorImageModel: "",
      visualEditorAIContext: "",
      disableLegacyMetricCreation: false,
      requireScopedFeatureRules: false,
      preferredEnvironment: "",
      maxMetricSliceLevels: DEFAULT_MAX_METRIC_SLICE_LEVELS,
      topValuesLookbackValue: DEFAULT_TOP_VALUES_LOOKBACK_VALUE,
      savedGroupSizeLimit: undefined,
      enforceSavedGroupProjectScope: false,
      postStratificationEnabled: DEFAULT_POST_STRATIFICATION_ENABLED,
      approvalFlows: applyApprovalFlowEntitlements(
        undefined,
        hasRequireApprovals,
      ),
      learningStatuses: DEFAULT_LEARNING_STATUSES,
    },
  });
  const initialValues = useRef(form.getValues());
  const { apiCall } = useAuth();
  const values = form.watch();
  // Compared against the loaded settings, since many setValue calls skip shouldDirty.
  const dirtyFields = settingPaths(originalValue)
    // A remounted empty number input reads NaN or "" where the saved value is undefined.
    .filter(
      (path) => !sameSetting(get(values, path), get(originalValue, path)),
    );
  const dirtyPromptFields = Object.keys(
    promptForm.formState.dirtyFields,
  ) as (keyof PromptFormValues)[];
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
  const isFieldDirty = (path: string) => {
    if (path.startsWith("org.")) {
      const k = path.slice(4) as keyof OrgDetailsForm;
      return (orgValues[k] ?? "") !== orgDetails[k];
    }
    if (path.startsWith("prompt.")) {
      return dirtyPromptFields.includes(
        path.slice(7) as keyof PromptFormValues,
      );
    }
    return !sameSetting(get(values, path), get(originalValue, path));
  };
  useEffect(() => {
    if (settings) {
      // Start from the defaults; the live form would make an unsaved edit look saved.
      const newVal = cloneDeep(initialValues.current);
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
                  maxPercentageChange: toPercent(existingMaxChange),
                }
              : {}),
            ...(existingMinChange !== undefined
              ? {
                  minPercentageChange: toPercent(existingMinChange),
                }
              : {}),
            ...(existingTargetMDE !== undefined
              ? {
                  targetMDE: toPercent(existingTargetMDE),
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
        } else if (k === "approvalFlows") {
          newVal.approvalFlows = applyApprovalFlowEntitlements(
            settings?.approvalFlows,
            hasRequireApprovals,
          );
        } else {
          // A saved false, 0 or empty string wins over the default.
          newVal[k] = settings?.[k] ?? newVal[k];
        }

        if (k === "confidenceLevel" && (newVal?.confidenceLevel ?? 0.95) <= 1) {
          newVal.confidenceLevel = toPercent(newVal.confidenceLevel ?? 0.95);
        }
        if (
          k === "multipleExposureMinPercent" &&
          (newVal?.multipleExposureMinPercent ?? 0.01) <= 1
        ) {
          newVal.multipleExposureMinPercent = toPercent(
            newVal.multipleExposureMinPercent ?? 0.01,
          );
        }

        if (k === "useStickyBucketing") {
          newVal.useStickyBucketing = hasStickyBucketFeature
            ? newVal.useStickyBucketing
            : false;
        }
      });
      // A refresh while editing keeps the draft; Discard still restores saved values.
      // Per child path, so an edited metric default doesn't keep stale siblings.
      const current = form.getValues();
      const prev = originalRef.current as Record<string, unknown>;
      const draft = cloneDeep(newVal) as Record<string, unknown>;
      settingPaths(prev).forEach((path) => {
        if (!sameSetting(get(current, path), get(prev, path)))
          set(draft, path, get(current, path));
      });
      form.reset(draft as OrganizationSettingsWithMetricDefaults);
      originalRef.current = newVal;
      setOriginalValue(newVal);
    }
  }, [settings, hasRequireApprovals, form, hasStickyBucketFeature]);

  const discardChanges = () => {
    form.reset(originalValue as OrganizationSettingsWithMetricDefaults);
    promptForm.reset();
    orgForm.reset(orgDetails);
    setSubmitError(null);
  };

  const changes: SettingsChange[] = dirtySectionIds.map((id) => {
    const keys = dirtyFields.filter((k) => sectionForField(k) === id);
    const before = Object.fromEntries(
      keys.map((k) => [k, get(originalValue, k)]),
    );
    const after = Object.fromEntries(keys.map((k) => [k, get(values, k)]));
    if (id === "organization") {
      dirtyOrgFields.forEach((k) => {
        before[k] = orgDetails[k];
        after[k] = orgValues[k];
      });
    }
    if (id === "ai") {
      dirtyPromptFields.forEach((k) => {
        before[k] = savedPrompts?.[k];
        after[k] = promptForm.getValues(k);
      });
    }
    return {
      id,
      label: SETTINGS_SECTIONS.find((s) => s.id === id)?.title ?? id,
      before,
      after,
      discard: () => {
        const next = cloneDeep(form.getValues());
        keys.forEach((k) => set(next, k, cloneDeep(get(originalValue, k))));
        form.reset(next);
        if (id === "organization") orgForm.reset(orgDetails);
        if (id === "ai") promptForm.reset();
      },
    };
  });

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

  // handleSubmit resolves without saving when a field is invalid, so callers pass onInvalid.
  const saveSettings = (onInvalid: (errors: FieldErrors) => void) =>
    form.handleSubmit(async (value) => {
      // A cleared number input reads NaN and saves as null, which means the
      // default; the form shows that default so it reads as saved.
      dirtyFields.forEach((path) => {
        if (!Number.isNaN(get(value, path))) return;
        form.setValue(
          path as Parameters<typeof form.setValue>[0],
          get(initialValues.current, path),
        );
      });
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
        !new RegExp(experimentKeyRegexValidator).test(
          experimentKeyExample ?? "",
        )
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
          if (!org.installationName.trim())
            throw new Error("Installation name cannot be empty");
          orgPatch.installationName = org.installationName.trim();
        }
        // The server stores trimmed values, so the form shows them too and reads as saved.
        (Object.keys(orgPatch) as (keyof OrgDetailsForm)[]).forEach((k) =>
          orgForm.setValue(k, orgPatch[k] ?? ""),
        );
      }

      // Only changed settings are sent, so limited roles aren't rejected for untouched fields.
      const changed = Object.fromEntries(
        // Split settings report child paths, e.g. "metricDefaults.targetMDE".
        Object.entries(transformedOrgSettings).filter(([k]) =>
          dirtyFields.some((path) => path === k || path.startsWith(`${k}.`)),
        ),
      );
      if (Object.keys(changed).length) {
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({ settings: changed }),
        });
      }
      if (Object.keys(orgPatch).length) {
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify(orgPatch),
        });
        // Update org name in global context (e.g. top nav)
        if (orgPatch.name && setOrgName) setOrgName(orgPatch.name);
        // Refreshes the license cached by installation name; needs billing access, so it may fail.
        if (orgPatch.installationName !== undefined) {
          await apiCall(`/license`).catch(() => undefined);
        }
      }
      await Promise.all([refreshOrganization(), mutateAgentSkills()]);
    }, onInvalid)();

  const save = async () => {
    const count = dirtyCount;
    setSubmitError(null);
    setSavedCount(0);
    let invalidSections: string[] | null = null;
    await saveSettings((errors) => {
      const paths = settingPaths(errors);
      invalidSections = [...new Set(paths.map(sectionForField))]
        .map((id) => SETTINGS_SECTIONS.find((s) => s.id === id)?.title)
        .filter((t): t is string => !!t);
    });
    if (invalidSections !== null) {
      const where = new Intl.ListFormat("en", { type: "conjunction" }).format(
        invalidSections as string[],
      );
      setSubmitError(
        where
          ? `Fix the invalid settings in ${where}, then save again.`
          : "Some settings aren't valid. Fix them, then save again.",
      );
      return;
    }
    // Only save prompts if the prompt form has changes
    if (dirtyPromptFields.length) {
      const sent = promptForm.getValues();
      await savePrompts();
      // What was sent is now saved; anything typed during the save stays unsaved.
      const now = promptForm.getValues();
      promptForm.reset(sent);
      (Object.keys(now) as (keyof PromptFormValues)[]).forEach((k) => {
        if (now[k] !== sent[k]) {
          promptForm.setValue(k, now[k], { shouldDirty: true });
        }
      });
      await mutatePrompts();
    }
    setSavedCount(count);
  };

  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => {
    if (!dirtyCount) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const stopIntercepting = interceptRouteChanges(router.events, (url) => {
      if (isSettingsRoute(new URL(url, window.location.origin).pathname))
        return false;
      setPendingHref(url);
      return true;
    });
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      stopIntercepting();
    };
  }, [dirtyCount, router.events]);

  return (
    <SettingsFormContext.Provider
      value={{
        form,
        promptForm,
        orgForm,
        dirtyCount,
        dirtySectionIds,
        isFieldDirty,
        savedSettings: originalValue,
        defaultFor: (path) => String(get(initialValues.current, path) ?? ""),
        changes,
        savedCount,
        setSavedCount,
        submitError,
        setSubmitError,
        save,
        discard: discardChanges,
      }}
    >
      <FormProvider {...form}>{children}</FormProvider>
      {pendingHref && (
        <ConfirmDialog
          title="Leave without saving?"
          content={`You have ${describeUnsavedChanges(dirtyCount, dirtySectionIds)}. Leaving Settings discards them.`}
          yesText="Discard and leave"
          noText="Keep editing"
          color="red"
          onConfirm={async () => {
            setPendingHref(null);
            await runConfirmedNavigation(() => router.push(pendingHref));
          }}
          onCancel={() => setPendingHref(null)}
        />
      )}
    </SettingsFormContext.Provider>
  );
}
