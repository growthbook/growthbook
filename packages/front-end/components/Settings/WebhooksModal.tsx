import { FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  CreateSdkWebhookProps,
  UpdateSdkWebhookProps,
  WebhookInterface,
  WebhookMethod,
  WebhookPayloadFormat,
} from "back-end/types/webhook";
import { FaExternalLinkAlt } from "react-icons/fa";
import { SDKLanguage } from "shared/types/sdk-connection";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { isCloud } from "@/services/env";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import { DocLink } from "@/components/DocLink";
import { useDefinitions } from "@/services/DefinitionsContext";
import WebhookSecretModal from "@/components/EventWebHooks/WebhookSecretModal";
import Link from "@/ui/Link";

const methodTypes: WebhookMethod[] = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PURGE",
  "PATCH",
];

const webhookTypes = {
  http: "Custom HTTP Endpoint",
  cloudflare: "Cloudflare KV",
  fastly: "Fastly KV",
  vercel: "Vercel Edge Config",
};

type WebhookType = keyof typeof webhookTypes;

interface SdkWebhookInputs {
  name: string;
  accountId: string;
  namespaceId: string;
  key: string;
  webhookSecretKey: string;
  storeId: string;
  edgeConfigId: string;
  teamId: string;
  endpoint: string;
  payloadFormat: WebhookPayloadFormat;
  httpMethod: WebhookMethod;
  headers: string;
}

function getWebhookFromType(
  type: WebhookType,
  inputs: SdkWebhookInputs,
): {
  endpoint: string;
  httpMethod: WebhookMethod;
  headers: string;
  payloadFormat: WebhookPayloadFormat;
  payloadKey?: string;
} {
  switch (type) {
    case "cloudflare":
      return {
        endpoint: `https://api.cloudflare.com/client/v4/accounts/${inputs.accountId}/storage/kv/namespaces/${inputs.namespaceId}/values/${inputs.key}`,
        httpMethod: "PUT",
        headers: JSON.stringify({
          Authorization: `Bearer {{ ${inputs.webhookSecretKey} }}`,
        }),
        payloadFormat: "sdkPayload",
      };
    case "fastly":
      return {
        endpoint: `https://api.fastly.com/resources/stores/kv/${inputs.storeId}/keys/${inputs.key}`,
        httpMethod: "PUT",
        headers: JSON.stringify({
          "Fastly-Key": `{{ ${inputs.webhookSecretKey} }}`,
        }),
        payloadFormat: "sdkPayload",
      };
    case "vercel":
      return {
        endpoint: `https://api.vercel.com/v1/edge-config/${
          inputs.edgeConfigId
        }/items${inputs.teamId ? `?teamId=${inputs.teamId}` : ""}`,
        httpMethod: "PATCH",
        headers: JSON.stringify({
          Authorization: `Bearer {{ ${inputs.webhookSecretKey} }}`,
        }),
        payloadFormat: "edgeConfigUnescaped",
        payloadKey: inputs.key,
      };
    case "http":
      return {
        endpoint: inputs.endpoint,
        httpMethod: inputs.httpMethod,
        headers: inputs.headers,
        payloadFormat: inputs.payloadFormat,
        payloadKey: inputs.key,
      };
  }
}

const isValidHttp = (urlString: string) => {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (e) {
    return false;
  }
  return /https?/.test(url.protocol);
};

