import React, { useEffect, useState } from "react";
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
import { useCustomFields } from "@/hooks/useCustomFields";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Checkbox from "@/ui/Checkbox";
import WebhookSecretModal from "@/components/EventWebHooks/WebhookSecretModal";
import CustomFieldModal from "@/components/CustomFields/CustomFieldModal";
import { useUser } from "@/services/UserContext";
import { EventWebHookEditParams } from "@/components/EventWebHooks/utils";
import {
  headerSecretKey,
  parseHeaders,
  withHeaderSecret,
} from "@/components/EventWebHooks/datadog";

const CUSTOM_SITE = "custom";
// The last items in the pickers' menus; each opens its create modal.
const CREATE_SECRET = "__create_secret__";
const CREATE_FIELD = "__create_custom_field__";

function actionOrLabel({ label, value }: { label: string; value: string }) {
  return value === CREATE_SECRET || value === CREATE_FIELD ? (
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

// Datadog's rows: the site sets the URL, the secret the API key header.
export default function DatadogWebhookFields({
  form,
  disabled,
  isNew,
}: {
  form: UseFormReturn<EventWebHookEditParams>;
  disabled: boolean;
  // Required rows are marked when creating, or once emptied.
  isNew: boolean;
}) {
  const customFields = useCustomFields();
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

  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const canCreateField =
    hasCommercialFeature("custom-metadata") &&
    permissionsUtil.canManageCustomFields();
  const serviceFieldOptions = customFields
    .filter(
      (f) =>
        f.active !== false &&
        (f.sections.includes("feature") || f.sections.includes("experiment")),
    )
    .map((f) => ({ label: f.name, value: f.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const datadog = form.watch("datadog");

  // The fields there were when "Create custom field" opened, while its modal
  // is open; once it saves, the new field is picked when it shows up.
  const { mutateDefinitions } = useDefinitions();
  const [creatingFrom, setCreatingFrom] = useState<string[] | null>(null);
  const [awaitingFrom, setAwaitingFrom] = useState<string[] | null>(null);
  const setServiceField = (serviceField: string) =>
    form.setValue("datadog", { ...form.watch("datadog"), serviceField });
  useEffect(() => {
    const created =
      awaitingFrom && customFields.find((f) => !awaitingFrom.includes(f.id));
    if (!created) return;
    setServiceField(created.id);
    setAwaitingFrom(null);
    // Only when the field list or the pending pick changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customFields, awaitingFrom]);
  const hasApiKey = !datadogWebhookProblem({
    headers: parseHeaders(form.watch("headers")),
  });

  return (
    <>
      <SetupFieldRow
        label="Datadog site"
        htmlFor="webhook-datadog-site"
        required={isNew || !origin}
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
      >
        <ApiKeySelect form={form} allowedOrigin={origin} disabled={disabled} />
      </SetupFieldRow>

      <SetupFieldRow label="Datadog services" htmlFor="webhook-services">
        <SelectField
          id="webhook-services"
          value={datadog?.serviceField ?? ""}
          placeholder="Choose a custom field"
          isClearable
          sort={false}
          disabled={disabled}
          containerStyle={fieldStyle}
          options={[
            ...serviceFieldOptions,
            ...(canCreateField
              ? [{ label: "Create custom field", value: CREATE_FIELD }]
              : []),
          ]}
          formatOptionLabel={actionOrLabel}
          onChange={(value) => {
            if (value !== CREATE_FIELD) return setServiceField(value);
            setCreatingFrom(customFields.map((f) => f.id));
          }}
          helpText="Its values on each Feature Flag and experiment, such as checkout-api."
        />
        {creatingFrom && (
          <CustomFieldModal
            existing={{
              name: "Datadog service",
              type: "multiselect",
              creatable: true,
              sections: ["feature", "experiment"],
            }}
            close={() => setCreatingFrom(null)}
            onSuccess={() => {
              setAwaitingFrom(creatingFrom);
              mutateDefinitions();
            }}
          />
        )}
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
