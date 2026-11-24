import React, { useState } from "react";
import {
  DATADOG_API_KEY_HEADER,
  datadogEventsUrl,
  datadogSiteForUrl,
  datadogSites,
} from "shared/util";
import { UseFormReturn } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import WebhookSecretModal from "@/components/EventWebHooks/WebhookSecretModal";
import { EventWebHookEditParams } from "@/components/EventWebHooks/utils";
import {
  headerSecretKey,
  parseHeaders,
  withHeaderSecret,
} from "@/components/EventWebHooks/datadog";

const CUSTOM_SITE = "custom";
// The last item in the secret picker's menu; opens the secret modal.
const CREATE_SECRET = "__create_secret__";
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
        formatOptionLabel={({ label, value }) =>
          value === CREATE_SECRET ? (
            <Flex align="center" gap="1" style={{ color: "var(--violet-11)" }}>
              <PiPlus /> {label}
            </Flex>
          ) : (
            label
          )
        }
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

// Datadog's rows: the site sets the URL, the secret the API key header.
export default function DatadogWebhookFields({
  form,
  disabled,
}: {
  form: UseFormReturn<EventWebHookEditParams>;
  disabled: boolean;
}) {
  const customFields = useCustomFields();
  const url = form.watch("url");
  const [customUrl, setCustomUrl] = useState(
    () => !!url && !datadogSiteForUrl(url),
  );
  const site = customUrl ? null : datadogSiteForUrl(url);
  let origin: string | null = null;
  try {
    origin = url ? new URL(url).origin : null;
  } catch {
    // Not a URL yet.
  }

  const serviceFieldOptions = customFields
    .filter(
      (f) =>
        f.active !== false &&
        (f.sections.includes("feature") || f.sections.includes("experiment")),
    )
    .map((f) => ({ label: f.name, value: f.id }));
  const datadog = form.watch("datadog");

  return (
    <>
      <SetupFieldRow label="Datadog site" required>
        <SelectField
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
            setCustomUrl(value === CUSTOM_SITE);
            if (value !== CUSTOM_SITE) {
              form.setValue("url", datadogEventsUrl(value));
            }
          }}
          helpText="The site you sign in to Datadog on. It sets the endpoint URL."
        />
      </SetupFieldRow>

      {customUrl && (
        <SetupFieldRow label="Endpoint URL" required>
          <Field
            placeholder="https://event-management-intake.datadoghq.com/api/v2/events"
            disabled={disabled}
            containerStyle={fieldStyle}
            value={url}
            onChange={(e) => form.setValue("url", e.target.value)}
          />
        </SetupFieldRow>
      )}

      <SetupFieldRow label="API key" required>
        <ApiKeySelect form={form} allowedOrigin={origin} disabled={disabled} />
      </SetupFieldRow>

      <SetupFieldRow label="Service field">
        <SelectField
          value={datadog?.serviceField ?? ""}
          placeholder="Choose a custom field"
          isClearable
          disabled={disabled}
          containerStyle={fieldStyle}
          options={serviceFieldOptions}
          onChange={(value) =>
            form.setValue("datadog", { ...datadog, serviceField: value })
          }
          helpText={
            <>
              Each Feature Flag&apos;s and experiment&apos;s values become
              Datadog services. Without one, changes reach Event Explorer but no
              service page.{" "}
              <Link href="/settings/customfields" external>
                Create a custom field
              </Link>
            </>
          }
        />
      </SetupFieldRow>

      <SetupFieldRow label="Approvers" content="text">
        <Checkbox
          label="Include approvers"
          description="Send who approved each published revision."
          value={!!datadog?.includeApprovers}
          disabled={disabled}
          setValue={(includeApprovers) =>
            form.setValue("datadog", {
              serviceField: datadog?.serviceField ?? "",
              includeApprovers,
            })
          }
        />
      </SetupFieldRow>
    </>
  );
}
