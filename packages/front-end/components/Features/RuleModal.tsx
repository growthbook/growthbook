import { useForm } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureValueField from "./FeatureValueField";
import { useAuth } from "../../services/auth";
import ConditionInput from "./ConditionInput";
import {
  getDefaultRuleValue,
  getFeatureDefaultValue,
  getRules,
  useAttributeSchema,
  validateFeatureRule,
} from "../../services/features";
import track from "../../services/track";
import RolloutPercentInput from "./RolloutPercentInput";
import VariationsInput from "./VariationsInput";
import NamespaceSelector from "./NamespaceSelector";
import useOrgSettings from "../../hooks/useOrgSettings";
import { useExperiments } from "../../hooks/useExperiments";
import SelectField from "../Forms/SelectField";
import { useMemo } from "react";
import StatusIndicator from "../Experiment/StatusIndicator";
import { phaseSummary } from "../../services/utils";
import { VariationValuesInput } from "./VariationValuesInput";
import { useDefinitions } from "../../services/DefinitionsContext";

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

  const { datasources, getDatasourceById } = useDefinitions();

  const { experiments, mutateExperiments } = useExperiments(feature.project);

  const experimentsMap = useMemo(() => {
    return new Map(experiments.map((e) => [e.id, e]));
  }, [experiments]);

  const { namespaces } = useOrgSettings();

  const rules = getRules(feature, environment);

  const defaultValues = {
    ...getDefaultRuleValue({
      defaultValue: getFeatureDefaultValue(feature),
      ruleType: defaultType,
      attributeSchema,
    }),
    ...((rules[i] as FeatureRule) || {}),
    experimentName: "",
    datasource: datasources?.[0]?.id || "",
    exposureQuery: "",
  };
  const form = useForm({
    defaultValues,
  });
  const { apiCall } = useAuth();

  const type = form.watch("type");

  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  // Only enable the old experiment rule type if it was already set
  const legacyExperimentRuleEnabled = rules[i]?.type === "experiment";

  const datasource = getDatasourceById(form.watch("datasource"));

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      cta="Save"
      header={rules[i] ? "Edit Override Rule" : "New Override Rule"}
      submit={form.handleSubmit(async (values) => {
        const ruleAction = i === rules.length ? "add" : "edit";
        const rule = values as FeatureRule;

        try {
          const newRule = validateFeatureRule(rule, feature.valueType);
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
            hasCondition: rule.condition.length > 2,
            hasDescription: rule.description.length > 0,
          });

          await apiCall(`/feature/${feature.id}/rule`, {
            method: i === rules.length ? "POST" : "PUT",
            body: JSON.stringify({
              rule,
              environment,
              i,
            }),
          });
          mutate();
          // If we created a new experiment, update the list
          if (values.type === "experiment-ref" && !values.experimentId) {
            mutateExperiments();
          }
        } catch (e) {
          track("Feature Rule Error", {
            source: ruleAction,
            ruleIndex: i,
            environment,
            type: rule.type,
            hasCondition: rule.condition.length > 2,
            hasDescription: rule.description.length > 0,
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
      <Field
        label="Type of Rule"
        readOnly={!!rules[i]}
        disabled={!!rules[i]}
        value={type}
        onChange={(e) => {
          const existingCondition = form.watch("condition");
          const newVal = {
            ...getDefaultRuleValue({
              defaultValue: getFeatureDefaultValue(feature),
              ruleType: e.target.value,
              attributeSchema,
            }),
            description: form.watch("description"),
          };
          if (existingCondition && existingCondition !== "{}") {
            newVal.condition = existingCondition;
          }
          form.reset(newVal);
        }}
        options={[
          { display: "Forced Value", value: "force" },
          { display: "Percentage Rollout", value: "rollout" },
          { display: "A/B Experiment", value: "experiment-ref" },
          ...(legacyExperimentRuleEnabled
            ? [{ display: "Legacy A/B Experiment", value: "experiment" }]
            : []),
        ]}
      />
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
            value={form.watch("coverage")}
            setValue={(coverage) => {
              form.setValue("coverage", coverage);
            }}
          />
          <Field
            label="Sample users based on attribute"
            {...form.register("hashAttribute")}
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the feature key to determine if user is part of the rollout"
          />
        </div>
      )}
      {type === "experiment-ref" && (
        <div>
          <SelectField
            label="Experiment"
            value={form.watch("experimentId")}
            onChange={(value) => {
              form.setValue("experimentId", value);
            }}
            options={[
              {
                label: "New Experiment",
                value: "",
              },
              ...experiments.map((e) => ({
                label: e.name,
                value: e.id,
              })),
            ]}
            formatOptionLabel={({ value, label }) => {
              if (!value) return label;
              const exp = experimentsMap.get(value);
              if (!exp) return label;

              const phase = exp.phases?.[exp.phases?.length - 1];
              return (
                <div>
                  <div className="d-flex align-items-center">
                    <strong>{exp.name}</strong>
                    <div className="ml-2">
                      <StatusIndicator
                        status={exp.status}
                        archived={exp.archived}
                      />
                    </div>
                  </div>
                  {phase && <small>{phaseSummary(phase)}</small>}
                </div>
              );
            }}
          />
          {form.watch("experimentId") ? (
            <VariationValuesInput
              type={feature.valueType}
              values={form.watch("variations") || []}
              variations={
                experimentsMap.get(form.watch("experimentId"))?.variations || []
              }
              setValues={(values) => {
                form.setValue("variations", values);
              }}
            />
          ) : (
            <div>
              <Field
                label="Experiment Name"
                {...form.register(`experimentName`)}
                required
              />
              {datasources?.length > 0 && (
                <SelectField
                  label="Data Source"
                  value={form.watch("datasource")}
                  initialOption="Manual"
                  options={datasources.map((d) => ({
                    label: d.name,
                    value: d.id,
                  }))}
                  onChange={(datasource) => {
                    form.setValue("datasource", datasource);
                  }}
                />
              )}
              {datasource && datasource.properties.exposureQueries && (
                <SelectField
                  label="Tracking Table"
                  value={form.watch("exposureQuery")}
                  onChange={(v) => {
                    form.setValue("exposureQuery", v);
                  }}
                  initialOption="Select One..."
                  options={datasource.settings.queries?.exposure?.map((q) => ({
                    label: q.name,
                    value: q.id,
                  }))}
                />
              )}
            </div>
          )}
        </div>
      )}
      {(type === "experiment" ||
        (type === "experiment-ref" && !form.watch("experimentId"))) && (
        <div>
          <Field
            label="Tracking Key"
            {...form.register(`trackingKey`)}
            placeholder={feature.id}
            helpText="Unique identifier for this experiment, used to track impressions and analyze results"
          />
          <Field
            label="Assign value based on attribute"
            {...form.register("hashAttribute")}
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the Tracking Key to pick a value"
          />
          <VariationsInput
            defaultValue={getFeatureDefaultValue(feature)}
            valueType={feature.valueType}
            coverage={form.watch("coverage")}
            setCoverage={(coverage) => form.setValue("coverage", coverage)}
            setWeight={(i, weight) =>
              form.setValue(`values.${i}.weight`, weight)
            }
            variations={form.watch("values") || []}
            setVariations={(variations) => form.setValue("values", variations)}
          />
          {namespaces?.length > 0 && (
            <NamespaceSelector
              form={form}
              trackingKey={form.watch("trackingKey") || feature.id}
              featureId={feature.id}
              formPrefix=""
            />
          )}
        </div>
      )}
    </Modal>
  );
}
