import { useFieldArray, useForm } from "react-hook-form";
import {
  ExperimentRule,
  FeatureInterface,
  FeatureRule,
  FeatureValueType,
  ForceRule,
  RolloutRule,
} from "back-end/types/feature";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureValueField from "./FeatureValueField";
import { useAuth } from "../../services/auth";
import ConditionInput from "./ConditionInput";
import { isValidValue } from "../../services/features";
import track from "../../services/track";
import useOrgSettings from "../../hooks/useOrgSettings";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  mutate: () => void;
  i: number;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function getDefaultVariationValue(
  valueType: FeatureValueType,
  defaultValue: string
) {
  if (valueType === "json") return defaultValue;

  if (valueType === "string") return defaultValue + " 2";

  try {
    const parsed = JSON.parse(defaultValue);
    if (typeof parsed === "number") {
      return JSON.stringify(parsed + 1);
    }
    if (typeof parsed === "boolean") {
      return JSON.stringify(!parsed);
    }

    return defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

export default function RuleModal({ close, feature, i, mutate }: Props) {
  const defaultValues = {
    condition: "",
    description: "",
    enabled: true,
    type: "force",
    coverage: 1,
    value: getDefaultVariationValue(feature.valueType, feature.defaultValue),
    values: [
      {
        weight: 0.5,
        value: feature.defaultValue,
      },
      {
        weight: 0.5,
        value: getDefaultVariationValue(
          feature.valueType,
          feature.defaultValue
        ),
      },
    ],
    hashAttribute: "id",
    trackingKey: "",
    ...((feature?.rules?.[i] as FeatureRule) || {}),
  };
  const form = useForm({
    defaultValues,
  });

  const variations = useFieldArray({ name: "values", control: form.control });

  const { apiCall } = useAuth();

  const settings = useOrgSettings();

  const type = form.watch("type");

  const hasHashAttributes =
    settings?.attributeSchema?.filter((x) => x.hashAttribute)?.length > 0;

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      header={feature.rules[i] ? "Edit Override Rule" : "New Override Rule"}
      submit={form.handleSubmit(async (values) => {
        const ruleAction = i === feature.rules?.length ? "add" : "edit";

        try {
          const rules = [...feature.rules];
          rules[i] = values as FeatureRule;

          if (rules[i].condition) {
            try {
              const res = JSON.parse(rules[i].condition);
              if (!res || typeof res !== "object") {
                throw new Error("Condition is invalid");
              }
            } catch (e) {
              throw new Error("Condition is invalid: " + e.message);
            }
          }
          if (rules[i].type === "force") {
            isValidValue(
              feature.valueType,
              (rules[i] as ForceRule).value,
              "Forced value"
            );
          } else if (rules[i].type === "experiment") {
            const ruleValues = (rules[i] as ExperimentRule).values;
            if (!ruleValues || !ruleValues.length) {
              throw new Error("Must set at least one value");
            }
            let totalWeight = 0;
            ruleValues.forEach((val, i) => {
              if (val.weight < 0)
                throw new Error("Percents cannot be negative");
              totalWeight += val.weight;
              isValidValue(feature.valueType, val.value, "Value #" + (i + 1));
            });
            if (totalWeight > 1) {
              throw new Error(
                `Sum of weights cannot be greater than 1 (currently equals ${totalWeight})`
              );
            }
          } else {
            isValidValue(
              feature.valueType,
              (rules[i] as RolloutRule).value,
              "Rollout value"
            );

            if (values.coverage < 0 || values.coverage > 1) {
              throw new Error("Rollout percent must be between 0 and 1");
            }
          }

          track("Save Feature Rule", {
            source: ruleAction,
            ruleIndex: i,
            type: values.type,
            hasCondition: values.condition.length > 2,
            hasDescription: values.description.length > 0,
          });

          await apiCall(`/feature/${feature.id}`, {
            method: "PUT",
            body: JSON.stringify({
              rules,
            }),
          });
          mutate();
        } catch (e) {
          track("Feature Rule Error", {
            source: ruleAction,
            ruleIndex: i,
            type: values.type,
            hasCondition: values.condition.length > 2,
            hasDescription: values.description.length > 0,
            error: e.message,
          });

          throw e;
        }
      })}
    >
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
      <Field
        {...form.register("type")}
        label="Rule Action"
        options={[
          { display: "Force a specific value", value: "force" },
          { display: "Percentage rollout", value: "rollout" },
          { display: "Experiment", value: "experiment" },
        ]}
      />

      {type === "force" && (
        <FeatureValueField
          label="Value to Force"
          form={form}
          field="value"
          valueType={feature.valueType}
        />
      )}
      {type === "rollout" && (
        <div>
          <FeatureValueField
            label="Value to Rollout"
            form={form}
            field="value"
            valueType={feature.valueType}
          />
          <div className="form-group">
            <label>Percent of Users</label>
            <div className="row align-items-center">
              <div className="col">
                <input
                  {...form.register(`coverage`, {
                    valueAsNumber: true,
                  })}
                  min="0"
                  max="1"
                  step="0.01"
                  type="range"
                  className="w-100"
                />
              </div>
              <div
                className="col-auto"
                style={{ fontSize: "1.3em", width: "4em" }}
              >
                {percentFormatter.format(form.watch("coverage"))}
              </div>
            </div>
          </div>
          <Field
            label="Sample based on attribute"
            {...form.register("hashAttribute")}
            options={settings.attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the feature key to determine if user is part of the rollout"
          />
        </div>
      )}
      {type === "experiment" && (
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
            options={settings.attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the Tracking Key to pick a value"
          />
          <div className="form-group">
            <label>Variations and Weights</label>
            <table className="table table-bordered">
              <thead>
                <tr>
                  <th>Value</th>
                  <th>Percent of Users</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {variations.fields.map((val, i) => {
                  return (
                    <tr key={i}>
                      <td>
                        <FeatureValueField
                          label=""
                          form={form}
                          field={`values.${i}.value`}
                          valueType={feature.valueType}
                        />
                      </td>
                      <td>
                        <Field
                          {...form.register(`values.${i}.weight`, {
                            valueAsNumber: true,
                          })}
                          type="number"
                          min={0}
                          max={1}
                          step="0.01"
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-link text-danger"
                          onClick={(e) => {
                            e.preventDefault();
                            variations.remove(i);
                          }}
                          type="button"
                        >
                          remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button
              className="btn btn-link"
              onClick={(e) => {
                e.preventDefault();
                variations.append({
                  value: getDefaultVariationValue(
                    feature.valueType,
                    feature.defaultValue
                  ),
                  weight: 0,
                });
              }}
              type="button"
            >
              add value
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
