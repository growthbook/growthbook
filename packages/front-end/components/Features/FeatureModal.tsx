import { useForm } from "react-hook-form";
import {
  FeatureInterface,
  FeatureValueType,
} from "../../../back-end/types/feature";
import { useAuth } from "../../services/auth";
import Field from "../Forms/Field";
import MarkdownInput from "../Markdown/MarkdownInput";
import Modal from "../Modal";
import dJSON from "dirty-json";
import Toggle from "../Forms/Toggle";

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
  const form = useForm<Partial<FeatureInterface>>({
    defaultValues: {
      valueType: existing?.valueType || "boolean",
      defaultValue: existing?.defaultValue || "false",
      description: existing?.description || "",
      id: existing?.id || "",
    },
  });
  const { apiCall } = useAuth();

  const valueType = form.watch("valueType");

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
        await onSuccess(res.feature);
      })}
    >
      {!existing && (
        <Field
          label="Feature Key"
          {...form.register("id")}
          pattern="^[a-z0-9_-]+$"
          disabled={!!existing}
          title="Only lowercase letters, numbers, underscores, and hyphens allowed. No spaces"
          helpText="They key you reference in your code. Cannot be changed later."
        />
      )}

      <Field
        label="Description"
        render={(id) => (
          <MarkdownInput
            value={form.watch("description")}
            setValue={(val) => form.setValue("description", val)}
            id={id}
            placeholder="Describe the feature in more detail (optional)"
          />
        )}
      />

      <Field
        label="Value Type"
        {...form.register("valueType")}
        options={[
          {
            display: "on/off",
            value: "boolean",
          },
          "number",
          "string",
          "json",
        ]}
      />

      <Field
        label="Default Value"
        {...form.register("defaultValue")}
        {...(valueType === "boolean"
          ? {
              render: function BooleanToggle(id) {
                return (
                  <div>
                    <Toggle
                      id={id}
                      label=""
                      value={form.watch("defaultValue") !== "false"}
                      setValue={(value) =>
                        form.setValue("defaultValue", value ? "true" : "false")
                      }
                    />
                  </div>
                );
              },
            }
          : valueType === "number"
          ? {
              type: "number",
              step: "any",
              min: "any",
              max: "any",
            }
          : {
              textarea: true,
              minRows: 1,
            })}
        helpText={
          existing
            ? ""
            : "After creating the feature, you will be able to add rules to override this default"
        }
      />
    </Modal>
  );
}
