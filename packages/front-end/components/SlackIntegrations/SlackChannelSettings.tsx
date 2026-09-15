import { useEffect, useMemo, useState } from "react";
import { ago } from "shared/dates";
import { createPortal } from "react-dom";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import {
  notificationFormats,
  NotificationSubscription,
  DEFAULT_NOTIFICATION_SETTINGS,
  SlackWorkspaceConnectionFrontEndInterface,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { PiTrash, PiPaperPlaneTilt, PiX } from "react-icons/pi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import { Select, SelectItem, SelectGroup, SelectLabel } from "@/ui/Select";
import NotificationSubscriptionSettings from "@/components/Notifications/NotificationSubscriptionSettings";
import {
  notificationEventOptions,
  notificationCategories,
} from "@/components/Notifications/notificationEventOptions";
import SlackEventPreview from "./SlackEventPreview";

const REQUIRED_SCOPES = [
  "chat:write",
  "files:write",
  "channels:read",
  "groups:read",
  "channels:join",
  "assistant:write",
  "im:history",
  "app_mentions:read",
  "commands",
  "links:read",
  "links:write",
];

const CARD_FORMAT_LABELS: Record<
  (typeof notificationFormats)[number],
  { label: string; description: string }
> = {
  none: {
    label: "No card — text only",
    description: "Send a text message only.",
  },
  compact: {
    label: "Compact card",
    description: "A short image highlighting the event.",
  },
  "compact-dark": {
    label: "Compact dark",
    description:
      "A short image with a dark background and colored event header.",
  },
  detailed: {
    label: "Detailed card",
    description: "A larger image with event details and a results table.",
  },
};

export const getSlackChannelLabel = (
  integration: SlackOAuthIntegrationInterface,
) => {
  const channelName = integration.slack?.channelName;
  if (channelName) {
    return channelName.startsWith("#") ? channelName : `#${channelName}`;
  }
  return integration.slack?.channelId || integration.name;
};

const getSlackWorkspaceLabel = (
  workspace: SlackWorkspaceConnectionFrontEndInterface,
) =>
  workspace.teamName ||
  workspace.teamId ||
  workspace.enterpriseName ||
  workspace.enterpriseId ||
  "Unknown workspace";

export default function SlackChannelSettings({
  integration,
  workspace,
  onSaved,
  onDeleted,
  saveBarHost,
  onDraftEnabledChange,
  onDirtyChange,
}: {
  integration: SlackOAuthIntegrationInterface;
  workspace: SlackWorkspaceConnectionFrontEndInterface;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
  saveBarHost?: HTMLDivElement | null;
  onDraftEnabledChange?: (enabled: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { apiCall } = useAuth();
  const { data: previewEvents, error: previewEventsError } = useApi<{
    events: string[];
    cardEvents: string[];
  }>("/integrations/slack/preview-events");
  const [previewEvent, setPreviewEvent] = useState("experiment.warning");
  const [testEvent, setTestEvent] = useState("experiment.warning");
  const [showSendTest, setShowSendTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const eventChoices = notificationEventOptions.flatMap((option) => {
    const event = option.events.find((event) =>
      previewEvents?.events.includes(event),
    );
    return event
      ? [
          {
            event,
            label:
              option.label +
              (previewEvents?.cardEvents.includes(event)
                ? " (card)"
                : " (text)"),
            group: `${notificationCategories[option.category]} · ${option.group}`,
          },
        ]
      : [];
  });
  eventChoices.push(
    ...[
      {
        event: "digest:scorecard",
        label: "Experiment scorecard (image)",
        group: "Digests",
      },
      {
        event: "digest:feature",
        label: "Feature Flag digest (image)",
        group: "Digests",
      },
    ].filter((option) => previewEvents?.events.includes(option.event)),
  );
  const previewChoiceItems = [
    ...new Set(eventChoices.map((option) => option.group)),
  ].map((group) => (
    <SelectGroup key={group}>
      <SelectLabel>{group}</SelectLabel>
      {eventChoices
        .filter((option) => option.group === group)
        .map(({ event, label }) => (
          <SelectItem key={event} value={event}>
            {label}
          </SelectItem>
        ))}
    </SelectGroup>
  ));
  const [enabled, setEnabled] = useState(integration.enabled);
  const [subscription, setSubscription] = useState<NotificationSubscription>({
    events: integration.events,
    projects: integration.projects,
    tags: integration.tags,
    environments: integration.environments,
    experiments: integration.experiments,
    metrics: integration.metrics,
    features: integration.features,
    excludeEmptyUpdates: integration.excludeEmptyUpdates,
  });
  const { events } = subscription;
  const notificationSettings =
    integration.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS;
  const [cardFormat, setCardFormat] = useState<
    (typeof notificationFormats)[number]
  >(
    notificationSettings.type === "text"
      ? "none"
      : notificationSettings.cardFormat,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const markDirty = () => {
    setSaved(false);
    setDirty(true);
  };
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const grantedScopes = useMemo(
    () =>
      new Set(
        (workspace.scope || "")
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean),
      ),
    [workspace.scope],
  );
  const needsReconnect = REQUIRED_SCOPES.some(
    (scope) => !grantedScopes.has(scope),
  );

  const save = async () => {
    if (events.length === 0) {
      setSaveError("Select at least one event.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await apiCall(`/integrations/slack/oauth/${integration.id}`, {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          ...subscription,
          notificationSettings:
            cardFormat === "none"
              ? { type: "text" }
              : { type: "image", cardFormat },
        }),
      });
      setDirty(false);
      setSaved(true);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save settings.",
      );
      return;
    } finally {
      setSaving(false);
    }
    // Refreshing the cached list is not part of the save; SWR keeps the last data if it fails.
    await onSaved().catch(() => undefined);
  };

  const reconnect = async () => {
    setReconnecting(true);
    setReconnectError(null);
    try {
      const response = await apiCall<{ url: string }>(
        "/integrations/slack/connect",
        {
          method: "POST",
          body: JSON.stringify({ teamId: workspace.teamId }),
        },
      );
      window.location.assign(response.url);
    } catch (error) {
      setReconnectError(
        error instanceof Error ? error.message : "Failed to start reconnect.",
      );
      setReconnecting(false);
    }
  };

  const deleteChannel = async () => {
    await apiCall(`/integrations/slack/${integration.id}`, {
      method: "DELETE",
    });
    await onDeleted();
  };

  const saveBar = (
    <Flex
      align="center"
      gap="3"
      py="3"
      style={{
        position: saveBarHost ? "static" : "sticky",
        paddingLeft: saveBarHost ? "var(--space-5)" : 0,
        bottom: 0,
        background: "var(--color-panel-solid)",
        borderTop: "1px solid var(--gray-a4)",
        zIndex: 1,
      }}
    >
      <Button
        onClick={save}
        loading={saving}
        disabled={!dirty || events.length === 0}
      >
        Save settings
      </Button>
      {dirty && <HelperText status="warning">Unsaved changes</HelperText>}
      {saved && !dirty && <HelperText status="success">Saved.</HelperText>}
      {saveError && <HelperText status="error">{saveError}</HelperText>}
    </Flex>
  );

  return (
    <>
      {showSendTest && (
        <ModalStandard
          open
          header="Send a Test Message"
          trackingEventModalType="slack-send-test-message"
          cta={`Send to ${getSlackChannelLabel(integration)}`}
          close={() => setShowSendTest(false)}
          submit={async () => {
            const result = await apiCall<{ delivery: "card" | "text" }>(
              `/integrations/slack/${integration.id}/test`,
              {
                method: "POST",
                body: JSON.stringify({
                  eventName: testEvent,
                  format: cardFormat,
                }),
              },
            );
            setTestResult(
              `Test ${result.delivery === "card" ? "card" : "message"} sent to ${getSlackChannelLabel(integration)}.`,
            );
          }}
        >
          <Text as="p" mb="3">
            Posts a sample notification to {getSlackChannelLabel(integration)}{" "}
            using the currently selected card style, without saving your
            settings or creating a real event.
          </Text>
          <Box mb="4">
            <Select
              label="Message type"
              value={testEvent}
              setValue={setTestEvent}
            >
              {previewChoiceItems}
            </Select>
          </Box>
          <SlackEventPreview eventName={testEvent} format={cardFormat} />
        </ModalStandard>
      )}
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete Slack Channel Connection?"
          content={`${getSlackChannelLabel(
            integration,
          )} will stop receiving GrowthBook notifications.`}
          yesText="Delete"
          onConfirm={deleteChannel}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      <Flex direction="column" gap="4">
        <Flex justify="between" align="start" gap="4" wrap="wrap">
          <Box>
            <Heading as="h3" size="sm" mb="1">
              {getSlackChannelLabel(integration)}
            </Heading>
            <Text color="text-mid">
              {getSlackWorkspaceLabel(workspace)}
              {integration.lastRunAt
                ? ` · last run ${ago(integration.lastRunAt)}`
                : " · no runs yet"}
            </Text>
          </Box>
          <Flex align="center" gap="3" wrap="wrap">
            <Checkbox
              label="Enabled"
              value={enabled}
              setValue={(value) => {
                setEnabled(value);
                onDraftEnabledChange?.(value);
                markDirty();
              }}
              weight="medium"
            />
            <Box
              style={{
                height: "var(--space-5)",
                borderLeft: "1px solid var(--gray-a6)",
              }}
            />
            <Button
              variant="outline"
              color="gray"
              size="sm"
              icon={<PiPaperPlaneTilt />}
              disabled={!previewEvents?.events.length}
              onClick={() => {
                setTestEvent(previewEvent);
                setShowSendTest(true);
              }}
            >
              Send test
            </Button>
            <Button
              variant="outline"
              color="red"
              size="sm"
              aria-label="Delete channel connection"
              title="Delete channel connection"
              onClick={() => setConfirmingDelete(true)}
            >
              <PiTrash />
            </Button>
          </Flex>
        </Flex>

        {previewEventsError && (
          <HelperText status="error">
            Could not load test events. Refresh to try again.
          </HelperText>
        )}
        {testResult && (
          <Callout status="success">
            <Flex align="center" justify="between" gap="3">
              <span>{testResult}</span>
              <Button
                aria-label="Dismiss"
                variant="ghost"
                color="gray"
                size="sm"
                onClick={() => setTestResult(null)}
              >
                <PiX />
              </Button>
            </Flex>
          </Callout>
        )}
        {needsReconnect && (
          <Flex direction="column" gap="2">
            <Callout
              status="warning"
              action={
                <Button onClick={reconnect} loading={reconnecting}>
                  Reconnect
                </Button>
              }
            >
              Reconnect this workspace to grant the Slack permissions needed for
              channel management, notifications, and posting experiment card
              images.
            </Callout>
            {reconnectError && (
              <HelperText status="error">{reconnectError}</HelperText>
            )}
          </Flex>
        )}

        <NotificationSubscriptionSettings
          value={subscription}
          cardEvents={previewEvents?.cardEvents}
          onChange={(value) => {
            setSubscription(value);
            markDirty();
          }}
        />

        {events.length === 0 && (
          <Callout status="warning">
            Select at least one event before saving. To pause all notifications,
            turn off Enabled at the top of this page.
          </Callout>
        )}

        <Frame mb="0">
          <Heading as="h4" size="sm" mb="1">
            Results Card
          </Heading>
          <Text as="p" color="text-mid" mb="3">
            Choose a style for events that support image cards. Other
            notifications use text.
          </Text>
          <Flex gap="6" align="start" wrap="wrap">
            <Box style={{ flex: 1, minWidth: 220 }}>
              <Box style={{ maxWidth: 420 }}>
                <Select
                  label="Card style"
                  value={cardFormat}
                  setValue={(value) => {
                    const format = notificationFormats.find(
                      (format) => format === value,
                    );
                    if (format) {
                      setCardFormat(format);
                      markDirty();
                    }
                  }}
                >
                  {notificationFormats.map((format) => (
                    <SelectItem key={format} value={format}>
                      {CARD_FORMAT_LABELS[format].label}
                    </SelectItem>
                  ))}
                </Select>
              </Box>{" "}
            </Box>
            <Box style={{ width: 420, maxWidth: "100%" }}>
              <Text as="div" size="sm" weight="medium" color="text-mid" mb="2">
                PREVIEW
              </Text>
              <SlackEventPreview eventName={previewEvent} format={cardFormat} />
              <Box mt="3">
                <Select
                  label="Preview event"
                  value={previewEvent}
                  setValue={setPreviewEvent}
                >
                  {previewChoiceItems}
                </Select>
              </Box>
              <Text as="p" color="text-mid" size="sm" mt="2">
                Sample data. Events without image support appear as text.
              </Text>
            </Box>
          </Flex>
        </Frame>

        {saveBarHost ? createPortal(saveBar, saveBarHost) : saveBar}
      </Flex>
    </>
  );
}
