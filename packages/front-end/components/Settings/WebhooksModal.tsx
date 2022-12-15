import { FC } from "react";
import { useForm } from "react-hook-form";
import { WebhookInterface } from "back-end/types/webhook";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { isCloud } from "@/services/env";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Field from "../Forms/Field";
import Modal from "../Modal";

const WebhooksModal: FC<{
  close: () => void;
  onSave: () => void;
  defaultDescription?: string;
  current: Partial<WebhookInterface>;
}> = ({ close, onSave, current }) => {
  const { apiCall } = useAuth();

  const { projects, project } = useDefinitions();

  const environments = useEnvironments();

  const form = useForm({
    defaultValues: {
      name: current.name || "My Webhook",
      endpoint: current.endpoint || "",
      project: current.project || (current.id ? "" : project),
      environment:
        current.environment === undefined ? "production" : current.environment,
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    if (value.endpoint.match(/localhost/g)) {
      throw new Error("Invalid endpoint");
    }
    await apiCall(current.id ? `/webhook/${current.id}` : "/webhooks", {
      method: current.id ? "PUT" : "POST",
      body: JSON.stringify(value),
    });
    track(current.id ? "Edit Webhook" : "Create Webhook");
    onSave();
  });

  const envOptions = environments.map((e) => ({
    display: e.id,
    value: e.id,
  }));

  // New webhooks must select a single environment
  // Add the option to select both only when required for backwards compatibility
  if (current && current.environment === "") {
    envOptions.push({
      display: "Both dev and production",
      value: "",
    });
  }

  return (
    <Modal
      close={close}
      header={current.id ? "Update Webhook" : "Create New Webhook"}
      open={true}
      submit={onSubmit}
      cta={current.id ? "Update" : "Create"}
    >
      <Field label="Display Name" required {...form.register("name")} />
      <Field
        label="HTTP(S) Endpoint"
        type="url"
        required
        placeholder="https://"
        {...form.register("endpoint")}
        onInvalid={(event) => {
          (event.target as HTMLInputElement).setCustomValidity(
            "Please enter a valid URL, including the http:// or https:// prefix."
          );
        }}
        helpText={
          <>
            Must accept <code>POST</code> requests
            {isCloud() ? (
              <>
                {" "}
                from <code>52.70.79.40</code>
              </>
            ) : (
              ""
            )}
            .
          </>
        }
      />
      {form.watch("endpoint").match(/localhost/) && (
        <div className="alert alert-danger">
          <strong>Error: </strong>Localhost not supported directly. Try using{" "}
          <a
            href="https://www.npmjs.com/package/ngrok"
            target="_blank"
            rel="noreferrer"
          >
            ngrok
          </a>{" "}
          instead.
        </div>
      )}
      <h4>Webhook Filter</h4>
      <Field
        label="Environment"
        options={envOptions}
        {...form.register("environment")}
      />
      {projects.length > 0 && (
        <Field
          label="Project"
          options={projects.map((p) => ({
            display: p.name,
            value: p.id,
          }))}
          initialOption="All Projects"
          {...form.register("project")}
        />
      )}
    </Modal>
  );
};

export default WebhooksModal;
