import React, { useState } from "react";
import {
  DATADOG_API_KEY_HEADER,
  datadogEventsUrl,
  datadogSiteForUrl,
  datadogSites,
  datadogWebhookProblem,
} from "shared/util";
import { UseFormReturn } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import WebhookSecretModal from "@/components/EventWebHooks/WebhookSecretModal";
import { EventWebHookEditParams } from "@/components/EventWebHooks/utils";
import {
  headerSecretKey,
  parseHeaders,
  withHeaderSecret,
} from "@/components/EventWebHooks/datadog";

const CUSTOM_SITE = "custom";
// The last item in the secret picker's menu; it opens the create modal.
const CREATE_SECRET = "__create_secret__";

function actionOrLabel({ label, value }: { label: string; value: string }) {
  return value === CREATE_SECRET ? (
    <Flex align="center" gap="1" style={{ color: "var(--violet-11)" }}>
      <PiPlus /> {label}
    </Flex>
  ) : (
    label
  );
}
const fieldStyle = { marginBottom: 0 };

function ApiKeySelect({
  form,
  allowedOrigin,
  disabled,
}: {
  form: UseFormReturn<EventWebHookEditParams>;
  allowedOrigin: string | null;
  disabled: boolean;
}) {
  const { webhookSecrets } = useDefinitions();
  const canManageSecrets = usePermissionsUtil().canManageWebhookSecrets();
  const [creating, setCreating] = useState(false);
  const value = headerSecretKey(
    parseHeaders(form.watch("headers")),
    DATADOG_API_KEY_HEADER,
  );

  const setSecret = (key: string) =>
    form.setValue(
      "headers",
      withHeaderSecret(form.watch("headers"), DATADOG_API_KEY_HEADER, key),
    );

  return (
    <>
      <SelectField
        value={value}
        id="webhook-api-key"
        placeholder="Choose a secret"
        sort={false}
        disabled={disabled}
        containerStyle={fieldStyle}
        options={[
          ...[...webhookSecrets]
            .sort((a, b) => a.key.localeCompare(b.key))
            .map((secret) => ({ label: secret.key, value: secret.key })),
          ...(canManageSecrets
            ? [{ label: "Create secret", value: CREATE_SECRET }]
            : []),
        ]}
        formatOptionLabel={actionOrLabel}
        isOptionDisabled={(option) => {
          const secret = webhookSecrets.find(
            (s) => "value" in option && s.key === option.value,
          );
          return (
            !!allowedOrigin &&
            !!secret?.allowedOrigins?.length &&
            !secret.allowedOrigins.includes(allowedOrigin)
          );
        }}
        onChange={(key) =>
          key === CREATE_SECRET ? setCreating(true) : setSecret(key)
        }
        helpText={
          <>
            A webhook secret, sent as the <code>{DATADOG_API_KEY_HEADER}</code>{" "}
            header.
          </>
        }
      />
      {creating && (
        <WebhookSecretModal
          close={() => setCreating(false)}
          defaultAllowedOrigins={allowedOrigin ? [allowedOrigin] : []}
          onSuccess={(key) => {
            setSecret(key);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

export default function DatadogWebhookFields({
  form,
  disabled,
  isNew,
  changed,
}: {
  form: UseFormReturn<EventWebHookEditParams>;
  disabled: boolean;
  // Required rows are marked when creating, or once emptied.
  isNew: boolean;
  // Whether a row's setting is unsaved, by its field.
  changed: (field: string) => boolean;
}) {
  const url = form.watch("url");
  // "Custom" clears the URL; any URL that isn't a site's is custom.
  const [customChosen, setCustomChosen] = useState(false);
  const site = datadogSiteForUrl(url);
  const customUrl = url ? !site : customChosen;
  let origin: string | null = null;
  try {
    origin = url ? new URL(url).origin : null;
  } catch {
    // Not a URL yet.
  }

  const datadog = form.watch("datadog");
  const hasApiKey = !datadogWebhookProblem({
    headers: parseHeaders(form.watch("headers")),
  });

  return (
    <>
      <SetupFieldRow
        label="Datadog site"
        htmlFor="webhook-datadog-site"
        required={isNew || !origin}
        changed={changed("url")}
      >
        <SelectField
          id="webhook-datadog-site"
          value={customUrl ? CUSTOM_SITE : (site?.id ?? "")}
          placeholder="Choose your Datadog site"
          sort={false}
          disabled={disabled}
          containerStyle={fieldStyle}
          options={[
            ...datadogSites.map((s) => ({ label: s.label, value: s.id })),
            { label: "Custom", value: CUSTOM_SITE },
          ]}
          onChange={(value) => {
            setCustomChosen(value === CUSTOM_SITE);
            form.setValue(
              "url",
              value === CUSTOM_SITE ? "" : datadogEventsUrl(value),
            );
          }}
          helpText="The site you sign in to Datadog on. It sets the endpoint URL."
        />
      </SetupFieldRow>

      {customUrl && (
        <SetupFieldRow
          label="Endpoint URL"
          htmlFor="webhook-url"
          required={isNew || !origin}
          changed={changed("url")}
        >
          <Field
            id="webhook-url"
            placeholder="https://event-management-intake.datadoghq.com/api/v2/events"
            disabled={disabled}
            containerStyle={fieldStyle}
            value={url}
            onChange={(e) => form.setValue("url", e.target.value)}
          />
        </SetupFieldRow>
      )}

      <SetupFieldRow
        label="API key"
        htmlFor="webhook-api-key"
        required={isNew || !hasApiKey}
        changed={changed("headers")}
      >
        <ApiKeySelect form={form} allowedOrigin={origin} disabled={disabled} />
      </SetupFieldRow>

      <SetupFieldRow
        label="Datadog service"
        htmlFor="webhook-service"
        changed={changed("datadog")}
      >
        <Field
          id="webhook-service"
          placeholder="checkout-api"
          disabled={disabled}
          containerStyle={fieldStyle}
          value={datadog?.service ?? ""}
          onChange={(e) =>
            form.setValue("datadog", { service: e.target.value })
          }
          helpText="Changes show on this service in Datadog. Use the environment, Project and tag filters below to send only its changes."
        />
      </SetupFieldRow>
    </>
  );
}
