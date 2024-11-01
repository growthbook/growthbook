import { FormProvider, useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
  ScheduleRule,
} from "back-end/types/feature";
import React, { useMemo, useState } from "react";
import uniqId from "uniqid";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { generateVariationId, isFeatureCyclic } from "shared/util";
import cloneDeep from "lodash/cloneDeep";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { PiCaretRight } from "react-icons/pi";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { getScopedSettings } from "shared/settings";
import { kebabCase } from "lodash";
import {
  NewExperimentRefRule,
  getDefaultRuleValue,
  getFeatureDefaultValue,
  getRules,
  useAttributeSchema,
  useFeaturesList,
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
import RadioCards from "@/components/Radix/RadioCards";
import RadioGroup from "@/components/Radix/RadioGroup";
import PagedModal from "@/components/Modal/PagedModal";
import ForceValueFields from "@/components/Features/RuleModal/ForceValueFields";
import RolloutFields from "@/components/Features/RuleModal/RolloutFields";
import ExperimentRefFields from "@/components/Features/RuleModal/ExperimentRefFields";
import ExperimentRefNewFields from "@/components/Features/RuleModal/ExperimentRefNewFields";
import Page from "@/components/Modal/Page";
import BanditRefFields from "@/components/Features/RuleModal/BanditRefFields";
import BanditRefNewFields from "@/components/Features/RuleModal/BanditRefNewFields";
import { useIncrementer } from "@/hooks/useIncrementer";
import HelperText from "@/components/Radix/HelperText";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  version: number;
  setVersion: (version: number) => void;
  mutate: () => void;
  i: number;
  environment: string;
  defaultType?: string;
  revisions?: FeatureRevisionInterface[];
}

type RadioSelectorRuleType = "force" | "rollout" | "experiment" | "bandit" | "";
type OverviewRuleType =
  | "force"
  | "rollout"
  | "experiment-ref"
  | "experiment-ref-new"
  | "";

