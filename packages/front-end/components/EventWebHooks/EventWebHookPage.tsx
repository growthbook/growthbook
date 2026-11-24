import React, { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import isEqual from "lodash/isEqual";
import { z } from "zod";
import { Box, Flex } from "@radix-ui/themes";
import { PiPaperPlaneTilt } from "react-icons/pi";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import {
  ALL_EVENTS_WILDCARD,
  datadogEventWebHookEvents,
  isEventWebhookWildcard,
} from "shared/validators";
import { DATADOG_API_KEY_HEADER } from "shared/util";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import { useEventWebhookLogs } from "@/hooks/useEventWebhookLogs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import SettingsPage, {
  SettingsPageHeader,
} from "@/components/Layout/SettingsPage";
import SectionFrame from "@/components/SectionFrame";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import StagedEditsBar from "@/components/StagedEdits/StagedEditsBar";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import TagsInput from "@/components/Tags/TagsInput";
import CopyableCode from "@/components/Settings/CopyableCode";
import { DocLink } from "@/components/DocLink";
import WebhookHeadersField from "@/components/EventWebHooks/WebhookHeadersField";
import DatadogWebhookFields from "@/components/EventWebHooks/DatadogWebhookFields";
import DatadogWebhookChecks from "@/components/EventWebHooks/DatadogWebhookChecks";
import EventWebHookStatus, {
  recentFailures,
} from "@/components/EventWebHooks/EventWebHookStatus";
import {
  headerSecretKey,
  parseHeaders,
} from "@/components/EventWebHooks/datadog";
import {
  buildGroupedEventOptions,
  eventWebHookEventOptions,
  eventWebHookMethods,
  eventWebHookPayloadTypes,
  EventWebHookEditParams,
  EventWebHookMethod,
  EventWebHookPayloadType,
  formatWebhookEventOptionLabel,
  notificationEventNames,
  timeoutError,
  timeoutSecondsFromInput,
  WebhookIcon,
} from "@/components/EventWebHooks/utils";
import MultiSelectField from "@/ui/MultiSelectField";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import useURLHash from "@/hooks/useURLHash";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";

const fieldStyle = { marginBottom: 0 };

const WEBHOOK_TABS = ["setup", "diagnostics"] as const;
type WebhookTab = (typeof WEBHOOK_TABS)[number];

const payloadTypeLabels: Record<EventWebHookPayloadType, string> = {
  raw: "Raw (Legacy)",
  json: "JSON",
  slack: "Slack",
  discord: "Discord",
  datadog: "Datadog",
};

// These types send fixed requests: their method, headers and timeout aren't set.
const forcedParams: {
  [key in EventWebHookPayloadType]?: Partial<EventWebHookEditParams>;
} = {
  slack: { method: "POST", headers: "{}", timeoutSeconds: null },
  discord: { method: "POST", headers: "{}", timeoutSeconds: null },
  datadog: { method: "POST", timeoutSeconds: null },
};

// Only the events Datadog converts; group rows would subscribe to the rest.
const datadogEventOptions = buildGroupedEventOptions(
  datadogEventWebHookEvents,
).map((group) => ({
  ...group,
  options: group.options
    .filter((option) => !option.isWildcard)
    .map((option) => ({ ...option, shouldIndent: false })),
}));
const allEventsOption = {
  label: "All supported events",
  value: ALL_EVENTS_WILDCARD,
};

const NEW_WEBHOOK: EventWebHookEditParams = {
  name: "",
  events: [],
  url: "",
  enabled: true,
  environments: [],
  projects: [],
  tags: [],
  payloadType: "json",
  method: "POST",
  headers: "{}",
  timeoutSeconds: null,
};

function toEditParams(
  webhook: EventWebHookInterface | null,
): EventWebHookEditParams {
  if (!webhook) return NEW_WEBHOOK;
  return {
    name: webhook.name,
    events: webhook.events,
    url: webhook.url,
    enabled: webhook.enabled,
    environments: webhook.environments,
    projects: webhook.projects,
    tags: webhook.tags,
    payloadType: webhook.payloadType,
    method: webhook.method,
    headers: JSON.stringify(webhook.headers ?? {}),
    timeoutSeconds: webhook.timeoutSeconds ?? null,
    datadog: webhook.datadog,
  };
}

