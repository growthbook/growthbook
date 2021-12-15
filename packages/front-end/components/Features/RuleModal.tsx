import { useFieldArray, useForm } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureValueField from "./FeatureValueField";
import { useAuth } from "../../services/auth";
import ConditionInput from "./ConditionInput";
import { useContext } from "react";
import { UserContext } from "../ProtectedPage";

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
    values: [],
    hashAttribute: "id",
    trackingKey: "",
    variations: [
      {
        weight: 0.5,
        value: feature.defaultValue,
      },
      {
        weight: 0.5,
        value: feature.defaultValue,
      },
    ],
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
