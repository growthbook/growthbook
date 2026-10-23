import cronstrue from "cronstrue";
import React, { useEffect, useRef, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
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
import { Box, Flex } from "@radix-ui/themes";
import { PRESET_DECISION_CRITERIA } from "shared/enterprise";
import { CUSTOMIZABLE_PROMPT_TYPES, getProviderForAIModel } from "shared/ai";
import { getRequireRegisteredAttributesSettings } from "shared/util";
import { useAuth } from "@/services/auth";
import { hasFileConfig, isCloud } from "@/services/env";
import TempMessage from "@/components/TempMessage";
import Button from "@/ui/Button";
import {
  OrganizationSettingsWithMetricDefaults,
  useOrganizationMetricDefaults,
} from "@/hooks/useOrganizationMetricDefaults";
import { useUser } from "@/services/UserContext";
import { useCurrency } from "@/hooks/useCurrency";
import useURLHash from "@/hooks/useURLHash";
import { applyApprovalFlowEntitlements } from "@/hooks/useOrgSettings";
import OrganizationAndLicenseSettings from "@/components/GeneralSettings/OrganizationAndLicenseSettings";
import ImportSettings from "@/components/GeneralSettings/ImportSettings";
import NorthStarMetricSettings from "@/components/GeneralSettings/NorthStarMetricSettings";
import ExperimentSettings, {
  ExperimentAnalysisSettings,
} from "@/components/GeneralSettings/ExperimentSettings";
import MetricsSettings from "@/components/GeneralSettings/MetricsSettings";
import FeatureSettings from "@/components/GeneralSettings/FeatureSettings";
import RampScheduleTemplates from "@/components/GeneralSettings/RampScheduleTemplates";
import DatasourceSettings from "@/components/GeneralSettings/DatasourceSettings";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import LearningSettings from "@/components/GeneralSettings/LearningSettings";
import AISettings from "@/components/GeneralSettings/AISettings";
import {
  resolveSettingsHash,
  SETTINGS_SECTIONS,
  tokenizeSettingsQuery,
} from "@/components/GeneralSettings/settingsSections";
import SettingsSection, {
  SettingsCard,
} from "@/components/GeneralSettings/SettingsSection";
import CustomMarkdownSettings from "@/components/GeneralSettings/CustomMarkdownSettings";
import { useSettingsNav } from "@/components/Layout/SettingsNavContext";
import PageHead from "@/components/Layout/PageHead";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import sectionStyles from "@/components/GeneralSettings/SettingsSection.module.scss";
import useApi from "@/hooks/useApi";
import SavedGroupSettings from "@/components/GeneralSettings/SavedGroupSettings";
import TargetingAttributesSettings from "@/components/GeneralSettings/TargetingAttributesSettings";
import ApprovalFlowSettings from "@/components/GeneralSettings/ApprovalFlowSettings";
import SDKConnectionSettings from "@/components/GeneralSettings/SDKConnectionSettings";

/** A saved model dropped from the registry reads as unset, so it falls back to the default. */
const knownTextModel = <T extends string>(model: T | undefined) =>
  model && getProviderForAIModel("text", model) ? model : undefined;

export const ConnectSettingsForm = ({ children }) => {
  const methods = useFormContext();
  return children({ ...methods });
};

function hasChanges(
  value: OrganizationSettings,
  existing: OrganizationSettings,
) {
  if (!existing) return true;

  return !isEqual(value, existing);
}

const GeneralSettingsPage = (): React.ReactElement => {
  const { refreshOrganization, settings, organization, hasCommercialFeature } =
    useUser();
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

  const [urlHash] = useURLHash();
  const { query, setQuery, activeSection, setActiveSection, counts } =
    useSettingsNav();
  const pageRef = useRef<HTMLDivElement>(null);
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
  const value: OrganizationSettingsWithMetricDefaults = {
    visualEditorEnabled: form.watch("visualEditorEnabled"),
    pastExperimentsMinLength: form.watch("pastExperimentsMinLength"),
    metricAnalysisDays: form.watch("metricAnalysisDays"),
    metricDefaults: {
      priorSettings: form.watch("metricDefaults.priorSettings"),
      minimumSampleSize: form.watch("metricDefaults.minimumSampleSize"),
      maxPercentageChange: form.watch("metricDefaults.maxPercentageChange"),
      minPercentageChange: form.watch("metricDefaults.minPercentageChange"),
      targetMDE: form.watch("metricDefaults.targetMDE"),
    },
    northStar: form.watch("northStar"),
    updateSchedule: form.watch("updateSchedule"),
    runHealthTrafficQuery: form.watch("runHealthTrafficQuery"),
    srmThreshold: form.watch("srmThreshold"),
    multipleExposureMinPercent: form.watch("multipleExposureMinPercent"),
    statsEngine: form.watch("statsEngine"),
    confidenceLevel: form.watch("confidenceLevel"),
    pValueThreshold: form.watch("pValueThreshold"),
    pValueCorrection: form.watch("pValueCorrection"),
    regressionAdjustmentEnabled: form.watch("regressionAdjustmentEnabled"),
    regressionAdjustmentDays: form.watch("regressionAdjustmentDays"),
    sequentialTestingEnabled: form.watch("sequentialTestingEnabled"),
    sequentialTestingTuningParameter: form.watch(
      "sequentialTestingTuningParameter",
    ),
    attributionModel: form.watch("attributionModel"),
    displayCurrency: form.watch("displayCurrency"),
    secureAttributeSalt: form.watch("secureAttributeSalt"),
    killswitchConfirmation: form.watch("killswitchConfirmation"),
    sparseJSONRulesByDefault: form.watch("sparseJSONRulesByDefault"),
    defaultDataSource: form.watch("defaultDataSource"),
    useStickyBucketing: form.watch("useStickyBucketing"),
    stickyBucketingOnByDefault: form.watch("stickyBucketingOnByDefault"),
    useFallbackAttributes: form.watch("useFallbackAttributes"),
    codeReferencesEnabled: form.watch("codeReferencesEnabled"),
    codeRefsBranchesToFilter: form.watch("codeRefsBranchesToFilter"),
    codeRefsPlatformUrl: form.watch("codeRefsPlatformUrl"),
    aiEnabled: form.watch("aiEnabled"),
    aiAskDataEnabled: form.watch("aiAskDataEnabled"),
    aiAutocompleteEnabled: form.watch("aiAutocompleteEnabled"),
    aiAutocompleteModel: form.watch("aiAutocompleteModel") || undefined,
    disabledAgentSkills: form.watch("disabledAgentSkills"),
    defaultAIModel: form.watch("defaultAIModel"),
    embeddingModel: form.watch("embeddingModel"),
    sttModel: form.watch("sttModel") || undefined,
    visualEditorAIModel: form.watch("visualEditorAIModel"),
    visualEditorImageModel: form.watch("visualEditorImageModel"),
    visualEditorAIContext: form.watch("visualEditorAIContext") || undefined,
    disableLegacyMetricCreation: form.watch("disableLegacyMetricCreation"),
    requireScopedFeatureRules: form.watch("requireScopedFeatureRules"),
    preferredEnvironment: form.watch("preferredEnvironment") || "",
    maxMetricSliceLevels: form.watch("maxMetricSliceLevels"),
    topValuesLookbackValue: form.watch("topValuesLookbackValue"),
    savedGroupSizeLimit: form.watch("savedGroupSizeLimit"),
    enforceSavedGroupProjectScope: form.watch("enforceSavedGroupProjectScope"),
    approvalFlows: form.watch("approvalFlows"),
    learningStatuses: form.watch("learningStatuses"),
    requireRegisteredAttributes: form.watch("requireRegisteredAttributes"),
  };
  function updateCronString(cron?: string) {
    cron = cron || value.updateSchedule?.cron || "";

    if (!cron) {
      setCronString("");
    }
    setCronString(
      `${cronstrue.toString(cron, {
        throwExceptionOnParseError: false,
        verbose: true,
      })} (UTC time)`,
    );
  }

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
  }, [settings, hasRequireApprovals]);

  useEffect(() => {
    form.setValue(
      "codeRefsBranchesToFilter",
      codeRefsBranchesToFilterStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [codeRefsBranchesToFilterStr]);

  // `#section` or a legacy `#tab/element` hash scrolls to that element. Cards
  // above it keep loading for a moment, so the scroll is re-applied as the page
  // grows until the user takes over or 2s pass.
  useEffect(() => {
    const id = resolveSettingsHash(urlHash);
    const root = pageRef.current;
    if (!id || !root) return;
    const scrollTo = (behavior: ScrollBehavior) =>
      document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
    const frame = window.requestAnimationFrame(() => scrollTo("smooth"));
    const observer = new ResizeObserver(() => scrollTo("auto"));
    observer.observe(root);
    const stop = () => observer.disconnect();
    const timer = window.setTimeout(stop, 2000);
    const userEvents = ["wheel", "touchmove", "keydown"] as const;
    userEvents.forEach((e) => window.addEventListener(e, stop, { once: true }));
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      stop();
      userEvents.forEach((e) => window.removeEventListener(e, stop));
    };
  }, [urlHash]);

  // Scroll spy: the last visible section whose top has passed the sticky header is active.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      let active = "";
      for (const { id } of SETTINGS_SECTIONS) {
        const el = document.getElementById(id);
        if (!el || el.hidden) continue;
        // A short last section never reaches the top, so the page bottom selects it.
        if (!active || atBottom || el.getBoundingClientRect().top <= 180)
          active = id;
      }
      if (active) setActiveSection(active);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [query, counts, setActiveSection]);

  // Highlights query tokens inside cards. Progressive: browsers without the Highlight API skip it.
  useEffect(() => {
    if (!("highlights" in CSS)) return;
    const tokens = tokenizeSettingsQuery(query);
    const ranges: Range[] = [];
    pageRef.current
      ?.querySelectorAll("[data-settings-card]")
      .forEach((card) => {
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.toLowerCase() ?? "";
          for (const token of tokens) {
            for (
              let i = text.indexOf(token);
              i !== -1;
              i = text.indexOf(token, i + token.length)
            ) {
              const range = new Range();
              range.setStart(node, i);
              range.setEnd(node, i + token.length);
              ranges.push(range);
            }
          }
        }
      });
    CSS.highlights.set("settings-search", new Highlight(...ranges));
    return () => {
      CSS.highlights.delete("settings-search");
    };
  }, [query, counts]);

  // I Don't think this works as intended - the hasChanges(value, originalValue) always seems to return true.
  const ctaEnabled =
    hasChanges(value, originalValue) || promptForm.formState.isDirty;

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

    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: transformedOrgSettings,
      }),
    });
    await Promise.all([refreshOrganization(), mutateAgentSkills()]);

    // show the user that the settings have saved:
    setSaveMsg(true);
  });

  const tokens = tokenizeSettingsQuery(query);
  const hasQuery = tokens.length > 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const matchedSections = Object.values(counts).filter((n) => n > 0).length;
  const activeTitle = SETTINGS_SECTIONS.find(
    (s) => s.id === activeSection,
  )?.title;

  return (
    <FormProvider {...form}>
      <PageHead
        breadcrumb={[
          { display: "Settings" },
          { display: "General", href: "/settings" },
          ...(activeTitle ? [{ display: activeTitle }] : []),
        ]}
      />
      <Box className="container-fluid pagecontents" mb="4" ref={pageRef}>
        <h1 className={sectionStyles.pageTitle}>General settings</h1>
        <p className={sectionStyles.pageSubtitle}>
          Organization-wide defaults. Projects can override some of these.
        </p>

        {hasQuery && (
          <Flex align="center" gap="3" mt="3" wrap="wrap">
            <Box flexGrow="1" aria-live="polite">
              <Text size="sm" color="text-mid">
                {total === 0
                  ? `No settings match "${query.trim()}".`
                  : `${total} match${total === 1 ? "" : "es"} for "${query.trim()}" in ${matchedSections} section${matchedSections === 1 ? "" : "s"}.`}
              </Text>
            </Box>
            <Button variant="ghost" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </Flex>
        )}
        {hasQuery && total === 0 && (
          <Box className={sectionStyles.noResults} role="status">
            <Text as="p" size="lg" weight="semibold" mb="1">
              No settings match &quot;{query.trim()}&quot;
            </Text>
            <Text as="p" color="text-mid" mb="3">
              Search matches setting names, descriptions, and keywords. Try a
              broader term, like &quot;refresh&quot; or &quot;variance&quot;.
            </Text>
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </Box>
        )}

        <SettingsSection id="organization">
          <SettingsCard
            id="organization"
            keywords="company name admin owner email license plan seats"
          >
            <OrganizationAndLicenseSettings
              org={organization}
              refreshOrg={refreshOrganization}
            />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="experiments">
          <SettingsCard
            id="experiment-settings"
            keywords="launch checklist template tracking key regex naming refresh schedule cron sticky bucketing srm health exposure decision framework"
          >
            <ExperimentSettings
              cronString={cronString}
              updateCronString={updateCronString}
            />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="statistics">
          <SettingsCard
            id="experiment-analysis"
            keywords="stats engine bayesian frequentist p-value significance cuped variance reduction sequential testing prior"
          >
            <ExperimentAnalysisSettings />
          </SettingsCard>
          <SettingsCard
            id="bandits"
            keywords="multi-armed bandit cadence burn-in"
          >
            <Frame mb="4">
              <BanditSettings page="org-settings" />
            </Frame>
          </SettingsCard>
          <SettingsCard id="learnings" keywords="learning statuses badges">
            <Frame mb="4">
              <LearningSettings />
            </Frame>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="metrics">
          <SettingsCard
            id="metric-settings"
            keywords="lookback history threshold sample size outlier mde currency revenue fact tables slices"
          >
            <MetricsSettings />
          </SettingsCard>
          <SettingsCard
            id="datasource-settings"
            keywords="warehouse default data source test query top values"
          >
            <DatasourceSettings />
          </SettingsCard>
          <SettingsCard
            id="north-star"
            keywords="home page kpi goals north star"
          >
            <NorthStarMetricSettings />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="features">
          <SettingsCard
            id="feature-settings"
            keywords="feature key naming regex project environment json configs schema drafts code references github gitlab"
          >
            <FeatureSettings />
          </SettingsCard>
          <SettingsCard
            id="ramp-schedules"
            keywords="rollout schedule gradual ramp templates"
          >
            <RampScheduleTemplates />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="approvals">
          <SettingsCard
            id="approval-flows"
            keywords="review publish approval rest api bypass rebase reverts targeting"
          >
            <ApprovalFlowSettings />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="sdk">
          <SettingsCard
            id="sdk-connections"
            keywords="sdk connection project scoping"
          >
            <SDKConnectionSettings />
          </SettingsCard>
          <SettingsCard
            id="saved-groups"
            keywords="saved group project scope payload size limit"
          >
            <SavedGroupSettings />
          </SettingsCard>
          <SettingsCard
            id="targeting-attributes"
            keywords="targeting attribute schema registered"
          >
            <TargetingAttributesSettings />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="ai">
          <SettingsCard
            id="ai-settings"
            keywords="ai llm openai anthropic prompts assistant skills embeddings provider api key"
          >
            <AISettings promptForm={promptForm} />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="import">
          <SettingsCard
            id="import-export"
            keywords="yaml config export import backup migrate launchdarkly optimizely"
          >
            <ImportSettings
              hasFileConfig={hasFileConfig()}
              isCloud={isCloud()}
              settings={settings}
              refreshOrg={refreshOrganization}
            />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="markdown">
          <SettingsCard
            id="custom-markdown"
            keywords="guidance documentation help markdown"
          >
            <CustomMarkdownSettings />
          </SettingsCard>
        </SettingsSection>

        <div className={sectionStyles.spacer} />
      </Box>

      <Box
        className="bg-main-color position-sticky w-100 py-3 border-top"
        style={{ bottom: 0, height: 70, zIndex: 840 }}
      >
        <Box className="container-fluid pagecontents d-flex">
          <Flex flexGrow="1" gap="3" align="end">
            {submitError && (
              <Box>
                <HelperText status="error">{submitError}</HelperText>
              </Box>
            )}
            {saveMsg && (
              <TempMessage
                className="mb-0 py-2"
                close={() => {
                  setSaveMsg(false);
                }}
              >
                Settings saved
              </TempMessage>
            )}
          </Flex>
          <Box style={{ marginRight: "85px" }}>
            <Button
              disabled={!ctaEnabled}
              onClick={async () => {
                setSubmitError(null);
                if (!ctaEnabled) return;
                await saveSettings();
                // Only save prompts if the prompt form has changes
                if (promptForm.formState.isDirty) {
                  await savePrompts();
                }
              }}
              setError={setSubmitError}
            >
              Save all
            </Button>
          </Box>
        </Box>
      </Box>
    </FormProvider>
  );
};

export default GeneralSettingsPage;
