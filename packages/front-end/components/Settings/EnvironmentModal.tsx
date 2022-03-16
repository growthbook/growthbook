import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";
import { Environment } from "back-end/types/organization";
import Toggle from "../Forms/Toggle";
import { useState } from "react";

export default function EnvironmentModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<Environment>;
  close: () => void;
  onSuccess: () => void;
}) {
  const [autoUpdateId, setAutoUpdateId] = useState(!existing.id);
  const form = useForm<Partial<Environment>>({
    defaultValues: {
      name: existing.name || "",
      id: existing.id || "",
      description: existing.description || "",
      toggleOnList: existing.toggleOnList || false,
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      open={true}
      close={close}
      header={existing.id ? "Edit Environment" : "Create New Environment"}
      submit={form.handleSubmit(async (value) => {
        await apiCall(
          existing.id ? `/environment/${existing.id}` : `/environment`,
          {
            method: existing.id ? "PUT" : "POST",
            body: JSON.stringify(value),
          }
        );
        await onSuccess();
      })}
    >
      <Field
        name="Name"
        maxLength={30}
        required
        {...form.register("name")}
        onChange={(e) => {
          if (autoUpdateId) {
            const defaultValue = e.target.value
              .replace(/[^a-zA-Z0-9_-]/g, "")
              .toLowerCase();
            form.setValue("id", defaultValue);
          }
        }}
        label="Environment Name"
      />
      <Field
        name="Id"
        maxLength={30}
        onFocus={() => {
          setAutoUpdateId(false);
        }}
        required
        pattern="^[a-zA-Z0-9_.:|-]+$"
        {...form.register("id")}
        label="Id"
        helpText="Used to reference this environment internally. No spaces or special characters"
      />
      <Field
        label="Description"
        {...form.register("description")}
        placeholder=""
        textarea
      />
      <Toggle
        id={"toggle"}
        label="Identifier"
        value={!!form.watch("toggleOnList")}
        setValue={(value) => {
          form.setValue("toggleOnList", value);
        }}
      />{" "}
      <label>Show toggle on feature list </label>
    </Modal>
  );
}
