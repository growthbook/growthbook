import React, { useState } from "react";
import {
  DATADOG_API_KEY_HEADER,
  datadogEventsUrl,
  datadogSiteForUrl,
  datadogSites,
} from "shared/util";
import { UseFormReturn } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
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
// The last item in a secret picker's menu; opens the secret modal.
const CREATE_SECRET = "__create_secret__";

function ApiKeySelect({
  form,
  allowedOrigin,
  onChange,
}: {
  form: UseFormReturn<EventWebHookEditParams>;
  allowedOrigin: string | null;
  onChange: () => void;
}) {
  const { webhookSecrets } = useDefinitions();
  const canManageSecrets = usePermissionsUtil().canManageWebhookSecrets();
  const [creating, setCreating] = useState(false);
  const value = headerSecretKey(
    parseHeaders(form.watch("headers")),
    DATADOG_API_KEY_HEADER,
  );

  const setSecret = (key: string) => {
    form.setValue(
      "headers",
      withHeaderSecret(form.watch("headers"), DATADOG_API_KEY_HEADER, key),
    );
    onChange();
  };

  return (
    <Box mt="4">
      <SelectField
        label="API key"
        value={value}
        placeholder="Choose a secret"
        sort={false}
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
    </Box>
  );
}

export default function DatadogWebhookFields({
  form,
  handleFormValidation,
}: {
  form: UseFormReturn<EventWebHookEditParams>;
  handleFormValidation: () => void;
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
      <Box mt="4">
        <SelectField
          label="Datadog site"
          value={customUrl ? CUSTOM_SITE : (site?.id ?? "")}
          placeholder="Choose your Datadog site"
          sort={false}
          options={[
            ...datadogSites.map((s) => ({ label: s.label, value: s.id })),
            { label: "Custom", value: CUSTOM_SITE },
          ]}
          onChange={(value) => {
            setCustomUrl(value === CUSTOM_SITE);
            if (value !== CUSTOM_SITE)
              form.setValue("url", datadogEventsUrl(value));
            handleFormValidation();
          }}
          helpText="Sets the endpoint URL. Match the site you sign in to Datadog on."
        />
      </Box>

      {customUrl && (
        <Box mt="4">
          <Field
            label="Endpoint URL"
            placeholder="https://event-management-intake.datadoghq.com/api/v2/events"
            {...form.register("url")}
            onChange={(evt) => {
              form.setValue("url", evt.target.value);
              handleFormValidation();
            }}
          />
        </Box>
      )}

      <ApiKeySelect
        form={form}
        allowedOrigin={origin}
        onChange={handleFormValidation}
      />

      <Box mt="4">
        <SelectField
          label="Service field"
          value={datadog?.serviceField ?? ""}
          placeholder="Choose a custom field"
          isClearable
          options={serviceFieldOptions}
          onChange={(value) => {
            form.setValue("datadog", {
              ...datadog,
              serviceField: value,
            });
            handleFormValidation();
          }}
          helpText={
            <>
              Each Feature Flag&apos;s and experiment&apos;s values for this
              field become Datadog services. Without one, changes reach Event
              Explorer but no service page.{" "}
              <Link href="/settings/customfields" external>
                Create a custom field
              </Link>
            </>
          }
        />
      </Box>

      <Box mt="4">
        <Checkbox
          label="Include approvers"
          description="Send who approved each published revision."
          value={!!datadog?.includeApprovers}
          setValue={(includeApprovers) => {
            form.setValue("datadog", {
              serviceField: datadog?.serviceField ?? "",
              includeApprovers,
            });
            handleFormValidation();
          }}
        />
      </Box>
    </>
  );
}
