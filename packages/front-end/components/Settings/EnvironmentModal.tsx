import { useForm } from "react-hook-form";
import { Environment } from "back-end/types/organization";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import Modal from "../Modal";
import Field from "../Forms/Field";
import Toggle from "../Forms/Toggle";

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
      defaultState: existing.defaultState ?? true,
    },
  });
  const { apiCall } = useAuth();
  const environments = useEnvironments();
  const { refreshOrganization } = useUser();

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

        if (existing.id) {
          const env = newEnvs.filter((e) => e.id === existing.id)[0];
          if (!env) throw new Error("Could not edit environment");
          env.description = value.description;
          env.toggleOnList = value.toggleOnList;
          env.defaultState = value.defaultState;
        } else {
          if (!value.id.match(/^[A-Za-z][A-Za-z0-9_-]*$/)) {
            throw new Error(
              "Environment id is invalid. Must start with a letter and can only contain letters, numbers, hyphens, and underscores."
            );
          }
          if (newEnvs.find((e) => e.id === value.id)) {
            throw new Error("Environment id is already in use");
          }
          newEnvs.push({
            id: value.id.toLowerCase(),
            description: value.description,
            toggleOnList: value.toggleOnList,
            defaultState: value.defaultState,
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
        await refreshOrganization();

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
      {!existing.id && (
        <Field
          name="Environment"
          maxLength={30}
          required
          pattern="^[A-Za-z][A-Za-z0-9_-]*$"
          title="Must start with a letter. Can only contain letters, numbers, hyphens, and underscores. No spaces or special characters."
          {...form.register("id")}
          label="Id"
          helpText={
            <>
              Only letters, numbers, hyphens, and underscores allowed. No
              spaces. Valid examples: <code>prod</code>, <code>qa-1</code>,{" "}
              <code>john_dev</code>
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
      <div className="mb-3">
        <Toggle
          id={"defaultToggle"}
          label="Identifier"
          value={!!form.watch("defaultState")}
          setValue={(value) => {
            form.setValue("defaultState", value);
          }}
        />{" "}
        <label htmlFor="defaultToggle">Default state for new features</label>
      </div>
      <Toggle
        id={"toggle"}
        label="Identifier"
        value={!!form.watch("toggleOnList")}
        setValue={(value) => {
          form.setValue("toggleOnList", value);
        }}
      />{" "}
      <label htmlFor="toggle">Show toggle on feature list </label>
      {!existing.id && (
        <div>
          <small className="d-inline-block text-muted mt-3 mb-0">
            Each new environment key will have an API key automatically
            generated for it
          </small>
        </div>
      )}
    </Modal>
  );
}
