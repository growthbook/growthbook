import { useFieldArray, useForm } from "react-hook-form";
import {
  FeatureInterface,
  FeatureRule,
  ForceRule,
  RolloutRule,
} from "back-end/types/feature";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureValueField from "./FeatureValueField";
import { useAuth } from "../../services/auth";
import ConditionInput from "./ConditionInput";
import { useContext } from "react";
import { UserContext } from "../ProtectedPage";
import { isValidValue } from "../../services/features";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  mutate: () => void;
  i: number;
}

export default function RuleModal({ close, feature, i, mutate }: Props) {
  const defaultValues = {
    condition: "",
    description: "",
    enabled: true,
    type: "force",
    value: feature.defaultValue,
    values: [
      {
        weight: 0.5,
        value: feature.defaultValue,
      },
      {
        weight: 0.5,
        value: feature.defaultValue,
      },
    ],
    hashAttribute: "id",
    trackingKey: "",
    ...((feature?.rules?.[i] as FeatureRule) || {}),
  };
  const form = useForm({
    defaultValues,
  });

  const rollout = useFieldArray({ name: "values", control: form.control });

  const { apiCall } = useAuth();

  const { settings } = useContext(UserContext);

  const type = form.watch("type");

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      header={feature.rules[i] ? "Edit Override Rule" : "New Override Rule"}
      submit={form.handleSubmit(async (values) => {
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
        } else {
          const ruleValues = (rules[i] as RolloutRule).values;
          if (!ruleValues || !ruleValues.length) {
            throw new Error("Must set at least one value");
          }
          let totalWeight = 0;
          ruleValues.forEach((val, i) => {
            if (val.weight < 0) throw new Error("Percents cannot be negative");
            totalWeight += val.weight;
            isValidValue(feature.valueType, val.value, "Value #" + (i + 1));
          });
          if (totalWeight > 1) {
            throw new Error(
              `Sum of weights cannot be greater than 1 (currently equals ${totalWeight})`
            );
          }
        }

        await apiCall(`/feature/${feature.id}`, {
          method: "PUT",
          body: JSON.stringify({
            rules,
          }),
        });
        mutate();
      })}
    >
      <Field
        label="Description"
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
          <Field
            label="Tracking Key"
            {...form.register(`trackingKey`)}
            helpText="Unique identifier for this rollout, used to track impressions and analyze results"
          />
          <Field
            label="Assign value based on attribute"
            {...form.register("hashAttribute")}
            options={settings.attributeSchema.map((s) => s.property)}
            helpText="Will be hashed together with the Tracking Key to pick a value"
          />
          <div className="form-group">
            <label>Rollout Values and Weights</label>
            <table className="table table-bordered">
              <thead>
                <tr>
                  <th>Value</th>
                  <th>Rollout Percent</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rollout.fields.map((val, i) => {
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
                            rollout.remove(i);
                          }}
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
                rollout.append({
                  value: feature.defaultValue,
                  weight: 0,
                });
              }}
            >
              add value
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
