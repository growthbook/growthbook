import { FormProvider, useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
  ScheduleRule,
} from "back-end/types/feature";
import React, { useMemo, useState } from "react";
import { date } from "shared/dates";
import uniqId from "uniqid";
import {
  ExperimentInterfaceStringDates,
  ExperimentType,
} from "back-end/types/experiment";
import { includeExperimentInPayload, isFeatureCyclic } from "shared/util";
import { FaExclamationTriangle, FaExternalLinkAlt } from "react-icons/fa";
import Link from "next/link";
import cloneDeep from "lodash/cloneDeep";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { FaRegCircleCheck } from "react-icons/fa6";
import { useGrowthBook } from "@growthbook/growthbook-react";
import {
  NewExperimentRefRule,
  generateVariationId,
  getDefaultRuleValue,
  getDefaultVariationValue,
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
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAuth } from "@/services/auth";
import useSDKConnections from "@/hooks/useSDKConnections";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "@/components/Experiment/HashVersionSelector";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import StatusIndicator from "@/components/Experiment/StatusIndicator";
import Toggle from "@/components/Forms/Toggle";
import { getNewExperimentDatasourceDefaults } from "@/components/Experiment/NewExperimentForm";
import TargetingInfo from "@/components/Experiment/TabbedPage/TargetingInfo";
import EditTargetingModal from "@/components/Experiment/EditTargetingModal";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { AppFeatures } from "@/types/app-features";
import { useUser } from "@/services/UserContext";
import RadioCards from "@/components/Radix/RadioCards";
import RadioGroup from "@/components/Radix/RadioGroup";
import ConditionInput from "components/Features/ConditionInput";
import FeatureValueField from "components/Features/FeatureValueField";
import NamespaceSelector from "components/Features/NamespaceSelector";
import ScheduleInputs from "components/Features/ScheduleInputs";
import FeatureVariationsInput from "components/Features/FeatureVariationsInput";
import SavedGroupTargetingField from "components/Features/SavedGroupTargetingField";
import FallbackAttributeSelector from "components/Features/FallbackAttributeSelector";
import PagedModal from "@/components/Modal/PagedModal";
import ForceValueFields from "@/components/Features/RuleModal/ForceValueFields";
import RolloutFields from "@/components/Features/RuleModal/RolloutFields";
import ExperimentRefFields from "@/components/Features/RuleModal/ExperimentRefFields";
import ExperimentRefNewFields from "@/components/Features/RuleModal/ExperimentRefNewFields";

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
  const { hasCommercialFeature } = useUser();

  const attributeSchema = useAttributeSchema(false, feature.project);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const { namespaces } = useOrgSettings();

  const rules = getRules(feature, environment);
  const rule = rules[i];

  const { datasources } = useDefinitions();

  const { experiments, experimentsMap, mutateExperiments } = useExperiments();

  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] = useState(
    false
  );

  const [showTargetingModal, setShowTargetingModal] = useState(false);

  const settings = useOrgSettings();

  const defaultRuleValues = getDefaultRuleValue({
    defaultValue: getFeatureDefaultValue(feature),
    ruleType: defaultType,
    attributeSchema,
  });

  const [conditionKey, forceConditionRender] = useIncrementer();

  const { features } = useFeaturesList();

  const defaultValues = {
    ...defaultRuleValues,
    ...rule,
  };

  const [scheduleToggleEnabled, setScheduleToggleEnabled] = useState(
    (defaultValues.scheduleRules || []).some(
      (scheduleRule) => scheduleRule.timestamp !== null
    )
  );

  const [newRuleOverviewPage, setNewRuleOverviewPage] = useState<boolean>(
    !defaultType
  );
  const [
    overviewRadioSelectorRuleType,
    setOverviewRadioSelectorRuleType,
  ] = useState<"force" | "rollout" | "experiment" | "bandit" | "">("");
  const [overviewRuleType, setOverviewRuleType] = useState<
    "force" | "rollout" | "experiment-ref" | "experiment-ref-new" | ""
  >("");

  const [step, setStep] = useState(0);

  const form = useForm<FeatureRule | NewExperimentRefRule>({
    defaultValues,
  });
  const { apiCall } = useAuth();

  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits"
  );
  const usingStickyBucketing = !!settings.useStickyBucketing;

  const type = form.watch("type");

  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const experimentId = form.watch("experimentId");
  const selectedExperiment = experimentsMap.get(experimentId) || null;

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

  if (showUpgradeModal) {
    return (
      <UpgradeModal
        close={() => setShowUpgradeModal(false)}
        reason="To enable feature flag scheduling,"
        source="schedule-feature-flag"
      />
    );
  }

  const ruleTypeOptions = [
    { label: "Forced Value", value: "force" },
    { label: "Percentage Rollout", value: "rollout" },
    { label: "New A/B Experiment", value: "experiment-ref-new" },
    { label: "Existing A/B Experiment", value: "experiment-ref" },
  ];

  if (type === "experiment") {
    ruleTypeOptions.push({
      label: "A/B Experiment",
      value: "experiment",
    });
  }

  const experimentOptions = experiments
    .filter(
      (e) =>
        e.id === experimentId ||
        (!e.archived &&
          e.status !== "stopped" &&
          (e.project || "") === (feature.project || ""))
    )
    .sort((a, b) => b.dateCreated.localeCompare(a.dateCreated))
    .map((e) => ({
      label: e.name,
      value: e.id,
    }));

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

  const canEditTargeting =
    !!selectedExperiment &&
    selectedExperiment.linkedFeatures?.length === 1 &&
    selectedExperiment.linkedFeatures[0] === feature.id &&
    !selectedExperiment.hasVisualChangesets;

  if (showTargetingModal && canEditTargeting) {
    const safeToEdit =
      selectedExperiment.status !== "running" ||
      !includeExperimentInPayload(selectedExperiment, [feature]);

    return (
      <EditTargetingModal
        close={() => setShowTargetingModal(false)}
        mutate={() => {
          mutateExperiments();
          mutate();
        }}
        experiment={selectedExperiment}
        safeToEdit={safeToEdit}
      />
    );
  }

  if (newRuleOverviewPage) {
    return (
      <Modal
        trackingEventModalType=""
        open={true}
        close={close}
        size="lg"
        cta="Next"
        ctaEnabled={!!overviewRuleType}
        bodyClassName="px-4"
        header={`New Rule in ${environment}`}
        subHeader="You will have a chance to review new rules as a draft before publishing changes."
        submit={() => {
          setNewRuleOverviewPage(false);
          changeRuleType(overviewRuleType);
          // set experiment type:
          if (overviewRadioSelectorRuleType === "experiment") {
            form.setValue("experimentType", "standard");
          } else if (overviewRadioSelectorRuleType === "bandit") {
            form.setValue("experimentType", "multi-armed-bandit");
          }
        }}
        autoCloseOnSubmit={false}
      >
        <div className="bg-highlight rounded p-3 mb-3">
          <h5>Select implementation</h5>
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
                label: "Add Experiment",
                description:
                  "Measure the impact of this feature on your key metrics",
              },
              ...(growthbook.isOn("bandits")
                ? [
                    {
                      value: "bandit",
                      disabled: !hasMultiArmedBanditFeature,
                      label: (
                        <PremiumTooltip
                          commercialFeature="multi-armed-bandits"
                          usePortal={true}
                        >
                          Add Bandit
                        </PremiumTooltip>
                      ),
                      description:
                        "Find a winner among many variations on one goal metric",
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
                setOverviewRuleType("");
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
              setValue={(
                v:
                  | "force"
                  | "rollout"
                  | "experiment-ref"
                  | "experiment-ref-new"
                  | ""
              ) => setOverviewRuleType(v)}
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
              setValue={(
                v:
                  | "force"
                  | "rollout"
                  | "experiment-ref"
                  | "experiment-ref-new"
                  | ""
              ) => setOverviewRuleType(v)}
            />
          </>
        )}
      </Modal>
    );
  }

  return (
    <FormProvider {...form}>
    <PagedModal
      close={close}
      size="lg"
      cta={newRuleOverviewPage ? "Next" : "Save"}
      ctaEnabled={newRuleOverviewPage ? type !== undefined : canSubmit}
      bodyClassName="px-4"
      header={`${rule ? "Edit Rule" : "New Rule"} in ${environment}`}
      subHeader="You will have a chance to review new rules as a draft before publishing changes."
      step={step}
      setStep={setStep}
      submit={form.handleSubmit(async (values) => {
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
            scheduleRule.timestamp = new Date(
              scheduleRule.timestamp
            ).toISOString();
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
              goalMetrics: [],
              secondaryMetrics: [],
              guardrailMetrics: [],
              activationMetric: "",
              name: values.name,
              hashVersion: hasSDKWithNoBucketingV2 ? 1 : 2,
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
              hypothesis: "",
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
              type: values.experimentType,
            };
            const res = await apiCall<
              | { experiment: ExperimentInterfaceStringDates }
              | { duplicateTrackingKey: true; existingId: string }
            >(
              `/experiments${
                allowDuplicateTrackingKey
                  ? "?allowDuplicateTrackingKey=true"
                  : ""
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
      })}
    >
        {type === "force" && (
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
            scheduleToggleEnabled={scheduleToggleEnabled}
            setScheduleToggleEnabled={setScheduleToggleEnabled}
            setShowUpgradeModal={setShowUpgradeModal}
          />
        )}

        {type === "rollout" && (
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
            scheduleToggleEnabled={scheduleToggleEnabled}
            setScheduleToggleEnabled={setScheduleToggleEnabled}
            setShowUpgradeModal={setShowUpgradeModal}
          />
        )}

        {(type === "experiment-ref" || type === "experiment") && (
          <ExperimentRefFields
            feature={feature}
            environment={environment}
            i={i}
            changeRuleType={changeRuleType}
            canEditTargeting={canEditTargeting}
            setShowTargetingModal={setShowTargetingModal}
          />
        )}

        {type === "experiment-ref-new" && (
          <ExperimentRefNewFields
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
            scheduleToggleEnabled={scheduleToggleEnabled}
            setScheduleToggleEnabled={setScheduleToggleEnabled}
            setShowUpgradeModal={setShowUpgradeModal}
          />
        )}

      {/*<div className="form-group mt-3">*/}
      {/*  <label>Rule Type</label>*/}
      {/*  {!rules[i] ? (*/}
      {/*    <SelectField*/}
      {/*      readOnly={!!rules[i]}*/}
      {/*      value={type}*/}
      {/*      sort={false}*/}
      {/*      onChange={(v) => {*/}
      {/*        changeRuleType(v);*/}
      {/*      }}*/}
      {/*      options={ruleTypeOptions}*/}
      {/*    />*/}
      {/*  ) : (*/}
      {/*    <div className="border rounded py-2 px-3">*/}
      {/*      {ruleTypeOptions.find((r) => r.value === type)?.label || type}*/}
      {/*      <Field type={"hidden"} {...form.register("type")} />*/}
      {/*    </div>*/}
      {/*  )}*/}
      {/*</div>*/}

    </PagedModal>
    </FormProvider>
  );
}
