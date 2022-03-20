import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";
import { Environment } from "back-end/types/organization";
import Toggle from "../Forms/Toggle";
import { useEnvironments } from "../../hooks/useEnvironments";
import useUser from "../../hooks/useUser";

export default function EnvironmentModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<Environment>;
  close: () => void;
  onSuccess: () => void;
}) {
  const form = useForm<Partial<Environment>>({
    defaultValues: {
      id: existing.id || "",
      description: existing.description || "",
      toggleOnList: existing.toggleOnList || false,
    },
  });
  const { apiCall } = useAuth();
  const environments = useEnvironments();
  const { update } = useUser();

  return (
    <Modal
      open={true}
      close={close}
      header={
        existing.id
          ? `Edit ${existing.id} Environment`
          : "Create New Environment"
      }
      submit={form.handleSubmit(async (value) => {
        const newEnvs = [...environments];

        if (existing) {
          const env = newEnvs.filter((e) => e.id === existing.id)[0];
          if (!env) throw new Error("Could not edit environment");
          env.description = value.description;
          env.toggleOnList = value.toggleOnList;
        } else {
          newEnvs.push({
            id: value.id.toLowerCase().replace(/^[^a-z]*/g, ""),
            description: value.description,
            toggleOnList: value.toggleOnList,
          });
        }

        // Add/edit environment
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings: {
              environments: newEnvs,
            },
          }),
        });

        // Update environments list in UI
        await update();

        // Create API key for environment if it doesn't exist yet
        await apiCall(`/keys?preferExisting=true`, {
          method: "POST",
          body: JSON.stringify({
            description: `${value.id} SDK Key`,
            environment: value.id,
          }),
        });

        await onSuccess();
      })}
    >
      {!existing && (
        <Field
          name="Environment"
          maxLength={30}
          required
          pattern="^[A-Za-z]+$"
          {...form.register("id")}
          label="Id"
          helpText={
            <>
              No numbers, spaces, or special characters. Examples:{" "}
              <code>dev</code>, <code>staging</code>, <code>production</code>
            </>
          }
        />
      )}
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
