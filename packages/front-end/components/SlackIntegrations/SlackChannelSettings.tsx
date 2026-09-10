import { useMemo, useState } from "react";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import {
  experimentCardFormats,
  slackDigestFrequencies,
  SlackDigestConfig,
  SlackWorkspaceConnectionFrontEndInterface,
} from "shared/validators";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiTrash } from "react-icons/pi";
import {
  eventWebHookEventOptions,
  formatWebhookEventOptionLabel,
} from "@/components/EventWebHooks/utils";
import TagsInput from "@/components/Tags/TagsInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import MultiSelectField from "@/ui/MultiSelectField";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";
import Switch from "@/ui/Switch";

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
  (typeof experimentCardFormats)[number],
  { label: string; description: string }
> = {
  none: {
    label: "No card — text only",
    description: "Send a text message only.",
  },
  compact: {
    label: "Compact card",
    description: "A short image highlighting the experiment update.",
  },
  detailed: {
    label: "Detailed card",
    description: "A larger image with more detail when the event supports it.",
  },
};

const DIGEST_LABELS: Record<SlackDigestConfig["frequency"], string> = {
  off: "Off",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  custom: "Every few days",
};

function DigestSettings({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SlackDigestConfig;
  onChange: (value: SlackDigestConfig) => void;
}) {
  return (
    <Flex direction="column" gap="3">
      <Select
        label={label}
        value={value.frequency}
        setValue={(frequency) => {
          const selected = slackDigestFrequencies.find(
            (item) => item === frequency,
          );
          if (selected) onChange({ ...value, frequency: selected });
        }}
      >
        {slackDigestFrequencies.map((frequency) => (
          <SelectItem key={frequency} value={frequency}>
            {DIGEST_LABELS[frequency]}
          </SelectItem>
        ))}
      </Select>
      {value.frequency !== "off" && (
        <>
          <Select
            label="Delivery hour (UTC)"
            value={String(value.hourUtc ?? 14)}
            setValue={(hour) => onChange({ ...value, hourUtc: Number(hour) })}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <SelectItem key={hour} value={String(hour)}>
                {String(hour).padStart(2, "0")}:00 UTC
              </SelectItem>
            ))}
          </Select>
          {value.frequency === "weekly" && (
            <Select
              label="Day of week"
              value={String(value.dayOfWeekUtc ?? 1)}
              setValue={(day) =>
                onChange({ ...value, dayOfWeekUtc: Number(day) })
              }
            >
              {[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((day, index) => (
                <SelectItem key={day} value={String(index)}>
                  {day}
                </SelectItem>
              ))}
            </Select>
          )}
          {(value.frequency === "monthly" ||
            value.frequency === "quarterly") && (
            <Select
              label={
                value.frequency === "quarterly"
                  ? "Day in January, April, July, and October"
                  : "Day of month"
              }
              value={String(value.dayOfMonth ?? 1)}
              setValue={(day) =>
                onChange({ ...value, dayOfMonth: Number(day) })
              }
            >
              {Array.from({ length: 28 }, (_, index) => (
                <SelectItem key={index} value={String(index + 1)}>
                  {index + 1}
                </SelectItem>
              ))}
            </Select>
          )}
          {value.frequency === "custom" && (
            <Select
              label="Days between digests"
              value={String(value.intervalDays ?? 14)}
              setValue={(days) =>
                onChange({ ...value, intervalDays: Number(days) })
              }
            >
              {Array.from({ length: 90 }, (_, index) => (
                <SelectItem key={index} value={String(index + 1)}>
                  {index + 1}
                </SelectItem>
              ))}
            </Select>
          )}
        </>
      )}
    </Flex>
  );
}

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
}: {
  integration: SlackOAuthIntegrationInterface;
  workspace: SlackWorkspaceConnectionFrontEndInterface;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const { projects, tags } = useDefinitions();
  const environments = useEnvironments();
  const [enabled, setEnabled] = useState(integration.enabled);
  const [events, setEvents] = useState(integration.events);
  const [cardFormat, setCardFormat] = useState(
    integration.slackOptions?.experimentCardFormat ?? "compact",
  );
  const [experimentDigest, setExperimentDigest] = useState<SlackDigestConfig>(
    integration.slackOptions?.experimentDigest ?? { frequency: "off" },
  );
  const [featureDigest, setFeatureDigest] = useState<SlackDigestConfig>(
    integration.slackOptions?.featureDigest ?? { frequency: "off" },
  );
  const [coalesceNotifications, setCoalesceNotifications] = useState(
    integration.slackOptions?.coalesceNotifications ?? false,
  );
  const [filterProjects, setFilterProjects] = useState(
    integration.projects || [],
  );
  const [filterEnvironments, setFilterEnvironments] = useState(
    integration.environments || [],
  );
  const [filterTags, setFilterTags] = useState(integration.tags || []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
          events,
          projects: filterProjects,
          environments: filterEnvironments,
          tags: filterTags,
          slackOptions: {
            experimentCardFormat: cardFormat,
            experimentDigest,
            featureDigest,
            coalesceNotifications,
          },
        }),
      });
      await onSaved();
      setSaved(true);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save settings.",
      );
    } finally {
      setSaving(false);
    }
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

  return (
    <>
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

      <Flex direction="column" gap="5">
        <Flex justify="between" align="start" gap="4" wrap="wrap">
          <Box>
            <Heading as="h2" size="md" mb="1">
              {getSlackChannelLabel(integration)}
            </Heading>
            <Text color="text-mid">{getSlackWorkspaceLabel(workspace)}</Text>
          </Box>
          <Flex align="center" gap="4">
            <Checkbox
              label="Enabled"
              value={enabled}
              setValue={(value) => {
                setEnabled(value);
                setSaved(false);
              }}
              weight="medium"
            />
            <Button
              variant="outline"
              color="red"
              icon={<PiTrash />}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          </Flex>
        </Flex>

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

        <Box>
          <Heading as="h3" size="sm" mb="1">
            Events
          </Heading>
          <Text as="p" color="text-mid" mb="3">
            Choose the existing GrowthBook events sent to this channel.
          </Text>
          <MultiSelectField
            value={events}
            placeholder="Choose events"
            sort={false}
            size="lg"
            options={eventWebHookEventOptions}
            formatOptionLabel={(option, meta) =>
              formatWebhookEventOptionLabel(option, meta)
            }
            onChange={(value) => {
              setEvents(value);
              setSaved(false);
            }}
          />
          {events.length === 0 && (
            <Callout status="warning" mt="3">
              Select at least one event before saving.
            </Callout>
          )}
        </Box>

        <Box pt="5" style={{ borderTop: "1px solid var(--gray-a4)" }}>
          <Heading as="h3" size="sm" mb="1">
            Digests
          </Heading>
          <Text as="p" color="text-mid" mb="3">
            Send a scheduled summary of experiment and Feature Flag activity.
          </Text>
          <Grid columns={{ initial: "1", sm: "2" }} gap="4">
            <DigestSettings
              label="Experiment digest"
              value={experimentDigest}
              onChange={(value) => {
                setExperimentDigest(value);
                setSaved(false);
              }}
            />
            <DigestSettings
              label="Feature Flag digest"
              value={featureDigest}
              onChange={(value) => {
                setFeatureDigest(value);
                setSaved(false);
              }}
            />
          </Grid>
          <HelperText status="info" mt="3">
            Digests include events matching this channel’s subscriptions and
            filters. They are additional summaries; individual notifications
            remain enabled. Delivery may occur after the selected hour while
            queued work is processed.
          </HelperText>
        </Box>

        <Box pt="5" style={{ borderTop: "1px solid var(--gray-a4)" }}>
          <Switch
            label="Group related notifications"
            description="Combine updates for the same experiment into a summary after about a minute. Grouped summaries are text-only."
            value={coalesceNotifications}
            onChange={(value) => {
              setCoalesceNotifications(value);
              setSaved(false);
            }}
          />
        </Box>

        <Box pt="5" style={{ borderTop: "1px solid var(--gray-a4)" }}>
          <Heading as="h3" size="sm" mb="1">
            Experiment Cards
          </Heading>
          <Text as="p" color="text-mid" mb="3">
            Choose how supported experiment updates appear. Start, stop, SRM,
            and significance events with sufficient saved results can include
            cards. Unsupported events remain text-only.
          </Text>
          <RadioGroup
            gap="3"
            value={cardFormat}
            options={experimentCardFormats.map((format) => ({
              value: format,
              ...CARD_FORMAT_LABELS[format],
            }))}
            setValue={(value) => {
              setCardFormat(value as (typeof experimentCardFormats)[number]);
              setSaved(false);
            }}
          />
        </Box>

        <Box pt="5" style={{ borderTop: "1px solid var(--gray-a4)" }}>
          <Heading as="h3" size="sm" mb="1">
            Filters
          </Heading>
          <Text as="p" color="text-mid" mb="3">
            Leave a filter empty to include everything.
          </Text>
          <Grid columns={{ initial: "1", sm: "2" }} gap="4">
            <MultiSelectField
              label="Projects"
              placeholder="All Projects"
              value={filterProjects}
              size="lg"
              options={projects.map(({ id, name }) => ({
                label: name,
                value: id,
              }))}
              onChange={(value) => {
                setFilterProjects(value);
                setSaved(false);
              }}
            />
            <MultiSelectField
              label="Environments"
              placeholder="All Environments"
              value={filterEnvironments}
              size="lg"
              options={environments.map(({ id }) => ({
                label: id,
                value: id,
              }))}
              onChange={(value) => {
                setFilterEnvironments(value);
                setSaved(false);
              }}
            />
            <Box>
              <Text as="label" size="md" weight="semibold">
                Tags
              </Text>
              <TagsInput
                tagOptions={tags}
                value={filterTags}
                onChange={(value) => {
                  setFilterTags(value);
                  setSaved(false);
                }}
                autoFocus={false}
                prompt="All tags"
                creatable={false}
              />
            </Box>
          </Grid>
        </Box>

        <Flex align="center" gap="3">
          <Button
            onClick={save}
            loading={saving}
            disabled={events.length === 0}
          >
            Save settings
          </Button>
          {saved && <HelperText status="success">Saved.</HelperText>}
          {saveError && <HelperText status="error">{saveError}</HelperText>}
        </Flex>
      </Flex>
    </>
  );
}
