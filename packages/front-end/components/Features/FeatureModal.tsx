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

export type Props = {
  close: () => void;
  onSuccess: (feature: FeatureInterface) => Promise<void>;
  existing?: FeatureInterface;
};

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
    },
  });
  const { apiCall } = useAuth();

  const valueType = form.watch("valueType");
  const environments = form.watch("environments");

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

      <div className="row mb-2">
        <div className="col-auto">
          <div className="form-group">
            <label htmlFor={"dev_toggle_create"}>Dev</label>
            <div>
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
        </div>
        <div className="col-auto">
          <div className="form-group">
            <label htmlFor={"production_toggle_create"}>Production</label>
            <div>
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
      </div>

      <FeatureValueField
        label="Value When Enabled"
        form={form}
        field="defaultValue"
        valueType={valueType}
        helpText={
          existing
            ? ""
            : "After creating the feature, you will be able to add rules to override this default"
        }
      />
    </Modal>
  );
}
