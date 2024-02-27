import { useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
  ScheduleRule,
} from "back-end/types/feature";
import { useMemo, useState } from "react";
import { date } from "shared/dates";
import uniqId from "uniqid";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  getMatchingRules,
  includeExperimentInPayload,
  isFeatureCyclic,
} from "shared/util";
import {
  FaBell,
  FaExclamationTriangle,
  FaExternalLinkAlt,
} from "react-icons/fa";
import Link from "next/link";
import cloneDeep from "lodash/cloneDeep";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import {
  NewExperimentRefRule,
  generateVariationId,
  getDefaultRuleValue,
  getDefaultVariationValue,
  getFeatureDefaultValue,
  getRules,
  useAttributeSchema,
  useEnvironments,
  useFeaturesList,
  validateFeatureRule,
} from "@/services/features";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAuth } from "@/services/auth";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import Field from "../Forms/Field";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";
import UpgradeModal from "../Settings/UpgradeModal";
import StatusIndicator from "../Experiment/StatusIndicator";
import Toggle from "../Forms/Toggle";
import { getNewExperimentDatasourceDefaults } from "../Experiment/NewExperimentForm";
import TargetingInfo from "../Experiment/TabbedPage/TargetingInfo";
import EditTargetingModal from "../Experiment/EditTargetingModal";
import RolloutPercentInput from "./RolloutPercentInput";
import ConditionInput from "./ConditionInput";
import FeatureValueField from "./FeatureValueField";
import NamespaceSelector from "./NamespaceSelector";
import ScheduleInputs from "./ScheduleInputs";
import FeatureVariationsInput from "./FeatureVariationsInput";
import SavedGroupTargetingField from "./SavedGroupTargetingField";

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
  defaultType = "force",
  version,
  setVersion,
  revisions,
}: Props) {
  const attributeSchema = useAttributeSchema();
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
  const environments = useEnvironments();
  const hasLegacyExperimentRules = features.some(
    (f) =>
      getMatchingRules(
        f,
        (r) => r.type === "experiment",
        environments.map((e) => e.id)
      ).length > 0
  );
  const hasNewExperimentRules = features.some(
    (f) =>
      getMatchingRules(
        f,
        (r) => r.type === "experiment-ref",
        environments.map((e) => e.id)
      ).length > 0
  );

  const defaultValues = {
    ...defaultRuleValues,
    ...rule,
  };

  const [scheduleToggleEnabled, setScheduleToggleEnabled] = useState(
    (defaultValues.scheduleRules || []).some(
      (scheduleRule) => scheduleRule.timestamp !== null
    )
  );

  const form = useForm<FeatureRule | NewExperimentRefRule>({
    defaultValues,
  });
  const { apiCall } = useAuth();

  const type = form.watch("type");

  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const experimentId = form.watch("experimentId");
  const selectedExperiment = experimentsMap.get(experimentId) || null;

  const prerequisites = form.watch("prerequisites") || [];
  const [isCyclic, cyclicFeatureId] = useMemo(() => {
    if (!prerequisites.length) return [false, null];
    const newFeature = cloneDeep(feature);
    const revision = revisions?.find((r) => r.version === version);
    const newRevision = cloneDeep(revision);
    if (newRevision) {
      // merge form values into revision
      const newRule = form.getValues() as FeatureRule;
      newRevision.rules[environment][i] = newRule;
    }
    const featuresMap = new Map(features.map((f) => [f.id, f]));
    return isFeatureCyclic(newFeature, featuresMap, newRevision);
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
  const canSubmit = !isCyclic && !prerequisiteTargetingSdkIssues;

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

  const showNewExperimentRuleMessage =
    hasLegacyExperimentRules &&
    !hasNewExperimentRules &&
    (type === "experiment-ref" || type === "experiment-ref-new");

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

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      cta="Save"
      ctaEnabled={canSubmit}
      bodyClassName="px-4"
      header={`${
        rule ? "Edit Override Rule" : "New Override Rule"
      } in ${environment}`}
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
              metrics: [],
              activationMetric: "",
              guardrails: [],
              name: values.name,
              hashVersion: 2,
              owner: "",
              status: values.autoStart ? "running" : "draft",
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
      <div className="alert alert-info">
        {rules[i] ? "Changes here" : "New rules"} will be added to a draft
        revision. You will be able to review them before making them live.
      </div>

      <div className="form-group mt-3">
        <label>Rule Type</label>
        {!rules[i] ? (
          <SelectField
            readOnly={!!rules[i]}
            value={type}
            sort={false}
            onChange={(v) => {
              changeRuleType(v);
            }}
            options={ruleTypeOptions}
          />
        ) : (
          <div className="border rounded py-2 px-3">
            {ruleTypeOptions.find((r) => r.value === type)?.label || type}
            <Field type={"hidden"} {...form.register("type")} />
          </div>
        )}
      </div>

      {showNewExperimentRuleMessage && (
        <div className="appbox p-3 bg-light">
          <h4 className="text-purple">
            <FaBell /> We&apos;ve changed how Experiment rules work!
          </h4>
          <div className="mb-1">
            You can now choose to either link to an existing Experiment or
            create a new one from scratch.
          </div>
          <div className="mb-2">
            Targeting and assignment logic is now controlled by the Experiment
            instead of the Feature rule.
          </div>
          <div className="small text-muted">
            <strong>Note:</strong> This only affects new Experiment rules;
            existing ones will continue to behave how they used to.
          </div>
        </div>
      )}

      {type === "experiment-ref" && (
        <div>
          {experimentOptions.length > 0 ? (
            <SelectField
              label="Experiment"
              initialOption="Choose One..."
              options={experimentOptions}
              readOnly={!!rules[i]}
              disabled={!!rules[i]}
              required
              sort={false}
              value={experimentId || ""}
              onChange={(experimentId) => {
                const exp = experimentsMap.get(experimentId);
                if (exp) {
                  const controlValue = getFeatureDefaultValue(feature);
                  const variationValue = getDefaultVariationValue(controlValue);
                  form.setValue("experimentId", experimentId);
                  form.setValue(
                    "variations",
                    exp.variations.map((v, i) => ({
                      variationId: v.id,
                      value: i ? variationValue : controlValue,
                    }))
                  );
                }
              }}
              formatOptionLabel={({ value, label }) => {
                const exp = experimentsMap.get(value);
                if (exp) {
                  return (
                    <div className="d-flex flex-wrap">
                      <div className="flex">
                        <strong>{exp.name}</strong>
                      </div>
                      <div className="ml-4 text-muted">
                        Created: {date(exp.dateCreated)}
                      </div>
                      <div className="ml-auto">
                        <StatusIndicator
                          archived={exp.archived}
                          status={exp.status}
                        />
                      </div>
                    </div>
                  );
                }
                return label;
              }}
            />
          ) : !rules[i] ? (
            <div className="alert alert-warning">
              <div className="d-flex align-items-center">
                {experiments.length > 0
                  ? `You don't have any elegible experiments yet.`
                  : `You don't have any existing experiments yet.`}{" "}
                <button
                  type="button"
                  className="btn btn-primary ml-auto"
                  onClick={(e) => {
                    e.preventDefault();
                    changeRuleType("experiment-ref-new");
                  }}
                >
                  Create New Experiment
                </button>
              </div>
            </div>
          ) : (
            <div className="alert alert-danger">
              Could not find this experiment. Has it been deleted?
            </div>
          )}

          {selectedExperiment && rules[i] && (
            <div className="appbox px-3 pt-3 bg-light">
              {!canEditTargeting && (
                <div className="alert alert-info">
                  <Link href={`/experiment/${selectedExperiment.id}#overview`}>
                    <a className="alert-link">
                      View the Experiment <FaExternalLinkAlt />
                    </a>
                  </Link>{" "}
                  to make changes to assignment or targeting conditions.
                </div>
              )}
              <TargetingInfo
                experiment={selectedExperiment}
                editTargeting={
                  canEditTargeting
                    ? () => {
                        setShowTargetingModal(true);
                      }
                    : null
                }
              />
            </div>
          )}
          {selectedExperiment && (
            <div className="form-group">
              <label>Variation Values</label>
              <div className="mb-3 bg-light border p-3">
                {selectedExperiment.variations.map((v, i) => (
                  <FeatureValueField
                    key={v.id}
                    label={v.name}
                    id={v.id}
                    value={form.watch(`variations.${i}.value`) || ""}
                    setValue={(v) => form.setValue(`variations.${i}.value`, v)}
                    valueType={feature.valueType}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {type === "experiment-ref-new" && (
        <Field label="Experiment Name" {...form.register("name")} required />
      )}

      {type !== "experiment-ref" && (
        <Field
          label="Description"
          textarea
          minRows={1}
          {...form.register("description")}
          placeholder="Short human-readable description of the rule"
        />
      )}
      {type === "force" && (
        <FeatureValueField
          label="Value to Force"
          id="value"
          value={form.watch("value")}
          setValue={(v) => form.setValue("value", v)}
          valueType={feature.valueType}
        />
      )}

      {type === "rollout" && (
        <div>
          <FeatureValueField
            label="Value to roll out"
            id="value"
            value={form.watch("value")}
            setValue={(v) => form.setValue("value", v)}
            valueType={feature.valueType}
          />
          <div className="appbox mt-4 mb-4 px-3 pt-3 bg-light">
            <RolloutPercentInput
              value={form.watch("coverage") || 0}
              setValue={(coverage) => {
                form.setValue("coverage", coverage);
              }}
              className="mb-1"
            />
            <SelectField
              label="Assign value based on attribute"
              options={attributeSchema
                .filter((s) => !hasHashAttributes || s.hashAttribute)
                .map((s) => ({ label: s.property, value: s.property }))}
              value={form.watch("hashAttribute")}
              onChange={(v) => {
                form.setValue("hashAttribute", v);
              }}
              helpText={
                "Will be hashed together with the Tracking Key to determine which variation to assign"
              }
            />
          </div>
        </div>
      )}

      {(type !== "experiment-ref" && type !== "experiment-ref-new") ||
      rule?.scheduleRules?.length ? (
        <ScheduleInputs
          defaultValue={defaultValues.scheduleRules || []}
          onChange={(value) => form.setValue("scheduleRules", value)}
          scheduleToggleEnabled={scheduleToggleEnabled}
          setScheduleToggleEnabled={setScheduleToggleEnabled}
          setShowUpgradeModal={setShowUpgradeModal}
          title="Add scheduling to automatically enable/disable this rule"
        />
      ) : null}

      {(type === "experiment" || type === "experiment-ref-new") && (
        <>
          <div className="mt-4 mb-4">
            <Field
              label="Tracking Key"
              {...form.register(`trackingKey`)}
              placeholder={feature.id}
              helpText="Unique identifier for this experiment, used to track impressions and analyze results"
            />
            <SelectField
              label="Assign value based on attribute"
              options={attributeSchema
                .filter((s) => !hasHashAttributes || s.hashAttribute)
                .map((s) => ({ label: s.property, value: s.property }))}
              value={form.watch("hashAttribute")}
              onChange={(v) => {
                form.setValue("hashAttribute", v);
              }}
              helpText={
                "Will be hashed together with the Tracking Key to determine which variation to assign"
              }
            />
          </div>
          <hr />
        </>
      )}

      {!(
        type === "experiment" ||
        type === "experiment-ref" ||
        type === "experiment-ref-new"
      ) && <hr />}

      {type !== "experiment-ref" && (
        <div className="mt-4">
          <SavedGroupTargetingField
            value={form.watch("savedGroups") || []}
            setValue={(savedGroups) =>
              form.setValue("savedGroups", savedGroups)
            }
          />
          <hr />
          <ConditionInput
            defaultValue={form.watch("condition") || ""}
            onChange={(value) => form.setValue("condition", value)}
            key={conditionKey}
          />
          <hr />
          <PrerequisiteTargetingField
            value={form.watch("prerequisites") || []}
            setValue={(prerequisites) =>
              form.setValue("prerequisites", prerequisites)
            }
            feature={feature}
            revisions={revisions}
            version={version}
            environments={[environment]}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
          />
          {(type === "experiment" || type === "experiment-ref-new") && <hr />}
        </div>
      )}
      {isCyclic && (
        <div className="alert alert-danger">
          <FaExclamationTriangle /> A prerequisite (
          <code>{cyclicFeatureId}</code>) creates a circular dependency. Remove
          this prerequisite to continue.
        </div>
      )}

      {(type === "experiment" || type === "experiment-ref-new") && (
        <div>
          <FeatureVariationsInput
            defaultValue={getFeatureDefaultValue(feature)}
            valueType={feature.valueType}
            coverage={form.watch("coverage") || 0}
            setCoverage={(coverage) => form.setValue("coverage", coverage)}
            setWeight={(i, weight) =>
              form.setValue(`values.${i}.weight`, weight)
            }
            variations={
              form
                .watch("values")
                .map((v: ExperimentValue & { id?: string }) => {
                  return {
                    value: v.value || "",
                    name: v.name,
                    weight: v.weight,
                    id: v.id || generateVariationId(),
                  };
                }) || []
            }
            setVariations={(variations) => form.setValue("values", variations)}
          />
          {namespaces && namespaces.length > 0 && (
            <NamespaceSelector
              form={form}
              trackingKey={form.watch("trackingKey") || feature.id}
              featureId={feature.id}
              formPrefix=""
            />
          )}
        </div>
      )}
      {type === "experiment-ref-new" && (
        <div className="mb-3">
          <Toggle
            value={form.watch("autoStart")}
            setValue={(v) => form.setValue("autoStart", v)}
            id="auto-start-new-experiment"
          />{" "}
          <label htmlFor="auto-start-new-experiment" className="text-dark">
            Start Experiment Immediately
          </label>
          <div>
            <small className="form-text text-muted">
              If On, the experiment will start serving traffic as soon as the
              feature is published. Leave Off if you want to make additional
              changes before starting.
            </small>
          </div>
          {!form.watch("autoStart") && (
            <div>
              <hr />
              <ScheduleInputs
                defaultValue={defaultValues.scheduleRules || []}
                onChange={(value) => form.setValue("scheduleRules", value)}
                scheduleToggleEnabled={scheduleToggleEnabled}
                setScheduleToggleEnabled={setScheduleToggleEnabled}
                setShowUpgradeModal={setShowUpgradeModal}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
