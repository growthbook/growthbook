import { FormProvider, useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
  ScheduleRule,
} from "shared/types/feature";
import React, { useMemo, useState } from "react";
import uniqId from "uniqid";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  filterEnvironmentsByFeature,
  generateVariationId,
  isProjectListValidForProject,
} from "shared/util";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { PiCaretRight } from "react-icons/pi";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { getScopedSettings } from "shared/settings";
import { kebabCase } from "lodash";
import { Text } from "@radix-ui/themes";
import {
  CreateSafeRolloutInterface,
  SafeRolloutInterface,
  SafeRolloutRule,
} from "shared/validators";
import {
  PostFeatureRuleBody,
  PutFeatureRuleBody,
} from "shared/types/feature-rule";
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
import { AppFeatures } from "@/types/app-features";
import { useUser } from "@/services/UserContext";
import RadioCards from "@/ui/RadioCards";
import RadioGroup from "@/ui/RadioGroup";
import PagedModal from "@/components/Modal/PagedModal";
import ForceValueFields from "@/components/Features/RuleModal/ForceValueFields";
import RolloutFields from "@/components/Features/RuleModal/RolloutFields";
import ExperimentRefFields from "@/components/Features/RuleModal/ExperimentRefFields";
import ExperimentRefNewFields from "@/components/Features/RuleModal/ExperimentRefNewFields";
import Page from "@/components/Modal/Page";
import BanditRefFields from "@/components/Features/RuleModal/BanditRefFields";
import BanditRefNewFields from "@/components/Features/RuleModal/BanditRefNewFields";
import { useIncrementer } from "@/hooks/useIncrementer";
import HelperText from "@/ui/HelperText";
import { useTemplates } from "@/hooks/useTemplates";
import { useBatchPrerequisiteStates } from "@/hooks/usePrerequisiteStates";
import SafeRolloutFields from "@/components/Features/RuleModal/SafeRolloutFields";
import EnvironmentSelect from "@/components/Features/FeatureModal/EnvironmentSelect";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  version: number;
  setVersion: (version: number) => void;
  mutate: () => void;
  i: number;
  environment: string;
  defaultType?: string;
  mode: "create" | "edit" | "duplicate";
  safeRolloutsMap?: Map<string, SafeRolloutInterface>;
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
  version,
  setVersion,
  mode,
  safeRolloutsMap,
}: Props) {
  const growthbook = useGrowthBook<AppFeatures>();
  const { hasCommercialFeature, organization } = useUser();
  const { apiCall } = useAuth();

  const attributeSchema = useAttributeSchema(false, feature.project);

  const rules = getRules(feature, environment);
  const rule: (typeof rules)[number] | undefined = rules[i];
  const safeRollout =
    rule?.type === "safe-rollout"
      ? safeRolloutsMap?.get(rule?.safeRolloutId)
      : undefined;
  const { datasources, project: currentProject } = useDefinitions();
  const { experimentsMap, mutateExperiments } = useExperiments();
  const { templates: allTemplates } = useTemplates();
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);

  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] =
    useState(false);

  const settings = useOrgSettings();
  const { settings: scopedSettings } = getScopedSettings({ organization });

  const isSafeRolloutRampUpEnabled = growthbook.isOn("safe-rollout-ramp-up");
  const isSafeRolloutAutoRollbackEnabled = growthbook.isOn(
    "safe-rollout-auto-rollback",
  );

  const defaultRuleValues = getDefaultRuleValue({
    defaultValue: getFeatureDefaultValue(feature),
    ruleType: defaultType,
    attributeSchema,
    isSafeRolloutAutoRollbackEnabled,
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

  const orgStickyBucketing = !!settings.useStickyBucketing;
  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
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

  function changeRuleType(v: string) {
    const existingCondition = form.watch("condition");
    const existingSavedGroups = form.watch("savedGroups");
    const newVal = {
      ...getDefaultRuleValue({
        defaultValue: getFeatureDefaultValue(feature),
        ruleType: v,
        attributeSchema,
        settings,
        datasources,
        isSafeRolloutAutoRollbackEnabled,
      }),
      description: form.watch("description"),
    };
    if (existingCondition && existingCondition !== "{}") {
      newVal.condition = existingCondition;
    }
    if (existingSavedGroups) {
      newVal.savedGroups = existingSavedGroups;
    }
    form.reset(newVal);
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
              variations: values.values.map((v, i) => ({
                id: uniqId("var_"),
                key: i + "",
                name: v.name || (i ? `Variation ${i}` : "Control"),
                screenshots: [],
                status: "active" as const,
              })),
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
        const createdVariations = getLatestPhaseVariations(res.experiment);
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
            variationId: createdVariations[i]?.id || "",
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

        const expVariations = getLatestPhaseVariations(exp);
        values.variations = expVariations.map((v, i) => {
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
        // sanity check that the auto rollback and ramp up schedule are enabled
        safeRolloutFields.autoRollback = isSafeRolloutAutoRollbackEnabled
          ? safeRolloutFields.autoRollback
          : false;
        const rampUpSchedule = safeRolloutFields["rampUpSchedule"] || {};
        // backend deals with the rest
        safeRolloutFields["rampUpSchedule"] = {};
        safeRolloutFields["rampUpSchedule"]["enabled"] =
          rampUpSchedule["enabled"] ?? isSafeRolloutRampUpEnabled;

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
          res = await apiCall<{ version: number }>(
            `/feature/${feature.id}/${version}/rule`,
            {
              method: "PUT",
              body: JSON.stringify({
                rule: values,
                environment,
                i,
              } as PutFeatureRuleBody),
            },
          );
        }
      } else {
        res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${version}/rule`,
          {
            method: "POST",
            body: JSON.stringify({
              rule: values,
              environments:
                values.type === "safe-rollout"
                  ? [environment]
                  : selectedEnvironments,
              safeRolloutFields,
            } as PostFeatureRuleBody),
          },
        );
      }

      await mutate();
      if (res && res?.version) {
        setVersion(res.version);
      }
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
        header={`New Rule`}
        subHeader="You will have a chance to review new rules as a draft before publishing changes."
        submit={submitOverview}
        autoCloseOnSubmit={false}
      >
        <div className="bg-highlight rounded p-3 mb-3">
          <Text size="4" weight="bold" as="div" mb="4">
            Select Implementation
          </Text>
          <Text>MANUAL</Text>
          <RadioCards
            mt="2"
            mb="5"
            width="100%"
            options={[
              {
                value: "force",
                label: "Force value",
                description:
                  "Target groups of users and give them all the same value",
              },
              {
                value: "rollout",
                label: "Percentage rollout",
                description:
                  "Release to small percentage of users while monitoring logs",
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

          <Text>DATA-DRIVEN</Text>
          <RadioCards
            mt="2"
            width="100%"
            options={[
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
                badge: "NEW!",
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
              ...(growthbook.isOn("bandits")
                ? [
                    {
                      value: "bandit",
                      disabled:
                        !hasMultiArmedBanditFeature ||
                        !hasStickyBucketFeature ||
                        !orgStickyBucketing,
                      label: (
                        <PremiumTooltip
                          commercialFeature="multi-armed-bandits"
                          usePortal={true}
                        >
                          Bandit
                        </PremiumTooltip>
                      ),
                      description: (
                        <>
                          <div>
                            Find a winner among many variations on one goal
                            metric
                          </div>
                          {hasStickyBucketFeature && !orgStickyBucketing && (
                            <HelperText status="info" size="sm" mt="2">
                              Enable Sticky Bucketing in your organization
                              settings to run a Bandit
                            </HelperText>
                          )}
                        </>
                      ),
                    },
                  ]
                : []),
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

  let headerText =
    mode === "duplicate" ? "Duplicate " : mode === "create" ? "Add " : "Edit ";
  headerText +=
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
  const trackingEventModalType = kebabCase(headerText);
  headerText +=
    ruleType === "safe-rollout"
      ? ` in ${environment}`
      : ` in ${selectedEnvironments[0]}${
          selectedEnvironments.length > 1
            ? ` + ${selectedEnvironments.length - 1} more`
            : ""
        }`;

  return (
    <FormProvider {...form}>
      <PagedModal
        trackingEventModalType={trackingEventModalType}
        close={close}
        size="lg"
        cta="Save"
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
      >
        {ruleType === "force" && (
          <ForceValueFields
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
          />
        )}

        {ruleType === "rollout" && (
          <RolloutFields
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
                />
              </Page>
            ))
          : null}
      </PagedModal>
    </FormProvider>
  );
}
