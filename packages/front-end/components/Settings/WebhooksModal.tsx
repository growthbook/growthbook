import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import {
  CreateSdkWebhookProps,
  UpdateSdkWebhookProps,
  WebhookInterface,
  WebhookMethod,
  WebhookPayloadFormat,
} from "back-end/types/webhook";
import { FaExternalLinkAlt } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { isCloud } from "@/services/env";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import { DocLink } from "@/components/DocLink";

const WebhooksModal: FC<{
  close: () => void;
  onSave: () => void;
  defaultDescription?: string;
  current: Partial<WebhookInterface>;
  sdkConnectionId: string;
}> = ({ close, onSave, current, sdkConnectionId }) => {
  const { apiCall } = useAuth();
  const [validHeaders, setValidHeaders] = useState(true);

  const methodTypes: WebhookMethod[] = [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PURGE",
  ];
  const form = useForm({
    defaultValues: {
      name: current.name || "My Webhook",
      endpoint: current.endpoint || "",
      useSdkMode: true,
      payloadFormat: current?.payloadFormat || "standard",
      httpMethod: current?.httpMethod || "POST",
      headers: current?.headers || "{}",
      sdkid: sdkConnectionId,
    },
  });

  const isValidHttp = (urlString: string) => {
    let url: URL;
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

    if (current.id) {
      const data: UpdateSdkWebhookProps = {
        name: value.name,
        endpoint: value.endpoint,
        httpMethod: value.httpMethod,
        headers: value.headers,
        payloadFormat: value.payloadFormat,
      };

      await apiCall(`/sdk-webhooks/${current.id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    } else {
      const data: CreateSdkWebhookProps = {
        name: value.name,
        endpoint: value.endpoint,
        httpMethod: value.httpMethod,
        headers: value.headers,
        payloadFormat: value.payloadFormat,
      };
      await apiCall(`/sdk-connections/${sdkConnectionId}/webhooks`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    }

    track(current.id ? "Edit Webhook" : "Create Webhook");
    onSave();
    close();
  });

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
      minLines={3}
      maxLines={6}
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

  return (
    <Modal
      close={close}
      header={current.id ? "Update Webhook" : "Create New Webhook"}
      open={true}
      submit={onSubmit}
      autoCloseOnSubmit={false}
      ctaEnabled={validHeaders}
      cta={current.id ? "Update" : "Create"}
      size="lg"
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

      <SelectField
        label="Method"
        required
        placeholder="POST"
        value={form.watch("httpMethod")}
        onChange={(httpMethod: WebhookMethod) =>
          form.setValue("httpMethod", httpMethod)
        }
        options={methodTypes.map((e) => ({ label: e, value: e }))}
        sort={false}
      />

      {headerJsonEditor()}

      {form.watch("httpMethod") !== "GET" && (
        <>
          <SelectField
            containerClassName="mb-1"
            label="Payload Format"
            value={form.watch("payloadFormat")}
            onChange={(v: WebhookPayloadFormat) =>
              form.setValue("payloadFormat", v)
            }
            options={[
              { label: "Standard", value: "standard" },
              {
                label: "Standard (no SDK Payload)",
                value: "standard-no-payload",
              },
              { label: "SDK Payload only", value: "sdkPayload" },
              { label: "None", value: "none" },
            ]}
            formatOptionLabel={({ value, label }) => {
              return (
                <span>
                  {label}
                  {value === "standard" && (
                    <span
                      className="text-muted uppercase-title float-right position-relative"
                      style={{ top: 3 }}
                    >
                      default
                    </span>
                  )}
                </span>
              );
            }}
            disabled={form.watch("httpMethod") === "GET"}
            sort={false}
          />
          <div className="small">
            <DocLink docSection="sdkWebhooks#payload-format">
              Learn More <FaExternalLinkAlt />
            </DocLink>
          </div>
        </>
      )}
    </Modal>
  );
};

export default WebhooksModal;