// What's sent: fixed values for the types that set them, and Datadog's
// settings only on a Datadog webhook.
function toRequestBody(values: EventWebHookEditParams) {
  const v = { ...values, ...forcedParams[values.payloadType] };
  return {
    name: v.name,
    url: v.url,
    enabled: v.enabled,
    events: v.events,
    projects: v.projects,
    tags: v.tags,
    environments: v.environments,
    payloadType: v.payloadType,
    method: v.method,
    headers: parseHeaders(v.headers),
    timeoutSeconds: v.timeoutSeconds ?? null,
    ...(v.payloadType === "datadog"
      ? {
          datadog: {
            serviceField: v.datadog?.serviceField ?? "",
            includeApprovers: !!v.datadog?.includeApprovers,
          },
        }
      : {}),
  };
}

function isJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

// Why the webhook can't be saved yet, or null when it can.
function saveProblem(values: EventWebHookEditParams): string | null {
  if (values.name.trim().length < 2) return "Add a name.";
  if (!z.string().url().safeParse(values.url).success) {
    return values.payloadType === "datadog"
      ? "Choose a Datadog site."
      : "Add an endpoint URL.";
  }
  if (
    values.payloadType === "datadog" &&
    !headerSecretKey(parseHeaders(values.headers), DATADOG_API_KEY_HEADER)
  ) {
    return "Choose an API key secret.";
  }
  if (!values.events.length) return "Choose at least one event.";
  if (
    !values.events.every(
      (e) =>
        (notificationEventNames as string[]).includes(e) ||
        isEventWebhookWildcard(e),
    )
  ) {
    return "Remove events that no longer exist.";
  }
  if (!forcedParams[values.payloadType]) {
    if (!isJson(values.headers)) return "Headers must be valid JSON.";
    const timeout = timeoutError(values.timeoutSeconds);
    if (timeout) return timeout;
  }
  return null;
}