export default function RuleModal({
  close,
  feature,
  i,
  mutate,
  environment,
  defaultType = "",
  version,
  setVersion,
  revisions,
}: Props) {
  const growthbook = useGrowthBook<AppFeatures>();
  const { hasCommercialFeature, organization } = useUser();
  const { apiCall } = useAuth();

  const attributeSchema = useAttributeSchema(false, feature.project);

  const rules = getRules(feature, environment);
  const rule = rules[i];
  const isNewRule = !rule;

  const { features } = useFeaturesList();
  const { datasources } = useDefinitions();
  const { experimentsMap, mutateExperiments } = useExperiments();

  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] = useState(
    false
  );

  const settings = useOrgSettings();
  const { settings: scopedSettings } = getScopedSettings({ organization });

  const defaultRuleValues = getDefaultRuleValue({
    defaultValue: getFeatureDefaultValue(feature),
    ruleType: defaultType,
    attributeSchema,
  });
  const defaultValues = {
    ...defaultRuleValues,
    ...rule,
  };

  // Overview Page
  const [newRuleOverviewPage, setNewRuleOverviewPage] = useState<boolean>(
    isNewRule
  );
  const [
    overviewRadioSelectorRuleType,
    setOverviewRadioSelectorRuleType,
  ] = useState<RadioSelectorRuleType>("");
  const [overviewRuleType, setOverviewRuleType] = useState<OverviewRuleType>(
    ""
  );

  // Paged modal
  const [step, setStep] = useState(0);

  const form = useForm<FeatureRule | NewExperimentRefRule>({
    defaultValues,
  });

  const [scheduleToggleEnabled, setScheduleToggleEnabled] = useState(
    (defaultValues.scheduleRules || []).some(
      (scheduleRule) => scheduleRule.timestamp !== null
    )
  );

  const orgStickyBucketing = !!settings.useStickyBucketing;
  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits"
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

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    feature.project
  );

  const prerequisites = form.watch("prerequisites") || [];
  const [isCyclic, cyclicFeatureId] = useMemo(() => {
    if (!prerequisites.length) return [false, null];
    const newFeature = cloneDeep(feature);
    const revision = revisions?.find((r) => r.version === version);
    const newRevision = cloneDeep(revision);
    if (newRevision) {
      // merge form values into revision
      const newRule = form.getValues() as FeatureRule;
      newRevision.rules[environment] = newRevision.rules[environment] || [];
      newRevision.rules[environment][i] = newRule;
    }
    const featuresMap = new Map(features.map((f) => [f.id, f]));
    return isFeatureCyclic(newFeature, featuresMap, newRevision, [environment]);
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(prerequisites),
    prerequisites.length,
    features,
    feature,
    revisions,
    version,
    environment,
    form,
    i,
  ]);

  const [
    prerequisiteTargetingSdkIssues,
    setPrerequisiteTargetingSdkIssues,
  ] = useState(false);
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
          scopedSettings.regressionAdjustmentEnabled.value
        );
        form.setValue(
          "banditScheduleValue",
          scopedSettings.banditScheduleValue.value
        );
        form.setValue(
          "banditScheduleUnit",
          scopedSettings.banditScheduleUnit.value
        );
        form.setValue(
          "banditBurnInValue",
          scopedSettings.banditBurnInValue.value
        );
        form.setValue(
          "banditBurnInUnit",
          scopedSettings.banditScheduleUnit.value
        );
      }
    }
  };

  const submit = form.handleSubmit(async (values) => {
    const ruleAction = i === rules.length ? "add" : "edit";

    // If the user built a schedule, but disabled the toggle, we ignore the schedule
    if (!scheduleToggleEnabled) {
      values.scheduleRules = [];
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
          feature
        );
        if (newRule) {
          form.reset({
            ...newRule,
            type: "experiment-ref-new",
            name: values.name,
          });
          throw new Error(
            "We fixed some errors in the rule. If it looks correct, submit again."
          );
        }

        // If we're scheduling this rule, always auto start the experiment so it's not stuck in a 'draft' state
        if (!values.autoStart && values.scheduleRules?.length) {
          values.autoStart = true;
        }
        // If we're starting the experiment immediately, remove any scheduling rules
        // When we hide the schedule UI the form values don't update, so this resets it if you get into a weird state
        else if (values.autoStart && values.scheduleRules?.length) {
          values.scheduleRules = [];
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

        // All looks good, create experiment
        const exp: Partial<ExperimentInterfaceStringDates> = {
          archived: false,
          autoSnapshots: true,
          ...getNewExperimentDatasourceDefaults(
            datasources,
            settings,
            feature.project || ""
          ),
          hashAttribute: values.hashAttribute,
          fallbackAttribute: values.fallbackAttribute || "",
          disableStickyBucketing: values.disableStickyBucketing ?? false,
          datasource: values.datasource || undefined,
          exposureQueryId: values.exposureQueryId || "",
          goalMetrics: values.goalMetrics || [],
          secondaryMetrics: values.secondaryMetrics || [],
          guardrailMetrics: values.guardrailMetrics || [],
          activationMetric: "",
          name: values.name,
          hashVersion: (values.hashVersion ||
            (hasSDKWithNoBucketingV2 ? 1 : 2)) as 1 | 2,
          owner: "",
          status:
            values.experimentType === "multi-armed-bandit"
              ? "draft"
              : values.autoStart
              ? "running"
              : "draft",
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
              : values.sequentialTestingEnabled ??
                !!settings?.sequentialTestingEnabled,
          sequentialTestingTuningParameter:
            values.sequentialTestingTuningParameter ??
            settings?.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
          regressionAdjustmentEnabled:
            values.regressionAdjustmentEnabled ?? undefined,
          statsEngine: values.statsEngine ?? undefined,
          type: values.experimentType,
        };

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
          }
        );

        if ("duplicateTrackingKey" in res) {
          setAllowDuplicateTrackingKey(true);
          throw new Error(
            "Warning: An experiment with that tracking key already exists. To continue anyway, click 'Save' again."
          );
        }

        track("Create Experiment", {
          source: "experiment-ref-new-rule-modal",
          numTags: feature.tags?.length || 0,
          numMetrics: 0,
          numVariations: values.values.length || 0,
        });

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
            variationId: res.experiment.variations[i]?.id || "",
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
          values.variations.map((v) => [v.variationId, v.value])
        );

        values.variations = exp.variations.map((v, i) => {
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
          "We fixed some errors in the rule. If it looks correct, submit again."
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
        hasDescription: values.description.length > 0,
      });

      const res = await apiCall<{ version: number }>(
        `/feature/${feature.id}/${version}/rule`,
        {
          method: i === rules.length ? "POST" : "PUT",
          body: JSON.stringify({
            rule: values,
            environment,
            i,
          }),
        }
      );
      await mutate();
      res.version && setVersion(res.version);
    } catch (e) {
      track("Feature Rule Error", {
        source: ruleAction,
        ruleIndex: i,
        environment,
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
        ctaEnabled={!!overviewRuleType}
        bodyClassName="px-4"
        header={`New Rule in ${environment}`}
        subHeader="You will have a chance to review new rules as a draft before publishing changes."
        submit={submitOverview}
        autoCloseOnSubmit={false}
      >
        <div className="bg-highlight rounded p-3 mb-3">
          <h5>Select rule type</h5>
          <RadioCards
            mt="4"
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
                  "Release to small percent of users while monitoring logs",
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
                          <span className="mr-auto badge badge-purple text-uppercase ml-2">
                            Beta
                          </span>
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
            />
          </>
        )}
      </Modal>
    );
  }

  let headerText = isNewRule ? "Add " : "Edit ";
  headerText +=
    ruleType === "force"
      ? `${isNewRule ? "new " : ""}Force Value Rule`
      : ruleType === "rollout"
      ? `${isNewRule ? "new " : ""}Percentage Rollout Rule`
      : ["experiment-ref", "experiment-ref-new", "experiment"].includes(
          ruleType ?? ""
        ) && experimentType === "bandit"
      ? `${
          ruleType === "experiment-ref-new" ? "new" : "existing"
        } Bandit as Rule`
      : ["experiment-ref", "experiment-ref-new", "experiment"].includes(
          ruleType ?? ""
        ) && experimentType === "experiment"
      ? `${
          ruleType === "experiment-ref-new" ? "new" : "existing"
        } Experiment as Rule`
      : "Rule";
  const trackingEventModalType = kebabCase(headerText);
  headerText += ` in ${environment}`;

  return (
    <FormProvider {...form}>
      <PagedModal
        trackingEventModalType={trackingEventModalType}
        close={close}
        size="lg"
        cta="Save"
        ctaEnabled={newRuleOverviewPage ? ruleType !== undefined : canSubmit}
        bodyClassName="px-4"
        header={headerText}
        docSection={
          ruleType === "experiment-ref-new"
            ? "experimentConfiguration"
            : undefined
        }
        step={step}
        setStep={setStep}
        hideNav={ruleType !== "experiment-ref-new"}
        backButton={true}
        onBackFirstStep={
          isNewRule ? () => setNewRuleOverviewPage(true) : undefined
        }
        submit={submit}
      >
        {ruleType === "force" && (
          <ForceValueFields
            feature={feature}
            environment={environment}
            defaultValues={defaultValues}
            version={version}
            revisions={revisions}
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
            environment={environment}
            defaultValues={defaultValues}
            version={version}
            revisions={revisions}
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

        {(ruleType === "experiment-ref" || ruleType === "experiment") &&
        experimentType === "experiment" ? (
          <ExperimentRefFields
            feature={feature}
            environment={environment}
            i={i}
            changeRuleType={changeRuleType}
          />
        ) : null}

        {(ruleType === "experiment-ref" || ruleType === "experiment") &&
        experimentType === "bandit" ? (
          <BanditRefFields
            feature={feature}
            environment={environment}
            i={i}
            changeRuleType={changeRuleType}
          />
        ) : null}

        {ruleType === "experiment-ref-new" && experimentType === "experiment"
          ? ["Overview", "Traffic", "Targeting"].map((p, i) => (
              <Page display={p} key={i}>
                <ExperimentRefNewFields
                  step={i}
                  source="rule"
                  feature={feature}
                  project={feature.project}
                  environment={environment}
                  defaultValues={defaultValues}
                  version={version}
                  revisions={revisions}
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
                  orgStickyBucketing={orgStickyBucketing}
                />
              </Page>
            ))
          : null}

        {ruleType === "experiment-ref-new" && experimentType === "bandit"
          ? [
              "Overview",
              "Traffic",
              "Targeting",
              <>
                Analysis
                <br />
                Settings
              </>,
            ].map((p, i) => (
              <Page display={p} key={i}>
                <BanditRefNewFields
                  step={i}
                  source="rule"
                  feature={feature}
                  project={feature.project}
                  environment={environment}
                  version={version}
                  revisions={revisions}
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
