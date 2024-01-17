import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { WebhookInterface, WebhookMethod } from "back-end/types/webhook";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { isCloud } from "@/services/env";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Field from "../Forms/Field";
import Modal from "../Modal";
import Toggle from "../Forms/Toggle";
import SelectField from "../Forms/SelectField";
import CodeTextArea from "../Forms/CodeTextArea";

const WebhooksModal: FC<{
  close: () => void;
  onSave: () => void;
  defaultDescription?: string;
  current: Partial<WebhookInterface>;
  showSDKMode?: boolean;
  sdkid?: string;
}> = ({ close, onSave, current, showSDKMode, sdkid }) => {
  const { apiCall } = useAuth();
  const [validHeaders, setValidHeaders] = useState(true);
  showSDKMode = showSDKMode || false;
  const methodTypes: WebhookMethod[] = [
    "POST",
    "GET",
    "PUT",
    "DELETE",
    "PURGE",
  ];
  const { projects, project } = useDefinitions();
  const environments = useEnvironments();
  const form = useForm({
    defaultValues: {
      name: current.name || "My Webhook",
      endpoint: current.endpoint || "",
      project: current.project || (current.id ? "" : project),
      environment:
        current.environment === undefined ? "production" : current.environment,
      useSDKMode: current?.useSDKMode || showSDKMode,
      sendPayload: current?.sendPayload,
      httpMethod: current?.httpMethod || "POST",
      headers: current?.headers || "{}",
      sdkid,
    },
  });
  const handleApiCall = async (value) => {
    console.log(JSON.stringify(value));
    if (showSDKMode) {
      await apiCall(current.id ? `/webhook/${current.id}` : "/webhooks/sdk", {
        method: current.id ? "PUT" : "POST",
        body: JSON.stringify(value),
      });
    } else {
      await apiCall(current.id ? `/webhook/${current.id}` : "/webhooks", {
        method: current.id ? "PUT" : "POST",
        body: JSON.stringify(value),
      });
    }
  };

  const onSubmit = form.handleSubmit(async (value) => {
    if (value.endpoint.match(/localhost/g)) {
      throw new Error("Invalid endpoint");
    }
    await handleApiCall(value);
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
  const SDKFilterFields = () => (
    <>
      <Toggle
        id="sendPayload"
        value={!!form.watch("sendPayload")}
        setValue={(value) => {
          console.log(value);
          console.log(!!form.watch("sendPayload"));
          form.setValue("sendPayload", value);
        }}
      />
      <label htmlFor="sendPayload">Send Payload</label>
      <SelectField
        label="Method"
        required
        placeholder="POST"
        value={form.watch("httpMethod")}
        onChange={(httpMethod: WebhookMethod) =>
          form.setValue("httpMethod", httpMethod)
        }
        options={methodTypes.map((e) => ({ label: e, value: e }))}
      />
      {headerJsonEditor()}
    </>
  );
  const validateHeaders = (headers: string) => {
    try {
      JSON.parse(headers);
      setValidHeaders(true);
    } catch (error) {
      setValidHeaders(false);
    }
  };
  const headerJsonEditor = () => (
    <CodeTextArea
      label="Headers"
      language="json"
      value={form.watch("headers")}
      setValue={(headers) => {
        validateHeaders(headers);
        form.setValue("headers", headers);
      }}
      helpText={
        <>
          {!validHeaders ? (
            <div className="alert alert-danger mr-auto">Invalid JSON</div>
          ) : (
            <div>JSON format for headers.</div>
          )}
        </>
      }
    />
  );
  const nonSDKFilterFields = () => (
    <>
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
    </>
  );
  const filterFields = showSDKMode ? SDKFilterFields() : nonSDKFilterFields();

  const updateCtaCopy = showSDKMode ? "Update and Send" : "Update";
  const createCtaCopy = showSDKMode ? "Create and Send" : "Create";

  return (
    <Modal
      close={close}
      header={current.id ? "Update Webhook" : "Create New Webhook"}
      open={true}
      submit={onSubmit}
      ctaEnabled={validHeaders}
      cta={current.id ? updateCtaCopy : createCtaCopy}
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
      {filterFields}
    </Modal>
  );
};

export default WebhooksModal;
