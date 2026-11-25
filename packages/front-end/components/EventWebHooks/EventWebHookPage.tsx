import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
import { datadogWebhookProblem } from "shared/util";
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
import {
  StagedChange,
  StagedChangesPopover,
} from "@/components/StagedEdits/StagedChanges";
import StagedEditsBar, {
  EDITS_BLOCKED_REASON,
} from "@/components/StagedEdits/StagedEditsBar";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import TagsInput from "@/components/Tags/TagsInput";
import CopyableCode from "@/components/Settings/CopyableCode";
import { DocLink } from "@/components/DocLink";
import WebhookHeadersField, {
  isJson,
} from "@/components/EventWebHooks/WebhookHeadersField";
import StatusDot from "@/components/Experiment/StatusDot";
import DatadogWebhookFields from "@/components/EventWebHooks/DatadogWebhookFields";
import DatadogWebhookChecks from "@/components/EventWebHooks/DatadogWebhookChecks";
import EventWebHookStatus, {
  WebhookStatusBadge,
} from "@/components/EventWebHooks/EventWebHookStatus";
import { parseHeaders } from "@/components/EventWebHooks/datadog";
import {
  slackSettingsHref,
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
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import useURLHash from "@/hooks/useURLHash";
import useUnsavedChangesGuard from "@/hooks/useUnsavedChangesGuard";
import ConfirmDialog from "@/ui/ConfirmDialog";
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

const payloadTypeDescriptions: Record<EventWebHookPayloadType, ReactNode> = {
  raw: "The legacy event format. Choose JSON for new webhooks.",
  json: "Each event as JSON, for your own endpoint. Requests are signed so you can verify them.",
  slack:
    "A message in a Slack channel for each event, through an incoming webhook URL.",
  discord:
    "A message in a Discord channel for each event, through a webhook URL.",
  datadog: (
    <>
      Sends changes that affect your SDK payloads to Datadog Change Tracking.{" "}
      <DocLink docSection="datadogChangeEvents">Learn more</DocLink>
    </>
  ),
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
            service: v.datadog?.service?.trim() || undefined,
          },
        }
      : {}),
  };
}

function isUrl(value: string) {
  return z.string().url().safeParse(value).success;
}

// Problems the rows show themselves: an empty required row (marked) or a
// timeout out of range.
function shownOnRows(values: EventWebHookEditParams): boolean {
  return (
    values.name.trim().length < 2 ||
    !values.url.trim() ||
    !values.events.length ||
    (values.payloadType === "datadog" &&
      !!datadogWebhookProblem({ headers: parseHeaders(values.headers) })) ||
    (!forcedParams[values.payloadType] && !!timeoutError(values.timeoutSeconds))
  );
}

