import { useMemo, useState } from "react";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
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
import Text from "@/ui/Text";

const REQUIRED_SCOPES = [
  "chat:write",
  "channels:read",
  "groups:read",
  "channels:join",
];

export const getSlackChannelLabel = (
  integration: SlackOAuthIntegrationInterface,
) => {
  const channelName = integration.slack?.channelName;
  if (channelName) {
    return channelName.startsWith("#") ? channelName : `#${channelName}`;
  }
  return integration.slack?.channelId || integration.name;
};

export const getSlackWorkspaceLabel = (
  integration: SlackOAuthIntegrationInterface,
) =>
  integration.slack?.teamName ||
  integration.slack?.teamId ||
  integration.slack?.enterpriseName ||
  integration.slack?.enterpriseId ||
  "Unknown workspace";

export default function SlackChannelSettings({
  integration,
  onSaved,
  onDeleted,
}: {
  integration: SlackOAuthIntegrationInterface;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const { projects, tags } = useDefinitions();
  const environments = useEnvironments();
  const [enabled, setEnabled] = useState(integration.enabled);
  const [events, setEvents] = useState(integration.events);
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
        (integration.slack?.scope || "")
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean),
      ),
    [integration.slack?.scope],
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
        { method: "POST" },
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
            <Text color="text-mid">{getSlackWorkspaceLabel(integration)}</Text>
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
              channel management and notifications.
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
