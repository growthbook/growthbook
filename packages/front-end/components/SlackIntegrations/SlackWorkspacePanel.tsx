import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { PiCaretDown, PiPlus } from "react-icons/pi";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import { SlackWorkspaceConnectionFrontEndInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import HelperText from "@/ui/HelperText";
import { useDefinitions } from "@/services/DefinitionsContext";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import ConfirmDialog from "@/ui/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import SlackChannelSettings, {
  getSlackChannelLabel,
} from "./SlackChannelSettings";
import { getSlackChannelSummary } from "./slackSetupUtils";
import styles from "./SlackWorkspacePanel.module.scss";
import {
  SlackChannelFormValues,
  getSlackChannelFormValues,
  acknowledgeSlackChannelSave,
} from "./slackChannelForm";

export default function SlackWorkspacePanel({
  workspace,
  channels,
  selectedChannelId,
  needsReconnect,
  connecting,
  updatingAssistant,
  onAssistantChange,
  onReconnect,
  onDisconnect,
  onAddChannel,
  onSelectChannel,
  onSaved,
  onDirtyChange,
}: {
  workspace: SlackWorkspaceConnectionFrontEndInterface;
  channels: SlackOAuthIntegrationInterface[];
  selectedChannelId?: string;
  needsReconnect: boolean;
  connecting: boolean;
  updatingAssistant: boolean;
  onAssistantChange: (enabled: boolean) => Promise<void>;
  onReconnect: () => Promise<void>;
  onDisconnect: () => void;
  onAddChannel: () => void;
  onSelectChannel: (id: string | null) => Promise<void>;
  onSaved: (channel?: SlackOAuthIntegrationInterface) => Promise<void>;
  onDirtyChange: (teamId: string, dirty: boolean) => void;
}) {
  const { projects } = useDefinitions();
  const { apiCall } = useAuth();
  const [localChannelId, setLocalChannelId] = useState<string | null>(
    () =>
      channels.find((channel) => channel.id === selectedChannelId)?.id ??
      channels[0]?.id ??
      null,
  );
  const selected =
    channels.find((channel) => channel.id === localChannelId) ??
    channels[0] ??
    null;
  const form = useForm<SlackChannelFormValues>({
    defaultValues: getSlackChannelFormValues(selected),
  });
  const {
    reset,
    formState: { isDirty, isSubmitting, isSubmitSuccessful },
  } = form;
  const values = form.watch();
  const formChannelId = useRef(selected?.id ?? null);
  const lastRequestedChannelId = useRef(selectedChannelId ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    channelId: string;
    urlChannelId: string | null;
  } | null>(null);

  useEffect(() => {
    onDirtyChange(workspace.teamId, isDirty);
    return () => onDirtyChange(workspace.teamId, false);
  }, [workspace.teamId, isDirty, onDirtyChange]);

  useEffect(() => {
    if (formChannelId.current === (selected?.id ?? null)) return;
    formChannelId.current = selected?.id ?? null;
    reset(getSlackChannelFormValues(selected));
    setSaveError(null);
  }, [selected, reset]);

  useEffect(() => {
    const requestedChannelId = selectedChannelId ?? null;
    if (isSubmitting || lastRequestedChannelId.current === requestedChannelId)
      return;
    lastRequestedChannelId.current = requestedChannelId;
    const requested = requestedChannelId
      ? channels.find((channel) => channel.id === requestedChannelId)
      : channels[0];
    if (requested && requested.id !== selected?.id) {
      if (isDirty) {
        setPendingSelection({
          channelId: requested.id,
          urlChannelId: requestedChannelId,
        });
      } else setLocalChannelId(requested.id);
    }
  }, [selectedChannelId, selected?.id, channels, isDirty, isSubmitting]);

  const save = form.handleSubmit(async (values) => {
    if (!selected) return;
    if (!values.events.length) throw new Error("Select at least one event.");
    const submitted = structuredClone(values);
    await apiCall(`/integrations/slack/oauth/${selected.id}`, {
      method: "PUT",
      body: JSON.stringify(submitted),
    });
    acknowledgeSlackChannelSave(form, submitted);
    // Persistence succeeded even if refreshing the list fails.
    void onSaved({ ...selected, ...submitted }).catch(() => undefined);
  });
  const name = workspace.teamName || workspace.teamId || "Unknown workspace";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (isSubmitting || !isDirty) return;
        setSaveError(null);
        void save().catch((error: unknown) => {
          setSaveError(
            error instanceof Error ? error.message : "Failed to save settings.",
          );
        });
      }}
    >
      <Frame px="0" py="0" mb="0" style={{ overflow: "clip" }}>
        <Box p="4" style={{ borderBottom: "1px solid var(--gray-a6)" }}>
          <Flex justify="between" align="center" gap="4" wrap="wrap">
            <Flex align="center" gap="3">
              <Flex
                align="center"
                justify="center"
                style={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  borderRadius: "var(--radius-2)",
                  background: "var(--gray-a3)",
                  border: "1px solid var(--gray-a6)",
                }}
              >
                <FaSlack aria-hidden />
              </Flex>
              <Box>
                <Flex align="center" gap="2" wrap="wrap">
                  <Heading as="h2" size="md" mb="0">
                    {name}
                  </Heading>
                  {needsReconnect && (
                    <Badge
                      label="Reconnect needed"
                      color="amber"
                      variant="soft"
                    />
                  )}
                </Flex>
              </Box>
            </Flex>
            <DropdownMenu
              menuPlacement="end"
              disabled={connecting}
              trigger={
                <Button
                  variant="ghost"
                  color="gray"
                  size="sm"
                  aria-label={`Manage workspace ${name}`}
                  loading={connecting}
                  icon={<PiCaretDown aria-hidden />}
                  iconPosition="right"
                >
                  Manage workspace
                </Button>
              }
            >
              <DropdownMenuItem onClick={onReconnect}>
                Reconnect
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem color="red" onClick={onDisconnect}>
                Disconnect
              </DropdownMenuItem>
            </DropdownMenu>
          </Flex>
          <Flex direction="column" gap="3" mt="4">
            <Switch
              size="sm"
              label="AI assistant"
              description="Answer direct messages and mentions in connected channels"
              value={workspace.assistantEnabled === true}
              disabled={updatingAssistant}
              onChange={onAssistantChange}
            />
          </Flex>
        </Box>
        <div className={channels.length > 0 ? styles.content : undefined}>
          {channels.length > 0 && (
            <Box px="3" pt="4" pb="3" className={styles.rail}>
              <Flex direction="column" gap="1">
                {channels.map((channel) => {
                  const active = selected?.id === channel.id;
                  const enabled = active ? values.enabled : channel.enabled;
                  return (
                    <Link
                      key={channel.id}
                      href={`/integrations/slack?channel=${encodeURIComponent(channel.id)}`}
                      shallow
                      underline="none"
                      color="dark"
                      aria-current={active ? "page" : undefined}
                      aria-disabled={isSubmitting && !active}
                      onClick={(event) => {
                        if (active || isSubmitting) {
                          event.preventDefault();
                          return;
                        }
                        if (isDirty) {
                          event.preventDefault();
                          setPendingSelection({
                            channelId: channel.id,
                            urlChannelId: channel.id,
                          });
                          return;
                        }
                        setLocalChannelId(channel.id);
                      }}
                      style={{
                        display: "block",
                        padding: "var(--space-2) var(--space-3)",
                        borderRadius: "var(--radius-2)",
                        background: active ? "var(--violet-a3)" : undefined,
                        opacity: enabled ? 1 : 0.6,
                      }}
                    >
                      <Flex gap="2" align="center">
                        <Text weight={active ? "semibold" : "medium"} truncate>
                          {getSlackChannelLabel(channel)}
                        </Text>
                        {!enabled && (
                          <Badge label="Disabled" color="gray" variant="soft" />
                        )}
                      </Flex>
                      <Text as="div" size="sm" color="text-mid" truncate>
                        {getSlackChannelSummary(
                          active ? values : channel,
                          projects,
                        )}
                      </Text>
                    </Link>
                  );
                })}
              </Flex>
              <Box mt="4">
                <Button
                  variant="ghost"
                  color="gray"
                  size="md"
                  icon={<PiPlus size={16} aria-hidden />}
                  onClick={onAddChannel}
                  style={{
                    boxSizing: "border-box",
                    width: "100%",
                    height: 40,
                    justifyContent: "flex-start",
                  }}
                >
                  Add channel
                </Button>
              </Box>
            </Box>
          )}
          <Box
            px={{ initial: "3", sm: "5" }}
            pt="4"
            pb={{ initial: "3", sm: "5" }}
            style={{ minWidth: 0 }}
          >
            {selected ? (
              <SlackChannelSettings
                key={selected.id}
                integration={selected}
                workspace={workspace}
                form={form}
                onDeleted={async () => {
                  reset();
                  await onSelectChannel(null);
                  await onSaved();
                }}
              />
            ) : (
              <Flex direction="column" align="start" gap="3">
                <Text color="text-mid">
                  Add a channel to start sending notifications to this Slack
                  workspace.
                </Text>
                <Button icon={<PiPlus />} onClick={onAddChannel}>
                  Add channel
                </Button>
              </Flex>
            )}
          </Box>
        </div>
        {selected && (
          <Flex
            align="center"
            justify="end"
            gap="3"
            px={{ initial: "3", sm: "5" }}
            py="3"
            style={{
              position: "sticky",
              bottom: 0,
              background: "var(--color-panel-solid)",
              borderTop: "1px solid var(--gray-a4)",
              zIndex: 1,
            }}
          >
            <Box aria-live="polite">
              {saveError ? (
                <HelperText status="error">{saveError}</HelperText>
              ) : isDirty ? (
                <HelperText status="warning">Unsaved changes</HelperText>
              ) : isSubmitSuccessful ? (
                <HelperText status="success">Saved.</HelperText>
              ) : null}
            </Box>
            <Button
              type="submit"
              onClick={() => save()}
              loading={isSubmitting}
              setError={setSaveError}
              disabled={!isDirty || !values.events.length}
            >
              Save settings
            </Button>
          </Flex>
        )}
        {pendingSelection && (
          <ConfirmDialog
            title="Discard unsaved changes?"
            content="This channel has unsaved changes. Switching channels discards them."
            yesText="Discard changes"
            noText="Keep editing"
            onCancel={() => {
              // An empty URL would select the newly added channel instead.
              const channelId = selected?.id ?? null;
              setPendingSelection(null);
              if ((selectedChannelId ?? null) !== channelId) {
                void onSelectChannel(channelId);
              }
            }}
            onConfirm={async () => {
              setPendingSelection(null);
              setLocalChannelId(pendingSelection.channelId);
              if (
                (selectedChannelId ?? null) !== pendingSelection.urlChannelId
              ) {
                await onSelectChannel(pendingSelection.urlChannelId);
              }
            }}
          />
        )}
      </Frame>
    </form>
  );
}
