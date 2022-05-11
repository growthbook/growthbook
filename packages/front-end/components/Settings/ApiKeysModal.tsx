import { FC } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import track from "../../services/track";
import Field from "../Forms/Field";
import { useEnvironments } from "../../services/features";
import Toggle from "../Forms/Toggle";
import { ApiKeyInterface } from "back-end/types/apikey";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
  existing?: ApiKeyInterface;
}> = ({ close, onCreate, defaultDescription = "", existing }) => {
  const { apiCall } = useAuth();
  const environments = useEnvironments();

  const form = useForm({
    defaultValues: {
      description: existing ? existing.description : defaultDescription,
      environment: existing
        ? existing.environment || "production"
        : environments[0]?.id || "dev",
      includeDrafts: existing?.includeDrafts || false,
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    if (existing) {
      await apiCall(`/key/${existing.key}`, {
        method: "PUT",
        body: JSON.stringify(value),
      });
      track("Edit API Key", {
        environment: value.environment,
        includeDrafts: value.includeDrafts,
      });
    } else {
      await apiCall("/keys", {
        method: "POST",
        body: JSON.stringify(value),
      });
      track("Create API Key", {
        environment: value.environment,
        includeDrafts: value.includeDrafts,
      });
    }

    onCreate();
  });

  return (
    <Modal
      close={close}
      header={existing ? "Edit Api Key" : "Create New Key"}
      open={true}
      submit={onSubmit}
      cta={existing ? "Save" : "Create"}
    >
      {existing && (
        <Field label="Api Key" value={existing.key} disabled readOnly />
      )}
      <Field
        label="Environment"
        options={environments.map((e) => {
          return {
            value: e.id,
            display: e.id,
          };
        })}
        disabled={!!existing}
        {...form.register("environment")}
      />
      <Field
        label="Description (optional)"
        textarea
        {...form.register("description")}
      />
      <div>
        <Toggle
          id="apiKeyDrafts"
          value={form.watch("includeDrafts")}
          setValue={(includeDrafts) => {
            form.setValue("includeDrafts", includeDrafts);
          }}
        />
        <label htmlFor="apiKeyDrafts">
          Include unpublished feature changes
        </label>
      </div>
    </Modal>
  );
};

export default ApiKeysModal;
