import { useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
  ScheduleRule,
} from "back-end/types/feature";
import { useMemo, useState } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { date } from "shared/dates";
import uniqId from "uniqid";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  NewExperimentRefRule,
  generateVariationId,
  getDefaultRuleValue,
  getDefaultVariationValue,
  getFeatureDefaultValue,
  getRules,
  useAttributeSchema,
  validateFeatureRule,
} from "@/services/features";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { AppFeatures } from "@/types/app-features";
import Field from "../Forms/Field";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import SelectField from "../Forms/SelectField";
import UpgradeModal from "../Settings/UpgradeModal";
import StatusIndicator from "../Experiment/StatusIndicator";
import RolloutPercentInput from "./RolloutPercentInput";
import ConditionInput from "./ConditionInput";
import FeatureValueField from "./FeatureValueField";
import NamespaceSelector from "./NamespaceSelector";
import ScheduleInputs from "./ScheduleInputs";
import FeatureVariationsInput from "./FeatureVariationsInput";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  mutate: () => void;
  i: number;
  environment: string;
  defaultType?: string;
}

export default function RuleModal({
  close,
  feature,
  i,
  mutate,
  environment,
  defaultType = "force",
}: Props) {
  const attributeSchema = useAttributeSchema();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const showNewExperimentRule = useFeatureIsOn<AppFeatures>(
    "new-experiment-rule"
  );

  const { namespaces } = useOrgSettings();

  const rules = getRules(feature, environment);
  const rule = rules[i];

  const { project } = useDefinitions();

  const { experiments, experimentsMap, mutateExperiments } = useExperiments(
    project
  );

  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] = useState(
    false
  );

  const settings = useOrgSettings();

  const defaultRuleValues = getDefaultRuleValue({
    defaultValue: getFeatureDefaultValue(feature),
    ruleType: defaultType,
    attributeSchema,
  });

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
  const selectedExperiment = useMemo(() => {
    if (!experimentId) return null;
    const exp = experiments.find((e) => e.id === experimentId) || null;
    return exp;
  }, [experimentId, experiments]);

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
  ];

  if (showNewExperimentRule || type === "experiment-ref") {
    ruleTypeOptions.push({
      label: "New Experiment",
      value: "experiment-ref-new",
    });
    ruleTypeOptions.push({
      label: "Existing Experiment",
      value: "experiment-ref",
    });
  } else {
    ruleTypeOptions.push({ label: "A/B Experiment", value: "experiment" });
  }

  const experimentOptions = experiments
    .filter(
      (e) => e.id === experimentId || (!e.archived && e.status !== "stopped")
    )
    .sort((a, b) => b.dateCreated.localeCompare(a.dateCreated))
    .map((e) => ({
      label: e.name,
      value: e.id,
    }));

  function changeRuleType(v: string) {
    const existingCondition = form.watch("condition");
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
    form.reset(newVal);
  }

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      cta="Save"
      header={rule ? "Edit Override Rule" : "New Override Rule"}
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

            // All looks good, create experiment
            const exp: Partial<ExperimentInterfaceStringDates> = {
              archived: false,
              autoSnapshots: true,
              datasource: "",
              exposureQueryId: "",
              hashAttribute: values.hashAttribute,
              metrics: [],
              activationMetric: "",
              guardrails: [],
              name: values.name,
              hashVersion: 2,
              owner: "",
              status: "draft",
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
            console.log("Created experiment", res);
            values = {
              type: "experiment-ref",
              description: "",
              experimentId: res.experiment.id,
              id: values.id,
              condition: "",
              enabled: values.enabled ?? true,
              scheduleRules: values.scheduleRules,
              variations: values.values.map((v, i) => ({
                value: v.value,
                variationId: res.experiment.variations[i]?.id || "",
              })),
            };
            console.log("Created experiment-ref rule", values);
            mutateExperiments();
          } else if (values.type === "experiment-ref") {
            // Validate a proper experiment was chosen and it has a value for every variation id
            const experimentId = values.experimentId;
            const exp = experiments.find((e) => e.id === experimentId);
            if (!exp) throw new Error("Must select an experiment");
            const variationIds = new Set(exp.variations.map((v) => v.id));

            if (values.variations.length !== variationIds.size)
              throw new Error("Must specify a value for every variation");

            values.variations.forEach((v) => {
              if (!variationIds.has(v.variationId)) {
                throw new Error("Unknown variation id: " + v.variationId);
              }
            });
          }

          console.log("Validating rule");
          const newRule = validateFeatureRule(values, feature);
          if (newRule) {
            form.reset(newRule);
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
            hasDescription: values.description.length > 0,
          });

          await apiCall(`/feature/${feature.id}/rule`, {
            method: i === rules.length ? "POST" : "PUT",
            body: JSON.stringify({
              rule: values,
              environment,
              i,
            }),
          });
          mutate();
        } catch (e) {
          track("Feature Rule Error", {
            source: ruleAction,
            ruleIndex: i,
            environment,
            type: values.type,
            hasCondition: values.condition && values.condition.length > 2,
            hasDescription: values.description.length > 0,
            error: e.message,
          });

          throw e;
        }
      })}
    >
      <div className="alert alert-info">
        {rules[i] ? "Changes here" : "New rules"} will be added to a draft
        revision. You will have a chance to review them first before making them
        live.
      </div>
      <h3>{environment}</h3>
      <SelectField
        label="Type of Rule"
        readOnly={!!rules[i]}
        disabled={!!rules[i]}
        value={type}
        sort={false}
        onChange={(v) => {
          changeRuleType(v);
        }}
        options={ruleTypeOptions}
      />
      {type === "experiment-ref" && (
        <div>
          {experimentOptions.length > 0 ? (
            <SelectField
              label="Experiment"
              initialOption="Choose One..."
              options={experimentOptions}
              required
              sort={false}
              value={experimentId || ""}
              onChange={(experimentId) => {
                const exp = experiments.find((e) => e.id === experimentId);
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
          ) : (
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
        <>
          <Field
            label="Description (optional)"
            textarea
            minRows={1}
            {...form.register("description")}
            placeholder="Short human-readable description of the rule"
          />
          <ConditionInput
            defaultValue={defaultValues.condition || ""}
            onChange={(value) => form.setValue("condition", value)}
          />
        </>
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
            label="Value to Rollout"
            id="value"
            value={form.watch("value")}
            setValue={(v) => form.setValue("value", v)}
            valueType={feature.valueType}
          />
          <RolloutPercentInput
            value={form.watch("coverage") || 0}
            setValue={(coverage) => {
              form.setValue("coverage", coverage);
            }}
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
      )}
      {(type === "experiment" || type === "experiment-ref-new") && (
        <div>
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
      <ScheduleInputs
        defaultValue={defaultValues.scheduleRules || []}
        onChange={(value) => form.setValue("scheduleRules", value)}
        scheduleToggleEnabled={scheduleToggleEnabled}
        setScheduleToggleEnabled={setScheduleToggleEnabled}
        setShowUpgradeModal={setShowUpgradeModal}
      />
    </Modal>
  );
}
