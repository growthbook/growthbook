import { FC, ReactNode, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  CreateSdkWebhookProps,
  UpdateSdkWebhookProps,
  WebhookInterface,
  WebhookMethod,
  WebhookPayloadFormat,
} from "shared/types/webhook";
import { SDKLanguage } from "shared/types/sdk-connection";
import { CLOUD_EGRESS_IP } from "shared/constants";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { isCloud } from "@/services/env";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import { DocLink } from "@/components/DocLink";
import { useDefinitions } from "@/services/DefinitionsContext";
import WebhookSecretModal from "@/components/EventWebHooks/WebhookSecretModal";
import {
  timeoutError,
  timeoutSecondsFromInput,
} from "@/components/EventWebHooks/utils";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";

// The modal spaces its fields; theirs would double it.
const NO_MARGIN = { marginBottom: 0 };

const methodTypes: WebhookMethod[] = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PURGE",
  "PATCH",
];

const webhookTypes = {
  http: "Custom HTTP endpoint",
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
  timeoutSeconds: number | null;
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
          Authorization: `Bearer {{[${inputs.webhookSecretKey}]}}`,
        }),
        payloadFormat: "sdkPayload",
      };
    case "fastly":
      return {
        endpoint: `https://api.fastly.com/resources/stores/kv/${inputs.storeId}/keys/${inputs.key}`,
        httpMethod: "PUT",
        headers: JSON.stringify({
          "Fastly-Key": `{{[${inputs.webhookSecretKey}]}}`,
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
          Authorization: `Bearer {{[${inputs.webhookSecretKey}]}}`,
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
  onOverrideCreate,
  destination,
  cta,
}: {
  sdkConnectionId: string;
  sdkConnectionKey: string;
  language?: SDKLanguage;
  close: () => void;
  onSave: () => void;
  onOverrideCreate?: (data: CreateSdkWebhookProps) => Promise<void>;
  // Where the change lands, chosen above the fields.
  destination?: ReactNode;
  cta?: string;
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
      timeoutSeconds: null,
    },
  });

  const renderWebhookSecretField = (label: string, key: string) => (
    <Box key={key}>
      <SelectField
        label={label}
        required
        placeholder="Select..."
        containerStyle={NO_MARGIN}
        value={form.watch("webhookSecretKey")}
        onChange={(webhookSecretKey) => {
          form.setValue("webhookSecretKey", webhookSecretKey);
        }}
        options={webhookSecrets.map((s) => ({ label: s.key, value: s.key }))}
        helpText={
          <>
            Please select an existing{" "}
            <DocLink docSection="webhookSecrets">webhook secret</DocLink> or{" "}
            <Link onClick={() => setIsSecretModalOpen(true)}>
              create a new one
            </Link>
            .
          </>
        }
      />
    </Box>
  );

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
          onSuccess={(webhookSecretKey) => {
            form.setValue("webhookSecretKey", webhookSecretKey);
          }}
          close={() => {
            setIsSecretModalOpen(false);
          }}
        />
      )}
      <ModalStandard
        trackingEventModalType=""
        close={close}
        header="Create SDK Webhook"
        open={true}
        size="lg"
        cta={cta}
        ctaEnabled={!timeoutError(form.watch("timeoutSeconds"))}
        submit={validatedSubmit(form, async (inputs) => {
          if (!webhookType) {
            throw new Error("Please select a Webhook type");
          }

          if (webhookType !== "http" && !inputs.webhookSecretKey) {
            throw new Error("Please select a webhook secret");
          }

          if (timeoutError(inputs.timeoutSeconds)) {
            throw new Error(timeoutError(inputs.timeoutSeconds));
          }

          const data: CreateSdkWebhookProps = {
            ...getWebhookFromType(webhookType, inputs),
            name: inputs.name,
            timeoutSeconds: inputs.timeoutSeconds,
          };

          if (data.endpoint.match(/localhost/g)) {
            throw new Error("Invalid endpoint");
          }
          if (!isValidHttp(data.endpoint)) {
            throw new Error("Invalid URL");
          }

          if (onOverrideCreate) {
            await onOverrideCreate(data);
          } else {
            await apiCall(`/sdk-connections/${sdkConnectionId}/webhooks`, {
              method: "POST",
              body: JSON.stringify(data),
            });
          }

          track("Create Webhook", {
            type: webhookType,
          });
          onSave();
        })}
      >
        <Flex direction="column" gap="4">
          {destination}
          <Field
            containerStyle={NO_MARGIN}
            label="Display name"
            required
            {...form.register("name")}
          />

          <SelectField
            label="Webhook type"
            required
            containerStyle={NO_MARGIN}
            value={webhookType || ""}
            onChange={(v) => {
              if (v !== webhookType) {
                // When changing types (e.g. Fastly to Cloudflare), clear the selected webhook secret
                form.setValue("webhookSecretKey", "");
              }

              setWebhookType(v as WebhookType);
            }}
            options={Object.entries(webhookTypes).map(([value, label]) => ({
              label,
              value,
            }))}
            sort={false}
          />

          {webhookType === "cloudflare" ? (
            <>
              <Field
                containerStyle={NO_MARGIN}
                label="Cloudflare account ID"
                key="cf_account_id"
                required
                {...form.register("accountId")}
              />
              <Field
                containerStyle={NO_MARGIN}
                label="KV namespace ID"
                key="cf_namespace_id"
                required
                {...form.register("namespaceId")}
              />
              <Field
                containerStyle={NO_MARGIN}
                label="Key"
                required
                {...form.register("key")}
                key="cf_payload_key"
              />
              {renderWebhookSecretField("Cloudflare API token", "cf_api_token")}
            </>
          ) : webhookType === "fastly" ? (
            <>
              <Field
                containerStyle={NO_MARGIN}
                label="Store ID"
                required
                {...form.register("storeId")}
                key="fastly_store_id"
              />
              <Field
                containerStyle={NO_MARGIN}
                label="Key"
                required
                {...form.register("key")}
                key="fastly_payload_key"
              />
              {renderWebhookSecretField("Fastly API token", "fastly_api_token")}
            </>
          ) : webhookType === "vercel" ? (
            <>
              <Field
                containerStyle={NO_MARGIN}
                label="Vercel Edge Config ID"
                required
                {...form.register("edgeConfigId")}
                key="vercel_edge_config_id"
              />
              <Field
                containerStyle={NO_MARGIN}
                label="Item key"
                required
                {...form.register("key")}
                key="vercel_payload_key"
              />
              <Field
                containerStyle={NO_MARGIN}
                label="Team ID (optional)"
                {...form.register("teamId")}
                key="vercel_team_id"
              />
              {renderWebhookSecretField("Vercel API token", "vercel_api_token")}
            </>
          ) : webhookType === "http" ? (
            <>
              <Field
                containerStyle={NO_MARGIN}
                label="Endpoint URL"
                placeholder="https://example.com"
                {...form.register("endpoint")}
                helpText={
                  <>
                    Must accept <code>{form.watch("httpMethod")}</code> requests
                    {isCloud() ? (
                      <>
                        {" "}
                        from <code>{CLOUD_EGRESS_IP}</code>
                      </>
                    ) : (
                      ""
                    )}
                    . Supports{" "}
                    <DocLink docSection="webhookSecrets">
                      webhook secrets
                    </DocLink>
                    .
                  </>
                }
                key="http_endpoint_url"
              />
              {form.watch("endpoint").match(/localhost/) && (
                <Callout status="error">
                  <strong>Error: </strong>Localhost not supported directly. Try
                  using{" "}
                  <Link href="https://www.npmjs.com/package/ngrok" external>
                    ngrok
                  </Link>{" "}
                  instead.
                </Callout>
              )}

              <SelectField
                label="Method"
                containerStyle={NO_MARGIN}
                value={form.watch("httpMethod")}
                onChange={(httpMethod) =>
                  form.setValue("httpMethod", httpMethod as WebhookMethod)
                }
                options={methodTypes.map((method) => ({
                  label: method,
                  value: method,
                }))}
                sort={false}
                key="http_method"
              />

              <CodeTextArea
                label="Headers"
                language="json"
                minLines={3}
                maxLines={6}
                containerStyle={NO_MARGIN}
                value={form.watch("headers")}
                setValue={(headers) => {
                  validateHeaders(headers);
                  form.setValue("headers", headers);
                }}
                helpText={
                  <>
                    {!validHeaders ? (
                      <Callout status="error" mr="auto">
                        Invalid JSON
                      </Callout>
                    ) : (
                      <div>
                        JSON format for headers. Supports{" "}
                        <DocLink docSection="webhookSecrets">
                          webhook secrets
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
                    key="http_payload_format"
                    label="Payload format"
                    containerStyle={NO_MARGIN}
                    value={form.watch("payloadFormat")}
                    onChange={(v) =>
                      form.setValue("payloadFormat", v as WebhookPayloadFormat)
                    }
                    options={[
                      { label: "Standard (default)", value: "standard" },
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
                    sort={false}
                    helpText={
                      <DocLink docSection="sdkWebhooks#payload-format">
                        Learn more <PiArrowSquareOut />
                      </DocLink>
                    }
                  />

                  {(form.watch("payloadFormat") === "edgeConfig" ||
                    form.watch("payloadFormat") === "edgeConfigUnescaped") && (
                    <Field
                      containerStyle={NO_MARGIN}
                      label="Edge Config key"
                      placeholder="gb_payload"
                      {...form.register("key")}
                      helpText={
                        <>
                          The name of the key you want to update within your
                          Edge Config. Defaults to <code>gb_payload</code>.
                        </>
                      }
                      key="http_payload_key"
                    />
                  )}
                </>
              )}
            </>
          ) : null}

          <Field
            containerStyle={NO_MARGIN}
            label="Timeout (seconds)"
            type="number"
            min={1}
            placeholder="30"
            error={timeoutError(form.watch("timeoutSeconds"))}
            {...form.register("timeoutSeconds", {
              setValueAs: timeoutSecondsFromInput,
            })}
          />
        </Flex>
      </ModalStandard>
    </>
  );
}

const EditSDKWebhooksModal: FC<{
  close: () => void;
  onSave: () => void;
  current: Partial<WebhookInterface>;
  sdkConnectionId: string;
  onOverrideSubmit?: (
    data: UpdateSdkWebhookProps,
    id: string | undefined,
  ) => Promise<void>;
  destination?: ReactNode;
  cta?: string;
}> = ({
  close,
  onSave,
  current,
  sdkConnectionId,
  onOverrideSubmit,
  destination,
  cta,
}) => {
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
      timeoutSeconds: current?.timeoutSeconds ?? null,
      sdkid: sdkConnectionId,
    },
  });

  const onSubmit = validatedSubmit(form, async (value) => {
    if (value.endpoint.match(/localhost/g)) {
      throw new Error("Invalid endpoint");
    }
    if (!isValidHttp(value.endpoint)) {
      throw new Error("Invalid URL");
    }
    if (timeoutError(value.timeoutSeconds)) {
      throw new Error(timeoutError(value.timeoutSeconds));
    }

    const data: UpdateSdkWebhookProps = {
      name: value.name,
      endpoint: value.endpoint,
      httpMethod: value.httpMethod,
      headers: value.headers,
      payloadFormat: value.payloadFormat,
      payloadKey: value.payloadKey,
      timeoutSeconds: value.timeoutSeconds,
    };

    if (onOverrideSubmit) {
      await onOverrideSubmit(data, current.id);
    } else if (current.id) {
      await apiCall(`/sdk-webhooks/${current.id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    } else {
      await apiCall(`/sdk-connections/${sdkConnectionId}/webhooks`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    }

    track(current.id ? "Edit Webhook" : "Create Webhook");
    onSave();
  });

  const validateHeaders = (headers: string) => {
    try {
      JSON.parse(headers);
      setValidHeaders(true);
    } catch (error) {
      setValidHeaders(false);
    }
  };

  return (
    <ModalStandard
      trackingEventModalType=""
      close={close}
      header={current.id ? "Edit SDK Webhook" : "Create SDK Webhook"}
      open={true}
      submit={onSubmit}
      ctaEnabled={validHeaders && !timeoutError(form.watch("timeoutSeconds"))}
      cta={cta ?? (current.id ? "Update" : "Create")}
      size="lg"
    >
      <Flex direction="column" gap="4">
        {destination}
        <Field
          containerStyle={NO_MARGIN}
          label="Display name"
          required
          {...form.register("name")}
        />
        <Field
          containerStyle={NO_MARGIN}
          label="Endpoint URL"
          placeholder="https://example.com"
          {...form.register("endpoint")}
          helpText={
            <>
              Must accept <code>{form.watch("httpMethod")}</code> requests
              {isCloud() ? (
                <>
                  {" "}
                  from <code>{CLOUD_EGRESS_IP}</code>
                </>
              ) : (
                ""
              )}
              .
            </>
          }
        />
        {form.watch("endpoint").match(/localhost/) && (
          <Callout status="error">
            <strong>Error: </strong>Localhost not supported directly. Try using{" "}
            <Link href="https://www.npmjs.com/package/ngrok" external>
              ngrok
            </Link>{" "}
            instead.
          </Callout>
        )}

        <SelectField
          label="Method"
          containerStyle={NO_MARGIN}
          value={form.watch("httpMethod")}
          onChange={(httpMethod) =>
            form.setValue("httpMethod", httpMethod as WebhookMethod)
          }
          options={methodTypes.map((method) => ({
            label: method,
            value: method,
          }))}
          sort={false}
        />

        <CodeTextArea
          label="Headers"
          language="json"
          minLines={3}
          maxLines={6}
          containerStyle={NO_MARGIN}
          value={form.watch("headers")}
          setValue={(headers) => {
            validateHeaders(headers);
            form.setValue("headers", headers);
          }}
          helpText={
            <>
              {!validHeaders ? (
                <Callout status="error" mr="auto">
                  Invalid JSON
                </Callout>
              ) : (
                <div>JSON format for headers.</div>
              )}
            </>
          }
        />

        {form.watch("httpMethod") !== "GET" && (
          <>
            <SelectField
              label="Payload format"
              containerStyle={NO_MARGIN}
              value={form.watch("payloadFormat")}
              onChange={(v) =>
                form.setValue("payloadFormat", v as WebhookPayloadFormat)
              }
              options={[
                { label: "Standard (default)", value: "standard" },
                {
                  label: "Standard (no SDK Payload)",
                  value: "standard-no-payload",
                },
                { label: "SDK Payload only", value: "sdkPayload" },
                { label: "Vercel Edge Config", value: "edgeConfigUnescaped" },
                // Only offered once a webhook already uses it.
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
              sort={false}
              helpText={
                <DocLink docSection="sdkWebhooks#payload-format">
                  Learn more <PiArrowSquareOut />
                </DocLink>
              }
            />

            {(form.watch("payloadFormat") === "edgeConfig" ||
              form.watch("payloadFormat") === "edgeConfigUnescaped") && (
              <Field
                containerStyle={NO_MARGIN}
                label="Edge Config key"
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

        <Field
          containerStyle={NO_MARGIN}
          label="Timeout (seconds)"
          type="number"
          min={1}
          placeholder="30"
          error={timeoutError(form.watch("timeoutSeconds"))}
          {...form.register("timeoutSeconds", {
            setValueAs: timeoutSecondsFromInput,
          })}
        />
      </Flex>
    </ModalStandard>
  );
};

export default EditSDKWebhooksModal;
