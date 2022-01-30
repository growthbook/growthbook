import { useForm } from "react-hook-form";
import { FeatureInterface, FeatureValueType } from "back-end/types/feature";
import { useAuth } from "../../services/auth";
import Field from "../Forms/Field";
import Modal from "../Modal";
import dJSON from "dirty-json";
import FeatureValueField from "./FeatureValueField";
import { useDefinitions } from "../../services/DefinitionsContext";
import track from "../../services/track";
import Toggle from "../Forms/Toggle";
import uniq from "lodash/uniq";
import RadioSelector from "../Forms/RadioSelector";
import ConditionInput from "./ConditionInput";
import useOrgSettings from "../../hooks/useOrgSettings";

export type Props = {
  close: () => void;
  onSuccess: (feature: FeatureInterface) => Promise<void>;
  existing?: FeatureInterface;
};

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function parseDefaultValue(
  defaultValue: string,
  valueType: FeatureValueType
): string {
  if (valueType === "boolean") {
    return defaultValue === "true" ? "true" : "false";
  }
  if (valueType === "number") {
    return parseFloat(defaultValue) + "";
  }
  if (valueType === "string") {
    return defaultValue;
  }
  try {
    return JSON.stringify(dJSON.parse(defaultValue), null, 2);
  } catch (e) {
    throw new Error(`JSON parse error for default value`);
  }
}