// Anything else that stops a save, or null.
function saveProblem(values: EventWebHookEditParams): string | null {
  if (values.url.trim() && !isUrl(values.url)) {
    return "Enter a valid endpoint URL.";
  }
  if (
    !values.events.every(
      (e) =>
        (notificationEventNames as string[]).includes(e) ||
        isEventWebhookWildcard(e),
    )
  ) {
    return "Remove events that no longer exist.";
  }
  if (!forcedParams[values.payloadType] && !isJson(values.headers)) {
    return "Headers must be valid JSON.";
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

  // Refetches return a new object; edits only reset when saved values change.
  const savedJson = JSON.stringify(toEditParams(eventWebHook));
  const saved = useMemo<EventWebHookEditParams>(
    () => JSON.parse(savedJson),
    [savedJson],
  );
  const form = useForm<EventWebHookEditParams>({ defaultValues: saved });
  // When someone else saves, fields edited here keep the edit and the rest
  // take the new saved value.
  const loaded = useRef(saved);
  useEffect(() => {
    const shown = form.getValues();
    const before = loaded.current;
    loaded.current = saved;
    const keys = new Set([...Object.keys(saved), ...Object.keys(shown)]);
    form.reset(
      Object.fromEntries(
        [...keys].map((key) => {
          const k = key as keyof EventWebHookEditParams;
          return [k, isEqual(shown[k], before[k]) ? saved[k] : shown[k]];
        }),
      ) as EventWebHookEditParams,
    );
  }, [form, saved]);
  const values = form.watch();

  const {
    data: logsData,
    error: logsError,
    mutate: mutateLogs,
  } = useEventWebhookLogs(eventWebHook?.id ?? null);
  // Null until they load.
  const loadedLogs = logsData?.eventWebHookLogs ?? null;
  const logs = loadedLogs ?? [];

  const [saving, setSaving] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useURLHash(WEBHOOK_TABS);
  const latestFailed = !!logs[0] && logs[0].result !== "success";

  // The Slack app manages its channels' webhooks.
  const slackHref = eventWebHook ? slackSettingsHref(eventWebHook) : null;
  const managedInSlack = !!slackHref;
  const slackSettingsUrl = permissionsUtil.canManageIntegrations()
    ? slackHref
    : null;
  const canEdit =
    !managedInSlack &&
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
  // The form's rows, as the save bar lists them once they're edited.
  const field = (key: keyof ReturnType<typeof normalize>, label: string) => ({
    id: key,
    label,
    before: { [key]: savedNormal[key] },
    after: { [key]: shownNormal[key] },
    discard: () => form.setValue(key, saved[key]),
  });
  const unsaved = isNew
    ? []
    : [
        field("name", "Name"),
        field("payloadType", "Payload type"),
        field("url", isDatadog ? "Datadog site" : "Endpoint URL"),
        ...(isDatadog
          ? [field("headers", "API key"), field("datadog", "Datadog service")]
          : []),
        ...(isDetailed
          ? [
              field("method", "Method"),
              field("headers", "Headers"),
              field("timeoutSeconds", "Timeout (seconds)"),
            ]
          : []),
        field("events", "Events"),
        field("environments", "Environments"),
        field("projects", "Projects"),
        field("tags", "Tags"),
      ].filter((row) => !isEqual(row.before, row.after));
  const changed = (id: string) => unsaved.some((row) => row.id === id);
  const edited = unsaved.length > 0;
  const dirty = isNew || edited;
  const navigationGuard = useUnsavedChangesGuard(canEdit && edited);
  const blockedReason = !isNew && dirty ? EDITS_BLOCKED_REASON : null;
  const problem =
    saveProblem(values) ??
    (permitted
      ? null
      : "You can only save webhooks filtered to environments and Projects you have access to.");

  const onSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = JSON.stringify({
        ...toRequestBody(values),
        enabled: eventWebHook?.enabled ?? true,
      });
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
        navigationGuard.allowUnload();
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
    navigationGuard.allowUnload();
    await router.replace("/settings/webhooks");
  };

  const canTest = eventWebHook
    ? permissionsUtil.canCreateEventWebhook(eventWebHook)
    : !isDetailed && !isDatadog && !!values.url;

  const actions = slackSettingsUrl ? (
    <LinkButton href={slackSettingsUrl}>Edit Slack settings</LinkButton>
  ) : (
    <Flex align="center" gap="4">
      {canTest && (
        // A test sends the saved settings.
        <Tooltip content={blockedReason} enabled={!!blockedReason}>
          <span>
            <Button
              variant="outline"
              icon={<PiPaperPlaneTilt />}
              disabled={
                !!blockedReason || (!eventWebHook && !isUrl(values.url))
              }
              onClick={sendTest}
            >
              {eventWebHook ? "Send test" : "Test connection"}
            </Button>
          </span>
        </Tooltip>
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
    </Flex>
  );

  const setup = (
    <>
      <SectionFrame title="Delivery">
        <SetupFieldRow
          label="Name"
          htmlFor="webhook-name"
          required={isNew || values.name.trim().length < 2}
          changed={changed("name")}
        >
          <Field
            id="webhook-name"
            placeholder="My webhook"
            disabled={disabled}
            containerStyle={fieldStyle}
            value={values.name}
            onChange={(e) => form.setValue("name", e.target.value)}
          />
        </SetupFieldRow>

        <SetupFieldRow
          label="Payload type"
          htmlFor="webhook-payload-type"
          changed={changed("payloadType")}
        >
          <SelectField
            id="webhook-payload-type"
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
              if (type === "datadog" && values.payloadType !== "datadog") {
                form.setValue("events", [ALL_EVENTS_WILDCARD]);
                form.setValue("url", "");
                form.setValue("headers", "{}");
              } else if (type !== "datadog") {
                // Only Datadog lists "All supported events".
                form.setValue(
                  "events",
                  values.events.filter((e) => e !== ALL_EVENTS_WILDCARD),
                );
              }
              form.setValue("payloadType", type);
            }}
          />
          <Text as="p" color="text-mid" mt="2" mb="0">
            {payloadTypeDescriptions[values.payloadType]}
          </Text>
        </SetupFieldRow>

        {isDatadog ? (
          <DatadogWebhookFields
            form={form}
            disabled={disabled}
            isNew={isNew}
            changed={changed}
          />
        ) : (
          <SetupFieldRow
            label="Endpoint URL"
            htmlFor="webhook-url"
            required={isNew || !isUrl(values.url)}
            changed={changed("url")}
          >
            <Field
              id="webhook-url"
              placeholder="https://example.com/growthbook-webhook"
              disabled={disabled}
              containerStyle={fieldStyle}
              value={values.url}
              onChange={(e) => form.setValue("url", e.target.value)}
              helpText={
                isDetailed ? (
                  <>
                    Must accept <code>{values.method}</code> requests. Supports{" "}
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
            <SetupFieldRow
              label="Method"
              htmlFor="webhook-method"
              changed={changed("method")}
            >
              <SelectField
                id="webhook-method"
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
              htmlFor="webhook-timeout"
              changed={changed("timeoutSeconds")}
            >
              <Field
                id="webhook-timeout"
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

        {eventWebHook && ["raw", "json"].includes(eventWebHook.payloadType) && (
          <SetupFieldRow label="Signing secret" content="text">
            <CopyableCode value={eventWebHook.signingKey} />
            <Text as="p" size="sm" color="text-mid" mt="1" mb="0">
              Verifies the signature header on each request.
            </Text>
          </SetupFieldRow>
        )}
      </SectionFrame>

      <SectionFrame title="Events and Filters" mt="4">
        <SetupFieldRow
          label="Events"
          htmlFor="webhook-events"
          required={isNew || !values.events.length}
          changed={changed("events")}
        >
          <MultiSelectField
            id="webhook-events"
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
            formatOptionLabel={formatWebhookEventOptionLabel}
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
          />
        </SetupFieldRow>

        <SetupFieldRow
          label="Environments"
          htmlFor="webhook-environments"
          changed={changed("environments")}
        >
          <MultiSelectField
            id="webhook-environments"
            value={values.environments}
            placeholder="All Environments"
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
            onChange={(value: string[]) => form.setValue("environments", value)}
          />
        </SetupFieldRow>

        <SetupFieldRow
          label="Projects"
          htmlFor="webhook-projects"
          changed={changed("projects")}
        >
          <MultiSelectField
            id="webhook-projects"
            value={values.projects}
            placeholder="All Projects"
            sort={false}
            disabled={disabled}
            containerStyle={fieldStyle}
            options={projectOptions}
            onChange={(value: string[]) => form.setValue("projects", value)}
          />
        </SetupFieldRow>

        <SetupFieldRow
          label="Tags"
          htmlFor="webhook-tags"
          changed={changed("tags")}
        >
          <TagsInput
            tagOptions={tagOptions}
            value={values.tags}
            id="webhook-tags"
            prompt="All tags"
            autoFocus={false}
            disabled={disabled}
            onChange={(selected) => form.setValue("tags", selected)}
          />
        </SetupFieldRow>
      </SectionFrame>
    </>
  );

  return (
    <SettingsPage
      title={eventWebHook?.name ?? "New Webhook"}
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
            {eventWebHook?.name ?? "New Webhook"}
            {eventWebHook ? (
              <WebhookStatusBadge webhook={eventWebHook} />
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

      {eventWebHook ? (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setNotice(null);
            setTab(v as WebhookTab);
          }}
        >
          <Box mb="4">
            <TabsList>
              <TabsTrigger value="setup">Setup</TabsTrigger>
              <TabsTrigger value="diagnostics">
                Diagnostics
                {latestFailed ? (
                  <StatusDot
                    inline
                    color="var(--red-9)"
                    role="img"
                    aria-label="Last delivery failed"
                    style={{ marginLeft: 6 }}
                  />
                ) : null}
              </TabsTrigger>
            </TabsList>
          </Box>
          <TabsContent value="setup">{setup}</TabsContent>
          <TabsContent value="diagnostics">
            <EventWebHookStatus
              logs={loadedLogs}
              error={logsError?.message ?? null}
              canTest={canTest && !slackSettingsUrl}
            >
              {eventWebHook.payloadType === "datadog" && (
                <DatadogWebhookChecks eventWebHook={eventWebHook} logs={logs} />
              )}
            </EventWebHookStatus>
          </TabsContent>
        </Tabs>
      ) : (
        setup
      )}

      {canEdit && dirty && (
        <StagedEditsBar
          pinned
          changes={
            isNew ? (
              <Text weight="medium">New webhook</Text>
            ) : (
              <StagedChangesPopover
                open={changesOpen}
                onOpenChange={setChangesOpen}
                count={unsaved.length}
              >
                {unsaved.map((row) => (
                  <StagedChange
                    key={row.id}
                    label={row.label}
                    review={row}
                    discard={row.discard}
                    keepMine={null}
                    incompatible={null}
                    saving={saving}
                  />
                ))}
              </StagedChangesPopover>
            )
          }
          notes={
            saveError ? (
              <HelperText status="error">{saveError}</HelperText>
            ) : problem ? (
              <Text color="text-mid">{problem}</Text>
            ) : null
          }
          saving={saving}
          saveDisabled={shownOnRows(values) || !!problem}
          onDiscard={() => {
            if (!isNew) return form.reset(saved);
            navigationGuard.allowUnload();
            router.push("/settings/webhooks");
          }}
          onSave={onSave}
        />
      )}
      {navigationGuard.pendingHref ? (
        <ConfirmDialog
          title="Leave without saving?"
          content="You have unsaved changes to this webhook. Leaving this page discards them."
          yesText="Keep editing"
          noText="Leave page"
          onConfirm={navigationGuard.cancelNavigation}
          onCancel={navigationGuard.confirmNavigation}
          onDismiss={navigationGuard.cancelNavigation}
        />
      ) : null}
    </SettingsPage>
  );
}
