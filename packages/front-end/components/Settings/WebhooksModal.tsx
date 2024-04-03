import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { WebhookInterface, WebhookMethod } from "back-end/types/webhook";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { isCloud } from "@/services/env";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import Toggle from "@/components/Forms/Toggle";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";

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
      useSdkMode: current?.useSdkMode || showSDKMode,
      sendPayload: current?.sendPayload,
      httpMethod: current?.httpMethod || "POST",
      headers: current?.headers || "{}",
      sdkid,
    },
  });

  const handleApiCall = async (value) => {
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

  const isValidHttp = (urlString: string) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (e) {
      return false;
    }
    return /https?/.test(url.protocol);
  };

  const onSubmit = form.handleSubmit(async (value) => {
    if (value.endpoint.match(/localhost/g)) {
      throw new Error("Invalid endpoint");
    }
    if (!isValidHttp(value.endpoint)) {
      throw new Error("Invalid URL");
    }
    await handleApiCall(value);
    track(current.id ? "Edit Webhook" : "Create Webhook");
    onSave();
    close();
  });

  const envOptions = environments.map((e) => ({
    label: e.id,
    value: e.id,
  }));

  // New webhooks must select a single environment
  // Add the option to select both only when required for backwards compatibility
  if (current && current.environment === "") {
    envOptions.push({
      label: "Both dev and production",
      value: "",
    });
  }
  const SDKFilterFields = () => (
    <>
      <Toggle
        id="sendPayload"
        value={!!form.watch("sendPayload")}
        setValue={(value) => {
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
      <SelectField
        label="Environment"
        value={form.watch("environment")}
        onChange={(environment) => form.setValue("environment", environment)}
        options={envOptions}
      />
      {projects.length > 0 && (
        <SelectField
          label="project"
          options={projects.map((p) => ({
            label: p.name,
            value: p.id,
          }))}
          initialOption="All Projects"
          value={form.watch("project")}
          onChange={(project) => form.setValue("project", project)}
        />
      )}
    </>
  );
  const filterFields = showSDKMode ? SDKFilterFields() : nonSDKFilterFields();

  return (
    <Modal
      close={close}
      header={current.id ? "Update Webhook" : "Create New Webhook"}
      open={true}
      submit={onSubmit}
      autoCloseOnSubmit={false}
      ctaEnabled={validHeaders}
      cta={current.id ? "Update" : "Create"}
    >
      <Field label="Display Name" required {...form.register("name")} />
      <Field
        label="Endpoint URL"
        placeholder="https://example.com"
        {...form.register("endpoint")}
        helpText={
          <>
            Must accept <code>{form.watch("httpMethod")}</code> requests
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
