import { useMemo, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { ago } from "shared/dates";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import {
  notificationCardFormats,
  NotificationCardFormat,
  notificationFiltersSchema,
  SlackWorkspaceConnectionFrontEndInterface,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { PiTrash, PiPaperPlaneTilt, PiX } from "react-icons/pi";
import {
  notificationEventOptions,
  notificationCategories,
  notificationEventMetadata,
  previewNotificationEventNames,
  PreviewNotificationEventName,
  cardNotificationEventNames,
} from "shared/notifications";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
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
import SlackEventPreview from "./SlackEventPreview";
import { SlackChannelFormValues } from "./slackChannelForm";

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
  NotificationCardFormat,
  { label: string; description: string }
> = {
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
  form,
  onDeleted,
}: {
  integration: SlackOAuthIntegrationInterface;
  workspace: SlackWorkspaceConnectionFrontEndInterface;
  form: UseFormReturn<SlackChannelFormValues>;
  onDeleted: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const [sampleEvent, setSampleEvent] =
    useState<PreviewNotificationEventName>("experiment.warning");
  const [showSendTest, setShowSendTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const eventChoices = previewNotificationEventNames.map((event) => {
    const option = notificationEventOptions.find((option) =>
      option.events.some((name) => name === event),
    );
    return {
      event,
      label: `${notificationEventMetadata[event].label} (${cardNotificationEventNames.some((name) => name === event) ? "card" : "text"})`,
      group: option
        ? `${notificationCategories[option.category]} · ${option.group}`
        : "Other events",
    };
  });
  const selectSampleEvent = (value: string) => {
    const event = previewNotificationEventNames.find(
      (event) => event === value,
    );
    if (event) setSampleEvent(event);
  };
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
  const { enabled, notificationSettings, ...filters } = form.watch();
  const { events } = filters;
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
            const result = await apiCall<{ deliveredAs: "card" | "text" }>(
              `/integrations/slack/${integration.id}/test`,
              {
                method: "POST",
                body: JSON.stringify({
                  eventName: sampleEvent,
                  notificationSettings,
                }),
              },
            );
            setTestResult(
              `Test ${result.deliveredAs === "card" ? "card" : "message"} sent to ${getSlackChannelLabel(integration)}.`,
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
              value={sampleEvent}
              setValue={selectSampleEvent}
            >
              {previewChoiceItems}
            </Select>
          </Box>
          <SlackEventPreview
            eventName={sampleEvent}
            notificationSettings={notificationSettings}
          />
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
              setValue={(value) =>
                form.setValue("enabled", value, { shouldDirty: true })
              }
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
              onClick={() => setShowSendTest(true)}
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

        {testResult && (
          <Callout
            status="success"
            action={
              <Button
                aria-label="Dismiss"
                variant="ghost"
                color="gray"
                size="sm"
                icon={<PiX />}
                onClick={() => setTestResult(null)}
              >
                {null}
              </Button>
            }
          >
            {testResult}
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
              channel management and notifications.
            </Callout>
            {reconnectError && (
              <HelperText status="error">{reconnectError}</HelperText>
            )}
          </Flex>
        )}

        <NotificationSubscriptionSettings
          value={filters}
          cardEvents={cardNotificationEventNames}
          onChange={(filters) => {
            for (const name of notificationFiltersSchema.keyof().options) {
              form.setValue(name, filters[name], { shouldDirty: true });
            }
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
                  value={
                    notificationSettings.type === "text"
                      ? "text"
                      : notificationSettings.cardFormat
                  }
                  setValue={(value) => {
                    if (value === "text") {
                      form.setValue(
                        "notificationSettings",
                        { type: "text" },
                        { shouldDirty: true },
                      );
                      return;
                    }
                    const format = notificationCardFormats.find(
                      (format) => format === value,
                    );
                    if (format) {
                      form.setValue(
                        "notificationSettings",
                        { type: "image", cardFormat: format },
                        { shouldDirty: true },
                      );
                    }
                  }}
                >
                  <SelectItem value="text">Text only</SelectItem>
                  {notificationCardFormats.map((format) => (
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
              <SlackEventPreview
                eventName={sampleEvent}
                notificationSettings={notificationSettings}
              />
              <Box mt="3">
                <Select
                  label="Preview event"
                  value={sampleEvent}
                  setValue={selectSampleEvent}
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
      </Flex>
    </>
  );
}