export function CreateSDKWebhookModal({
  sdkConnectionId,
  sdkConnectionKey,
  language,
  close,
  onSave,
}: {
  sdkConnectionId: string;
  sdkConnectionKey: string;
  language?: SDKLanguage;
  close: () => void;
  onSave: () => void;
}) {
  const { apiCall } = useAuth();
  const { webhookSecrets } = useDefinitions();
  const [isSecretModalOpen, setIsSecretModalOpen] = useState(false);

  const [webhookType, setWebhookType] = useState<WebhookType | null>(
    language === "edge-cloudflare"
      ? "cloudflare"
      : language === "edge-fastly"
        ? "fastly"
        : "http",
  );

  const [validHeaders, setValidHeaders] = useState(true);
  const validateHeaders = (headers: string) => {
    try {
      JSON.parse(headers);
      setValidHeaders(true);
    } catch (error) {
      setValidHeaders(false);
    }
  };

  const form = useForm<SdkWebhookInputs>({
    defaultValues: {
      name: "My Webhook",
      accountId: "",
      namespaceId: "",
      key: "gb_payload",
      webhookSecretKey: "",
      edgeConfigId: "",
      storeId: "",
      teamId: "",
      endpoint: "",
      payloadFormat: "standard",
      httpMethod: "POST",
      headers: "{}",
    },
  });

  const SelectWebhookSecretField = ({ label }: { label: string }) => {
    return (
      <SelectField
        label={label}
        required
        value={form.watch("webhookSecretKey")}
        onChange={(webhookSecretKey) => {
          form.setValue("webhookSecretKey", webhookSecretKey);
        }}
        options={webhookSecrets.map((s) => ({
          value: s.key,
          label: s.key,
        }))}
        helpText={
          <>
            Please select an existing{" "}
            <DocLink useRadix docSection="webhookSecrets">
              webhook secret
            </DocLink>{" "}
            or{" "}
            <Link onClick={() => setIsSecretModalOpen(true)}>
              create a new one
            </Link>
            .
          </>
        }
      />
    );
  };

  useEffect(() => {
    if (webhookType === "vercel") {
      form.setValue("key", sdkConnectionKey);
    } else {
      form.setValue("key", "gb_payload");
    }
  }, [webhookType, sdkConnectionKey, form]);

  return (
    <>
      {isSecretModalOpen && (
        <WebhookSecretModal
          increasedElevation={true}
          onSuccess={(webhookSecretKey) => {
            form.setValue("webhookSecretKey", webhookSecretKey);
          }}
          close={() => {
            setIsSecretModalOpen(false);
          }}
        />
      )}
      <Modal
        trackingEventModalType=""
        close={close}
        header="Create New SDK Webhook"
        open={true}
        size="lg"
        submit={form.handleSubmit(async (inputs) => {
          if (!webhookType) {
            throw new Error("Please select a Webhook type");
          }

          const data: CreateSdkWebhookProps = {
            ...getWebhookFromType(webhookType, inputs),
            name: inputs.name,
          };

          if (data.endpoint.match(/localhost/g)) {
            throw new Error("Invalid endpoint");
          }
          if (!isValidHttp(data.endpoint)) {
            throw new Error("Invalid URL");
          }

          await apiCall(`/sdk-connections/${sdkConnectionId}/webhooks`, {
            method: "POST",
            body: JSON.stringify(data),
          });

          track("Create Webhook", {
            type: webhookType,
          });
          onSave();
        })}
      >
        <Field label="Display Name" required {...form.register("name")} />

        <SelectField
          label="Webhook Type"
          required
          value={webhookType || ""}
          onChange={(v) => {
            if (v !== webhookType) {
              // When changing types (e.g. Fastly to Cloudflare), clear the selected webhook secret
              form.setValue("webhookSecretKey", "");
            }

            setWebhookType(v as WebhookType);
          }}
          options={Object.entries(webhookTypes).map(([value, label]) => ({
            value,
            label,
          }))}
          sort={false}
        />

        {webhookType === "cloudflare" ? (
          <>
            <Field
              label="Cloudflare Account ID"
              key="cf_account_id"
              required
              {...form.register("accountId")}
            />
            <Field
              label="KV Namespace ID"
              key="cf_namespace_id"
              required
              {...form.register("namespaceId")}
            />
            <Field
              label="Key"
              required
              {...form.register("key")}
              key="cf_payload_key"
            />
            <SelectWebhookSecretField
              label="Cloudflare API Token"
              key="cf_api_token"
            />
          </>
        ) : webhookType === "fastly" ? (
          <>
            <Field
              label="Store ID"
              required
              {...form.register("storeId")}
              key="fastly_store_id"
            />
            <Field
              label="Key"
              required
              {...form.register("key")}
              key="fastly_payload_key"
            />
            <SelectWebhookSecretField
              label="Fastly API Token"
              key="fastly_api_token"
            />
          </>
        ) : webhookType === "vercel" ? (
          <>
            <Field
              label="Vercel Edge Config ID"
              required
              {...form.register("edgeConfigId")}
              key="vercel_edge_config_id"
            />
            <Field
              label="Item Key"
              required
              {...form.register("key")}
              key="vercel_payload_key"
            />
            <Field
              label="Team ID (optional)"
              {...form.register("teamId")}
              key="vercel_team_id"
            />
            <SelectWebhookSecretField
              label="Vercel API Token"
              key="vercel_api_token"
            />
          </>
        ) : webhookType === "http" ? (
          <>
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
                  . Supports{" "}
                  <DocLink docSection="webhookSecrets">Webhook Secrets</DocLink>
                  .
                </>
              }
              key="http_endpoint_url"
            />
            {form.watch("endpoint").match(/localhost/) && (
              <div className="alert alert-danger">
                <strong>Error: </strong>Localhost not supported directly. Try
                using{" "}
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
              key="http_method"
            />

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
                    <div className="alert alert-danger mr-auto">
                      Invalid JSON
                    </div>
                  ) : (
                    <div>
                      JSON format for headers. Supports{" "}
                      <DocLink docSection="webhookSecrets">
                        Webhook Secrets
                      </DocLink>
                      .
                    </div>
                  )}
                </>
              }
              key="http_headers"
            />

            {form.watch("httpMethod") !== "GET" && (
              <>
                <SelectField
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
                    {
                      label: "Vercel Edge Config",
                      value: "edgeConfigUnescaped",
                    },
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
                  helpText={
                    <DocLink docSection="sdkWebhooks#payload-format">
                      Learn More <FaExternalLinkAlt />
                    </DocLink>
                  }
                  key="http_payload_format"
                />

                {(form.watch("payloadFormat") === "edgeConfig" ||
                  form.watch("payloadFormat") === "edgeConfigUnescaped") && (
                  <Field
                    label="Edge Config Key"
                    placeholder="gb_payload"
                    {...form.register("key")}
                    helpText={
                      <>
                        The name of the key you want to update within your Edge
                        Config. Defaults to <code>gb_payload</code>.
                      </>
                    }
                    key="http_payload_key"
                  />
                )}
              </>
            )}
          </>
        ) : null}
      </Modal>
    </>
  );
}