export default function EventWebHookPage({
  eventWebHook,
  mutate,
}: {
  // Null on the new webhook page.
  eventWebHook: EventWebHookInterface | null;
  mutate: () => Promise<unknown>;
}) {
  const router = useRouter();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { tags: tagOptions } = useDefinitions();
  const datadogEnabled = useFeatureIsOn("datadog-change-events");
  const isNew = !eventWebHook;

  const saved = useMemo(() => toEditParams(eventWebHook), [eventWebHook]);
  const form = useForm<EventWebHookEditParams>({ defaultValues: saved });
  useEffect(() => form.reset(saved), [form, saved]);
  const values = form.watch();

  const { data: logsData, mutate: mutateLogs } = useEventWebhookLogs(
    eventWebHook?.id ?? null,
  );
  const logs = eventWebHook ? (logsData?.eventWebHookLogs ?? []) : [];

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useURLHash(WEBHOOK_TABS);
  const recent = recentFailures(logs);

  // The Slack app manages its channels' webhooks.
  const slackSettingsUrl =
    eventWebHook?.payloadType === "slack" && eventWebHook.slack?.teamId
      ? eventWebHook.slack.channelId
        ? `/integrations/slack?channel=${encodeURIComponent(eventWebHook.id)}`
        : `/integrations/slack?workspace=${encodeURIComponent(
            eventWebHook.slack.teamId,
          )}`
      : null;
  const canEdit =
    !slackSettingsUrl &&
    (eventWebHook
      ? permissionsUtil.canUpdateEventWebhook(eventWebHook, {})
      : permissionsUtil.canManageSomeEventWebhooks());
  const disabled = !canEdit;

  const scope = {
    projects: values.projects,
    environments: values.environments,
  };
  const permitted = eventWebHook
    ? permissionsUtil.canUpdateEventWebhook(eventWebHook, scope)
    : permissionsUtil.canCreateEventWebhook(scope);

  // Filters offer only what the viewer may scope a webhook to; selected ones
  // stay listed so they remain removable.
  const allEnvironments = useEnvironments().map((env) => env.id);
  const canUse = (projects: string[], environments: string[]) =>
    permissionsUtil.canCreateEventWebhook({ projects, environments });
  const canUseEnvironments = (environments: string[]) =>
    canUse(values.projects, environments);
  const canUseProjects = (projects: string[]) =>
    values.environments.length
      ? canUse(projects, values.environments)
      : allEnvironments.some((env) => canUse(projects, [env]));
  const environmentOptions = allEnvironments.filter(
    (env) => canUseEnvironments([env]) || values.environments.includes(env),
  );
  const projectOptions = useProjectOptions(
    (project) => canUseProjects([project]),
    values.projects,
  );

  const payloadTypes =
    values.payloadType === "raw"
      ? (["raw"] as const)
      : eventWebHookPayloadTypes.filter(
          (type) =>
            type !== "datadog" ||
            datadogEnabled ||
            saved.payloadType === "datadog",
        );
  const isDatadog = values.payloadType === "datadog";
  const isDetailed = !forcedParams[values.payloadType];

  const normalize = (v: EventWebHookEditParams) => ({
    ...toRequestBody(v),
    headers: isJson(v.headers) ? JSON.parse(v.headers) : v.headers,
  });
  const savedNormal = normalize(saved);
  const shownNormal = normalize(values);
  const changed = (field: keyof ReturnType<typeof normalize>) =>
    !isNew && !isEqual(shownNormal[field], savedNormal[field]);
  const dirty = isNew || !isEqual(shownNormal, savedNormal);
  const problem =
    saveProblem(values) ??
    (permitted
      ? null
      : "You can only save webhooks filtered to environments and Projects you have access to.");

  const onSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = JSON.stringify(toRequestBody(values));
      if (eventWebHook) {
        await apiCall(`/event-webhooks/${eventWebHook.id}`, {
          method: "PUT",
          body,
        });
        await mutate();
      } else {
        const res = await apiCall<{ eventWebHook: EventWebHookInterface }>(
          "/event-webhooks",
          { method: "POST", body },
        );
        await router.replace(`/settings/webhooks/event/${res.eventWebHook.id}`);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (action: () => Promise<string>) => {
    try {
      setNotice({ status: "success", message: await action() });
    } catch (e) {
      setNotice({
        status: "error",
        message: e instanceof Error ? e.message : "Something went wrong.",
      });
    }
  };

  const sendTest = () =>
    runAction(async () => {
      if (eventWebHook) {
        await apiCall("/event-webhooks/test", {
          method: "POST",
          body: JSON.stringify({ webhookId: eventWebHook.id }),
        });
        setTimeout(() => {
          mutateLogs();
          mutate();
        }, 1500);
        return "Test event sent. It shows under Deliveries in a moment.";
      }
      const res = await apiCall<{ error?: string }>(
        "/event-webhooks/test-params",
        {
          method: "POST",
          body: JSON.stringify({
            name: values.name,
            method: "POST",
            url: values.url,
          }),
        },
      );
      if (res.error) throw new Error(`Test failed: ${res.error}`);
      return "Test message sent.";
    });

  const toggleEnabled = () =>
    runAction(async () => {
      if (!eventWebHook) return "";
      const res = await apiCall<{ enabled: boolean }>(
        "/event-webhooks/toggle",
        {
          method: "POST",
          body: JSON.stringify({ webhookId: eventWebHook.id }),
        },
      );
      await mutate();
      return res.enabled ? "Webhook enabled." : "Webhook disabled.";
    });

  const remove = async () => {
    if (!eventWebHook) return;
    await apiCall(`/event-webhooks/${eventWebHook.id}`, { method: "DELETE" });
    await router.replace("/settings/webhooks");
  };

  const canTest = eventWebHook
    ? permissionsUtil.canCreateEventWebhook(eventWebHook)
    : !isDetailed && !isDatadog && !!values.url;

  const actions = slackSettingsUrl ? (
    <LinkButton href={slackSettingsUrl}>Edit Slack settings</LinkButton>
  ) : (
    <>
      {canTest && (
        <Button
          variant="outline"
          icon={<PiPaperPlaneTilt />}
          disabled={
            !eventWebHook && !z.string().url().safeParse(values.url).success
          }
          onClick={sendTest}
        >
          {eventWebHook ? "Send test" : "Test connection"}
        </Button>
      )}
      {eventWebHook && canEdit && (
        <DropdownMenu
          trigger={<MoreMenuTrigger label="More actions" size="lg" />}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          menuPlacement="end"
        >
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false);
                toggleEnabled();
              }}
            >
              {eventWebHook.enabled ? "Disable" : "Enable"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {permissionsUtil.canDeleteEventWebhook(eventWebHook) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  color="red"
                  confirmation={{
                    confirmationTitle: "Delete Webhook",
                    cta: "Delete",
                    ctaColor: "red",
                    submit: remove,
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenu>
      )}
    </>
  );

  return (
    <SettingsPage
      title={eventWebHook?.name ?? "New webhook"}
      hideHeader
      parent={{ display: "Webhooks", href: "/settings/webhooks" }}
    >
      <SettingsPageHeader
        title={
          <Flex align="center" gap="3">
            <WebhookIcon
              type={values.payloadType}
              style={{ height: "1em", width: "1em", flexShrink: 0 }}
            />
            {eventWebHook?.name ?? "New webhook"}
            {eventWebHook ? (
              eventWebHook.enabled ? (
                <Badge
                  label="Enabled"
                  color="green"
                  variant="soft"
                  radius="full"
                />
              ) : (
                <Badge
                  label="Disabled"
                  color="gray"
                  variant="soft"
                  radius="full"
                />
              )
            ) : null}
            {recent.total ? (
              recent.failed ? (
                <Badge
                  label={`${recent.failed} of the last ${recent.total} failed`}
                  color="red"
                  variant="soft"
                  radius="full"
                />
              ) : (
                <Badge
                  label="Healthy"
                  color="green"
                  variant="soft"
                  radius="full"
                />
              )
            ) : null}
          </Flex>
        }
        actions={actions}
      />

      {notice && (
        <Callout status={notice.status} mb="4">
          {notice.message}
        </Callout>
      )}

      {/* The setup, on its own or as the first tab. */}
      {(() => {
        const setup = (
          <>
            <SectionFrame title="Delivery">
              <SetupFieldRow label="Name" required changed={changed("name")}>
                <Field
                  placeholder="My webhook"
                  disabled={disabled}
                  containerStyle={fieldStyle}
                  value={values.name}
                  onChange={(e) => form.setValue("name", e.target.value)}
                />
              </SetupFieldRow>

              <SetupFieldRow
                label="Payload type"
                changed={changed("payloadType")}
              >
                <SelectField
                  value={values.payloadType}
                  disabled={disabled || values.payloadType === "raw"}
                  sort={false}
                  containerStyle={fieldStyle}
                  options={payloadTypes.map((type) => ({
                    label: type,
                    value: type,
                  }))}
                  formatOptionLabel={({ label }) => (
                    <Flex as="span" align="center" gap="2">
                      <WebhookIcon
                        type={label as EventWebHookPayloadType}
                        style={{
                          height: "1.25em",
                          width: "1.25em",
                          flexShrink: 0,
                        }}
                      />
                      {payloadTypeLabels[label as EventWebHookPayloadType]}
                    </Flex>
                  )}
                  onChange={(value) => {
                    const type = value as EventWebHookPayloadType;
                    if (
                      type === "datadog" &&
                      values.payloadType !== "datadog"
                    ) {
                      form.setValue("events", [ALL_EVENTS_WILDCARD]);
                      form.setValue("url", "");
                      form.setValue("headers", "{}");
                    }
                    form.setValue("payloadType", type);
                  }}
                />
              </SetupFieldRow>

              {isDatadog ? (
                <DatadogWebhookFields form={form} disabled={disabled} />
              ) : (
                <SetupFieldRow
                  label="Endpoint URL"
                  required
                  changed={changed("url")}
                >
                  <Field
                    placeholder="https://example.com/growthbook-webhook"
                    disabled={disabled}
                    containerStyle={fieldStyle}
                    value={values.url}
                    onChange={(e) => form.setValue("url", e.target.value)}
                    helpText={
                      isDetailed ? (
                        <>
                          Must accept <code>{values.method}</code> requests.
                          Supports{" "}
                          <DocLink useRadix={false} docSection="webhookSecrets">
                            webhook secrets
                          </DocLink>
                          .
                        </>
                      ) : null
                    }
                  />
                </SetupFieldRow>
              )}

              {isDetailed && (
                <>
                  <SetupFieldRow label="Method" changed={changed("method")}>
                    <SelectField
                      value={values.method}
                      disabled={disabled}
                      containerStyle={fieldStyle}
                      options={eventWebHookMethods.map((method) => ({
                        label: method,
                        value: method,
                      }))}
                      onChange={(value) =>
                        form.setValue("method", value as EventWebHookMethod)
                      }
                    />
                  </SetupFieldRow>
                  <SetupFieldRow label="Headers" changed={changed("headers")}>
                    <WebhookHeadersField
                      hideLabel
                      value={values.headers}
                      disabled={disabled}
                      setValue={(headers) => form.setValue("headers", headers)}
                      endpoint={values.url}
                    />
                  </SetupFieldRow>
                  <SetupFieldRow
                    label="Timeout (seconds)"
                    changed={changed("timeoutSeconds")}
                  >
                    <Field
                      type="number"
                      min={1}
                      placeholder="30"
                      disabled={disabled}
                      containerStyle={fieldStyle}
                      value={values.timeoutSeconds ?? ""}
                      error={timeoutError(values.timeoutSeconds)}
                      onChange={(e) =>
                        form.setValue(
                          "timeoutSeconds",
                          timeoutSecondsFromInput(e.target.value),
                        )
                      }
                    />
                  </SetupFieldRow>
                </>
              )}

              {eventWebHook &&
                ["raw", "json"].includes(eventWebHook.payloadType) && (
                  <SetupFieldRow label="Signing secret" content="text">
                    <CopyableCode value={eventWebHook.signingKey} />
                    <Text as="p" size="sm" color="text-mid" mt="1" mb="0">
                      Verifies the signature header on each request.
                    </Text>
                  </SetupFieldRow>
                )}
            </SectionFrame>

            <SectionFrame title="Events and filters" mt="4">
              <SetupFieldRow
                label="Events"
                required
                changed={changed("events")}
              >
                <MultiSelectField
                  value={values.events}
                  placeholder="Choose events"
                  sort={false}
                  disabled={disabled || values.payloadType === "raw"}
                  containerStyle={fieldStyle}
                  options={
                    !isDatadog
                      ? eventWebHookEventOptions
                      : values.events.includes(ALL_EVENTS_WILDCARD)
                        ? [allEventsOption]
                        : [allEventsOption, ...datadogEventOptions]
                  }
                  formatOptionLabel={(option, meta) =>
                    formatWebhookEventOptionLabel(option, meta)
                  }
                  onChange={(value: string[]) =>
                    form.setValue(
                      "events",
                      // "*" replaces every other choice.
                      value.includes(ALL_EVENTS_WILDCARD) &&
                        !values.events.includes(ALL_EVENTS_WILDCARD)
                        ? [ALL_EVENTS_WILDCARD]
                        : value,
                    )
                  }
                  helpText={
                    isDatadog
                      ? "Picks up newly supported events automatically."
                      : undefined
                  }
                />
              </SetupFieldRow>

              <SetupFieldRow
                label="Environments"
                changed={changed("environments")}
              >
                <MultiSelectField
                  value={values.environments}
                  placeholder="All environments"
                  sort={false}
                  disabled={disabled}
                  containerStyle={fieldStyle}
                  options={environmentOptions.map((env) => ({
                    label: env,
                    value: env,
                  }))}
                  isOptionDisabled={(option) =>
                    "value" in option && !canUseEnvironments([option.value])
                  }
                  onChange={(value: string[]) =>
                    form.setValue("environments", value)
                  }
                />
              </SetupFieldRow>

              <SetupFieldRow label="Projects" changed={changed("projects")}>
                <MultiSelectField
                  value={values.projects}
                  placeholder="All Projects"
                  sort={false}
                  disabled={disabled}
                  containerStyle={fieldStyle}
                  options={projectOptions}
                  onChange={(value: string[]) =>
                    form.setValue("projects", value)
                  }
                />
              </SetupFieldRow>

              <SetupFieldRow label="Tags" changed={changed("tags")}>
                <TagsInput
                  tagOptions={tagOptions}
                  value={values.tags}
                  prompt="All tags"
                  autoFocus={false}
                  onChange={(selected) => form.setValue("tags", selected)}
                />
              </SetupFieldRow>
            </SectionFrame>
          </>
        );
        if (!eventWebHook) return setup;
        return (
          <Tabs value={tab} onValueChange={(v) => setTab(v as WebhookTab)}>
            <Box mb="4">
              <TabsList>
                <TabsTrigger value="setup">Setup</TabsTrigger>
                <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
              </TabsList>
            </Box>
            <TabsContent value="setup">{setup}</TabsContent>
            <TabsContent value="diagnostics">
              <EventWebHookStatus logs={logs}>
                {eventWebHook.payloadType === "datadog" && (
                  <DatadogWebhookChecks
                    eventWebHook={eventWebHook}
                    logs={logs}
                  />
                )}
              </EventWebHookStatus>
            </TabsContent>
          </Tabs>
        );
      })()}

      {canEdit && dirty && (
        // Pinned to the window's bottom, from the navs to its right edge.
        <Box
          style={{
            position: "fixed",
            left: "var(--page-nav-width)",
            right: 0,
            bottom: 0,
            zIndex: 1003,
          }}
        >
          <StagedEditsBar
            changes={
              <Text weight="medium">
                {isNew ? "New webhook" : "Unsaved changes"}
              </Text>
            }
            notes={
              saveError || problem ? (
                <HelperText status={saveError ? "error" : "info"}>
                  {saveError ?? problem}
                </HelperText>
              ) : null
            }
            saving={saving}
            saveDisabled={!!problem}
            onDiscard={() =>
              isNew ? router.push("/settings/webhooks") : form.reset(saved)
            }
            onSave={onSave}
          />
        </Box>
      )}
      {/* Room for the bar under the last section. */}
      <Box style={{ height: "var(--bottom-bar-clearance, 0px)" }} />
    </SettingsPage>
  );
}