export default function FeatureModal({ close, existing, onSuccess }: Props) {
  const { project } = useDefinitions();
  const form = useForm<Partial<FeatureInterface>>({
    defaultValues: {
      valueType: existing?.valueType || "boolean",
      defaultValue: existing?.defaultValue ?? "true",
      description: existing?.description || "",
      id: existing?.id || "",
      project: existing?.project ?? project,
      environments: ["dev"],
      rules: [],
    },
  });
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const firstAttr = settings?.attributeSchema?.[0];
  const hasHashAttributes =
    settings?.attributeSchema?.filter((x) => x.hashAttribute)?.length > 0;

  const valueType = form.watch("valueType");
  const environments = form.watch("environments");

  const rules = form.watch("rules");
  const rule = rules?.[0];

  return (
    <Modal
      open={true}
      size="lg"
      header="Create Feature"
      close={close}
      submit={form.handleSubmit(async (values) => {
        const body = {
          ...values,
          defaultValue: parseDefaultValue(
            values.defaultValue,
            values.valueType
          ),
        };

        if (existing) {
          delete body.id;
        } else {
          body.rules = [];
        }

        const res = await apiCall<{ feature: FeatureInterface }>(
          existing ? `/feature/${existing.id}` : `/feature`,
          {
            method: existing ? "PUT" : "POST",
            body: JSON.stringify(body),
          }
        );

        if (!existing) {
          track("Feature Created", {
            valueType: values.valueType,
            hasDescription: values.description.length > 0,
          });
        }

        await onSuccess(res.feature);
      })}
    >
      {!existing && (
        <Field
          label="Feature Key"
          {...form.register("id")}
          pattern="^[a-zA-Z0-9_.:|-]+$"
          required
          disabled={!!existing}
          title="Only letters, numbers, and the characters '_-.:|' allowed. No spaces."
          helpText={
            <>
              Only letters, numbers, and the characters <code>_-.:|</code>{" "}
              allowed. No spaces. <strong>Cannot be changed later!</strong>
            </>
          }
        />
      )}

      <label>Enabled Environments</label>
      <div className="row">
        <div className="col-auto">
          <div className="form-group mb-0">
            <label htmlFor={"dev_toggle_create"} className="mr-2 ml-3">
              Dev:
            </label>
            <Toggle
              id={"dev_toggle_create"}
              label="Dev"
              value={environments.includes("dev") ?? false}
              setValue={(on) => {
                let envs = [...environments];
                if (on) envs.push("dev");
                else envs = envs.filter((e) => e !== "dev");
                form.setValue("environments", uniq(envs));
              }}
            />
          </div>
        </div>
        <div className="col-auto">
          <div className="form-group mb-0">
            <label htmlFor={"production_toggle_create"} className="mr-2">
              Production:
            </label>
            <Toggle
              id={"production_toggle_create"}
              label="Production"
              value={environments.includes("production") ?? false}
              setValue={(on) => {
                let envs = [...environments];
                if (on) envs.push("production");
                else envs = envs.filter((e) => e !== "production");
                form.setValue("environments", uniq(envs));
              }}
            />
          </div>
        </div>
      </div>

      <hr />
      <h5>When Enabled</h5>

      <Field
        label="Value Type"
        {...form.register("valueType")}
        options={[
          {
            display: "boolean (on/off)",
            value: "boolean",
          },
          "number",
          "string",
          "json",
        ]}
      />

      <div className="form-group">
        <label>
          Behavior <small className="text-muted">(can change later)</small>
        </label>
        <RadioSelector
          name="ruleType"
          value={rules?.[0]?.type || ""}
          labelWidth={145}
          options={[
            {
              key: "",
              display: "Simple",
              description: "All users get the same value",
            },
            {
              key: "force",
              display: "Targeted",
              description:
                "Most users get one value, a targeted segment gets another",
            },
            {
              key: "rollout",
              display: "Percentage Rollout",
              description:
                "Gradually release a value to users while everyone else gets a fallback",
            },
            {
              key: "experiment",
              display: "A/B Experiment",
              description: "Run an A/B test between multiple values.",
            },
          ]}
          setValue={(value) => {
            if (!value) {
              form.setValue("rules", []);
              form.setValue(
                "defaultValue",
                valueType === "boolean" ? "true" : ""
              );
            } else if (value === "force") {
              form.setValue("rules", [
                {
                  id: "",
                  type: "force",
                  description: "",
                  value: valueType === "boolean" ? "true" : "",
                  condition: firstAttr
                    ? JSON.stringify({
                        [firstAttr.property]:
                          firstAttr.datatype === "boolean" ? "true" : "",
                      })
                    : "",
                },
              ]);
              form.setValue(
                "defaultValue",
                valueType === "boolean" ? "false" : ""
              );
            } else if (value === "rollout") {
              form.setValue("rules", [
                {
                  id: "",
                  type: "rollout",
                  description: "",
                  value: valueType === "boolean" ? "true" : "",
                  coverage: 0.5,
                  hashAttribute: "id",
                  condition: "",
                },
              ]);
              form.setValue(
                "defaultValue",
                valueType === "boolean" ? "false" : ""
              );
            } else if (value === "experiment") {
              form.setValue("rules", [
                {
                  id: "",
                  type: "experiment",
                  description: "",
                  hashAttribute: "id",
                  trackingKey: "",
                  values: [
                    {
                      value: valueType === "boolean" ? "false" : "",
                      weight: 0.5,
                    },
                    {
                      value: valueType === "boolean" ? "true" : "",
                      weight: 0.5,
                    },
                  ],
                  condition: "",
                },
              ]);
            }
          }}
        />
      </div>

      {!rule ? (
        <FeatureValueField
          label={"Value"}
          form={form}
          field="defaultValue"
          valueType={valueType}
        />
      ) : rule?.type === "rollout" ? (
        <>
          <Field
            label="Sample users based on attribute"
            {...form.register("rules.0.hashAttribute")}
            options={settings.attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the feature key to determine if user is part of the rollout"
          />
          <div className="form-group">
            <label>Percent of users to include</label>
            <div className="row align-items-center">
              <div className="col">
                <input
                  {...form.register(`rules.0.coverage`, {
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
                {percentFormatter.format(rule?.coverage)}
              </div>
            </div>
          </div>
          <FeatureValueField
            label={"Value when included"}
            form={form}
            field="rules.0.value"
            valueType={valueType}
          />
          <FeatureValueField
            label={"Fallback value"}
            form={form}
            field="defaultValue"
            valueType={valueType}
          />
        </>
      ) : rule?.type === "force" ? (
        <>
          <ConditionInput
            defaultValue={rule?.condition}
            onChange={(cond) => {
              form.setValue("rules.0.condition", cond);
            }}
          />
          <FeatureValueField
            label={"Value When Targeted"}
            form={form}
            field="rules.0.value"
            valueType={valueType}
          />
          <FeatureValueField
            label={"Fallback Value"}
            form={form}
            field="defaultValue"
            valueType={valueType}
          />
        </>
      ) : (
        <>
          <Field
            label="Tracking Key"
            {...form.register(`rules.0.trackingKey`)}
            placeholder={form.watch("id")}
            helpText="Unique identifier for this experiment, used to track impressions and analyze results"
          />
          <Field
            label="Assign variation based on attribute"
            {...form.register("rules.0.hashAttribute")}
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
                  <th>Variation</th>
                  <th>Percent of Users</th>
                  {rule.values.length > 2 && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rule.values.map((val, i) => {
                  return (
                    <tr key={i}>
                      <td>
                        <FeatureValueField
                          label=""
                          form={form}
                          field={`rules.0.values.${i}.value`}
                          valueType={valueType}
                        />
                      </td>
                      <td>
                        <Field
                          {...form.register(`rules.0.values.${i}.weight`, {
                            valueAsNumber: true,
                          })}
                          type="number"
                          min={0}
                          max={1}
                          step="0.01"
                        />
                      </td>
                      {rule.values.length > 2 && (
                        <td style={{ width: 100 }}>
                          <button
                            className="btn btn-link text-danger"
                            onClick={(e) => {
                              e.preventDefault();
                              form.setValue(
                                `rules.0.values`,
                                rule.values.filter((_, j) => j !== i)
                              );
                            }}
                            type="button"
                          >
                            remove
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {valueType !== "boolean" && (
                  <tr>
                    <td colSpan={3}>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          form.setValue(`rules.0.values`, [
                            ...rule.values,
                            {
                              value: "",
                              weight: 0,
                            },
                          ]);
                        }}
                      >
                        add another variation
                      </a>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