const EditSDKWebhooksModal: FC<{
  close: () => void;
  onSave: () => void;
  current: Partial<WebhookInterface>;
  sdkConnectionId: string;
}> = ({ close, onSave, current, sdkConnectionId }) => {
  const { apiCall } = useAuth();
  const [validHeaders, setValidHeaders] = useState(true);

  const form = useForm({
    defaultValues: {
      name: current.name || "My Webhook",
      endpoint: current.endpoint || "",
      useSdkMode: true,
      payloadFormat: current?.payloadFormat || "standard",
      payloadKey: current?.payloadKey || "",
      httpMethod: current?.httpMethod || "POST",
      headers: current?.headers || "{}",
      sdkid: sdkConnectionId,
    },
  });

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
        payloadKey: value.payloadKey,
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
        payloadKey: value.payloadKey,
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
      trackingEventModalType=""
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
              { label: "Vercel Edge Config", value: "edgeConfigUnescaped" },
              // Only show the old stringified format if it's already selected
              ...(current?.payloadFormat === "edgeConfig"
                ? [
                    {
                      label: "Vercel Edge Config (escaped payload)",
                      value: "edgeConfig",
                    },
                  ]
                : []),
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
            helpText={
              <DocLink docSection="sdkWebhooks#payload-format">
                Learn More <FaExternalLinkAlt />
              </DocLink>
            }
          />

          {(form.watch("payloadFormat") === "edgeConfig" ||
            form.watch("payloadFormat") === "edgeConfigUnescaped") && (
            <Field
              label="Edge Config Key"
              placeholder="gb_payload"
              {...form.register("payloadKey")}
              helpText={
                <>
                  The name of the key you want to update within your Edge
                  Config. Defaults to <code>gb_payload</code>.
                </>
              }
            />
          )}
        </>
      )}
    </Modal>
  );
};

export default EditSDKWebhooksModal;
