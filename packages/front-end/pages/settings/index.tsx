import cronstrue from "cronstrue";
import React, { useEffect, useState } from "react";
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
  DEFAULT_REVISION_CONFIGURATION,
} from "shared/constants";
import {
  DEFAULT_MAX_METRIC_SLICE_LEVELS,
  DEFAULT_TOP_VALUES_LOOKBACK_VALUE,
} from "shared/settings";
import { OrganizationSettings } from "shared/types/organization";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { PRESET_DECISION_CRITERIA } from "shared/enterprise";
import { CUSTOMIZABLE_PROMPT_TYPES } from "shared/ai";
import { getRequireRegisteredAttributesSettings } from "shared/util";
import Link from "@/ui/Link";
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
import OrganizationAndLicenseSettings from "@/components/GeneralSettings/OrganizationAndLicenseSettings";
import ImportSettings from "@/components/GeneralSettings/ImportSettings";
import NorthStarMetricSettings from "@/components/GeneralSettings/NorthStarMetricSettings";
import ExperimentSettings from "@/components/GeneralSettings/ExperimentSettings";
import MetricsSettings from "@/components/GeneralSettings/MetricsSettings";
import FeatureSettings from "@/components/GeneralSettings/FeatureSettings";
import RampScheduleTemplates from "@/components/GeneralSettings/RampScheduleTemplates";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import DatasourceSettings from "@/components/GeneralSettings/DatasourceSettings";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import AISettings from "@/components/GeneralSettings/AISettings";
import {
  SETTINGS_TAB,
  parseSettingsHash,
} from "@/components/GeneralSettings/settingsSections";
import HelperText from "@/ui/HelperText";
import { StickyTabsList, Tabs, TabsContent, TabsTrigger } from "@/ui/Tabs";
import Frame from "@/ui/Frame";
import SavedGroupSettings from "@/components/GeneralSettings/SavedGroupSettings";
import TargetingAttributesSettings from "@/components/GeneralSettings/TargetingAttributesSettings";
import ApprovalFlowSettings from "@/components/GeneralSettings/ApprovalFlowSettings";
import SDKConnectionSettings from "@/components/GeneralSettings/SDKConnectionSettings";

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

function applyApprovalFlowEntitlements(
  approvalFlows: OrganizationSettings["approvalFlows"],
  hasRequireApprovals: boolean,
): OrganizationSettings["approvalFlows"] {
  if (hasRequireApprovals || !approvalFlows) return approvalFlows;

  const savedGroupApprovalFlow =
    approvalFlows?.savedGroups?.[0] ??
    DEFAULT_REVISION_CONFIGURATION.savedGroups[0];

  return {
    ...approvalFlows,
    savedGroups: [
      {
        ...savedGroupApprovalFlow,
        required: false,
      },
      ...(approvalFlows.savedGroups?.slice(1) ?? []),
    ],
  };
}

