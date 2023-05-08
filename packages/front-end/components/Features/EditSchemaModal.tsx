import { useForm } from "react-hook-form";
import { FeatureInterface } from "back-end/types/feature";
import React from "react";
import Ajv from "ajv";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import Modal from "../Modal";

export interface Props {
  feature: FeatureInterface;
  close: () => void;
  mutate: () => void;
}

export default function EditSchemaModal({ feature, close, mutate }: Props) {
  const form = useForm({
    defaultValues: {
      schema: feature?.schema?.schema || "{}",
      enabled: feature?.schema?.enabled ?? true,
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      header="Edit JSON Schema"
      cta="Save"
      submit={form.handleSubmit(async (value) => {
        // make sure the json schema is valid json schema
        try {
          const schema = JSON.parse(value.schema);
          if (!schema || typeof schema !== "object") {
            throw new Error("Invalid JSON Schema");
          }
          const ajv = new Ajv();
          ajv.compile(schema);
        } catch (e) {
          throw new Error(
            `The JSON Schema is invalid. Please check it and try again. Validator error: "${e.message}"`
          );
        }

        await apiCall(`/feature/${feature.id}/schema`, {
          method: "POST",
          body: JSON.stringify({
            schema: value.schema,
            enabled: value.enabled,
          }),
        });
        mutate();
      })}
      close={close}
      open={true}
    >
      <Field
        label={`JSON Schema`}
        value={form.watch("schema")}
        onChange={(e) => {
          form.setValue("schema", e.target.value);
        }}
        textarea={true}
        minRows={20}
        helpText={`Enter a JSON Schema for this feature's value. See https://json-schema.org/ for more information.`}
      />
      <label htmlFor="schemaEnabled">Validate values with this schema</label>{" "}
      <Toggle
        id={"schemaEnabled"}
        value={form.watch("enabled")}
        setValue={(v) => form.setValue("enabled", v)}
      />
    </Modal>
  );
}