const GeneralSettingsPage = (): React.ReactElement => {
  const { refreshOrganization, settings, organization, hasCommercialFeature } =
    useUser();
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

  const [urlHash, setUrlHash] = useURLHash();
  const { tab: activeTab, section: deepLinkSection } =
    parseSettingsHash(urlHash);
  const { metricDefaults } = useOrganizationMetricDefaults();
  const form = useForm<OrganizationSettingsWithMetricDefaults>({
    defaultValues: {
      visualEditorEnabled: false,
      pastExperimentsMinLength: 6,
      metricAnalysisDays: 90,
      // customization:
      customized: false,
      logoPath: "",
      primaryColor: "#391c6d",
      secondaryColor: "#50279a",
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
      restApiBypassesReviews: settings.restApiBypassesReviews ?? false,
      requireRebaseBeforePublish: settings.requireRebaseBeforePublish ?? false,
      revertsBypassApproval: settings.revertsBypassApproval ?? false,
      maxConcurrentDrafts: settings.maxConcurrentDrafts ?? 0,
      defaultDataSource: settings.defaultDataSource || "",
      testQueryDays: DEFAULT_TEST_QUERY_DAYS,
      disablePrecomputedDimensions:
        settings.disablePrecomputedDimensions ?? true,
      useStickyBucketing: false,
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
      defaultAIModel: settings.defaultAIModel || "gpt-4o-mini",
      embeddingModel: settings.embeddingModel || "text-embedding-ada-002",
      // `undefined` represents "use default" — the back-end's resolver
      // (getAISettingsForOrg) falls back to defaultAIModel for text and
      // the GEMINI_IMAGE_MODEL env var for image when these are unset.
      // We can't use empty string here because visualEditorAIModel is
      // typed as the AIModel union (which doesn't include "").
      visualEditorAIModel: settings.visualEditorAIModel,
      visualEditorImageModel: settings.visualEditorImageModel || "",
      visualEditorAIContext: settings.visualEditorAIContext || "",
      disableLegacyMetricCreation:
        settings.disableLegacyMetricCreation ?? false,
      defaultFeatureRulesInAllEnvs:
        settings.defaultFeatureRulesInAllEnvs ?? false,
      preferredEnvironment: settings.preferredEnvironment || "",
      maxMetricSliceLevels:
        settings.maxMetricSliceLevels ?? DEFAULT_MAX_METRIC_SLICE_LEVELS,
      topValuesLookbackValue:
        settings.topValuesLookbackValue ?? DEFAULT_TOP_VALUES_LOOKBACK_VALUE,
      savedGroupSizeLimit: undefined,
      postStratificationEnabled:
        settings.postStratificationEnabled ??
        DEFAULT_POST_STRATIFICATION_ENABLED,
      approvalFlows: applyApprovalFlowEntitlements(
        settings.approvalFlows,
        hasRequireApprovals,
      ),
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
    // customization:
    customized: form.watch("customized"),
    logoPath: form.watch("logoPath"),
    primaryColor: form.watch("primaryColor"),
    secondaryColor: form.watch("secondaryColor"),
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
    useFallbackAttributes: form.watch("useFallbackAttributes"),
    codeReferencesEnabled: form.watch("codeReferencesEnabled"),
    codeRefsBranchesToFilter: form.watch("codeRefsBranchesToFilter"),
    codeRefsPlatformUrl: form.watch("codeRefsPlatformUrl"),
    aiEnabled: form.watch("aiEnabled"),
    defaultAIModel: form.watch("defaultAIModel"),
    embeddingModel: form.watch("embeddingModel"),
    // Empty string from the form → undefined on the wire so we don't
    // pollute the saved settings doc with empty values. The back-end's
    // resolver treats both unset and empty-string as "no override".
    visualEditorAIModel: form.watch("visualEditorAIModel") || undefined,
    visualEditorImageModel: form.watch("visualEditorImageModel") || undefined,
    visualEditorAIContext: form.watch("visualEditorAIContext") || undefined,
    disableLegacyMetricCreation: form.watch("disableLegacyMetricCreation"),
    defaultFeatureRulesInAllEnvs: form.watch("defaultFeatureRulesInAllEnvs"),
    preferredEnvironment: form.watch("preferredEnvironment") || "",
    maxMetricSliceLevels: form.watch("maxMetricSliceLevels"),
    topValuesLookbackValue: form.watch("topValuesLookbackValue"),
    savedGroupSizeLimit: form.watch("savedGroupSizeLimit"),
    approvalFlows: form.watch("approvalFlows"),
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

  useEffect(() => {
    if (!deepLinkSection) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(deepLinkSection)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [deepLinkSection]);

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
      !transformedOrgSettings.featureKeyExample.match(/^[a-zA-Z0-9_.:|-]+$/)
    ) {
      throw new Error(
        "Feature key examples can only include letters, numbers, hyphens, and underscores.",
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

    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: transformedOrgSettings,
      }),
    });
    await refreshOrganization();

    // show the user that the settings have saved:
    setSaveMsg(true);
  });

  return (
    <FormProvider {...form}>
      <Box className="container-fluid pagecontents" mb="4">
        <Heading as="h1" size="5" mb="3">
          General Settings
        </Heading>
        <Box mb="5">
          <OrganizationAndLicenseSettings
            org={organization}
            refreshOrg={refreshOrganization}
          />
        </Box>

        <Tabs value={activeTab} onValueChange={setUrlHash}>
          <StickyTabsList>
            <TabsTrigger value={SETTINGS_TAB.experiment}>
              Experiments
            </TabsTrigger>
            <TabsTrigger value={SETTINGS_TAB.feature}>
              Feature Flags
            </TabsTrigger>
            <TabsTrigger value={SETTINGS_TAB.metrics}>
              Metrics &amp; Data
            </TabsTrigger>
            <TabsTrigger value={SETTINGS_TAB["approval-flow"]}>
              <PremiumTooltip commercialFeature="require-approvals">
                Approval Flows
              </PremiumTooltip>
            </TabsTrigger>
            <TabsTrigger value={SETTINGS_TAB.sdk}>
              SDK Configuration
            </TabsTrigger>
            <TabsTrigger value={SETTINGS_TAB.import}>
              Import &amp; Export
            </TabsTrigger>
            <TabsTrigger value={SETTINGS_TAB.custom}>
              <PremiumTooltip commercialFeature="custom-markdown">
                Custom Markdown
              </PremiumTooltip>
            </TabsTrigger>
            <TabsTrigger value={SETTINGS_TAB.ai}>
              <PremiumTooltip commercialFeature="ai-suggestions">
                AI &amp; Prompts
              </PremiumTooltip>
            </TabsTrigger>
          </StickyTabsList>
          <Box mt="4">
            <TabsContent value={SETTINGS_TAB.experiment}>
              <ExperimentSettings
                cronString={cronString}
                updateCronString={updateCronString}
              />
              <Frame mb="4">
                <BanditSettings page="org-settings" />
              </Frame>
            </TabsContent>

            <TabsContent value={SETTINGS_TAB.feature}>
              <FeatureSettings />
              <RampScheduleTemplates />
            </TabsContent>

            <TabsContent value={SETTINGS_TAB.metrics}>
              <>
                <MetricsSettings />
                <DatasourceSettings />
                <NorthStarMetricSettings />
              </>
            </TabsContent>

            <TabsContent value={SETTINGS_TAB.import}>
              <ImportSettings
                hasFileConfig={hasFileConfig()}
                isCloud={isCloud()}
                settings={settings}
                refreshOrg={refreshOrganization}
              />
            </TabsContent>

            <TabsContent value={SETTINGS_TAB.custom}>
              <Frame>
                <Flex>
                  <Box width="300px">
                    <PremiumTooltip commercialFeature="custom-markdown">
                      Custom Markdown
                    </PremiumTooltip>
                  </Box>
                  <Box>
                    {hasCommercialFeature("custom-markdown") ? (
                      <Link href="/settings/custom-markdown">
                        View Custom Markdown Settings
                      </Link>
                    ) : (
                      <span className="text-muted">
                        View Custom Markdown Settings
                      </span>
                    )}
                  </Box>
                </Flex>
              </Frame>
            </TabsContent>
            <TabsContent value={SETTINGS_TAB.ai}>
              <AISettings promptForm={promptForm} />
            </TabsContent>
            <TabsContent value={SETTINGS_TAB.sdk}>
              <>
                <SDKConnectionSettings />
                <SavedGroupSettings />
                <TargetingAttributesSettings />
              </>
            </TabsContent>
            <TabsContent value={SETTINGS_TAB["approval-flow"]}>
              <ApprovalFlowSettings />
            </TabsContent>
          </Box>
        </Tabs>
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
