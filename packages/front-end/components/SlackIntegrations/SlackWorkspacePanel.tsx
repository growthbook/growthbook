import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { PiPlus } from "react-icons/pi";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import { SlackWorkspaceConnectionFrontEndInterface } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Link from "@/ui/Link";
import SlackChannelSettings, {
  getSlackChannelLabel,
} from "./SlackChannelSettings";
import { getSlackChannelSummary } from "./slackSetupUtils";
import styles from "./SlackWorkspacePanel.module.scss";

export default function SlackWorkspacePanel({
  workspace,
  channels,
  selectedChannelId,
  needsReconnect,
  connecting,
  onReconnect,
  onDisconnect,
  onAddChannel,
  onSelectChannel,
  onSaved,
}: {
  workspace: SlackWorkspaceConnectionFrontEndInterface;
  channels: SlackOAuthIntegrationInterface[];
  selectedChannelId?: string;
  needsReconnect: boolean;
  connecting: boolean;
  onReconnect: () => Promise<void>;
  onDisconnect: () => void;
  onAddChannel: () => void;
  onSelectChannel: (id: string | null) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const { projects } = useDefinitions();
  const [localChannelId, setLocalChannelId] = useState<string | null>(null);
  const [saveBarHost, setSaveBarHost] = useState<HTMLDivElement | null>(null);
  const [draftEnabled, setDraftEnabled] = useState<boolean | null>(null);
  const [channelDirty, setChannelDirty] = useState(false);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  useEffect(() => {
    if (
      selectedChannelId &&
      channels.some((channel) => channel.id === selectedChannelId)
    ) {
      setLocalChannelId(selectedChannelId);
    }
  }, [selectedChannelId, channels]);
  const selected =
    channels.find((channel) => channel.id === localChannelId) || channels[0];
  useEffect(() => setDraftEnabled(null), [selected?.id]);
  const saved = async () => {
    try {
      await onSaved();
    } finally {
      setDraftEnabled(null);
    }
  };
  const name = workspace.teamName || workspace.teamId || "Unknown workspace";
  return (
    <Frame px="0" py="0" mb="0" style={{ overflow: "clip" }}>
      <Box p="4" style={{ borderBottom: "1px solid var(--gray-a6)" }}>
        <Flex justify="between" align="start" gap="4" wrap="wrap">
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
                <Badge
                  label={needsReconnect ? "Reconnect needed" : "Connected"}
                  color={needsReconnect ? "amber" : "green"}
                  variant="soft"
                />
              </Flex>
            </Box>
          </Flex>
          <Flex gap="2">
            <Button
              variant="outline"
              color="gray"
              size="sm"
              onClick={onReconnect}
              loading={connecting}
            >
              Reconnect
            </Button>
            <Button
              variant="outline"
              color="red"
              size="sm"
              onClick={onDisconnect}
            >
              Disconnect
            </Button>
          </Flex>
        </Flex>
      </Box>
      <div className={styles.content}>
        <Box p="3" className={styles.rail}>
          <Flex justify="between" align="center" gap="2" mb="3">
            <Text size="sm" color="text-mid" weight="semibold">
              Channels
            </Text>
            <Button
              variant="ghost"
              color="gray"
              size="sm"
              aria-label={`Add channel to ${name}`}
              onClick={onAddChannel}
            >
              <PiPlus />
            </Button>
          </Flex>
          <Flex direction="column" gap="1">
            {channels.map((channel) => {
              const active = selected?.id === channel.id;
              const enabled = active
                ? (draftEnabled ?? channel.enabled)
                : channel.enabled;
              return (
                <Link
                  key={channel.id}
                  href={`/integrations/slack?channel=${encodeURIComponent(channel.id)}`}
                  shallow
                  underline="none"
                  color="dark"
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => {
                    if (active) return;
                    if (channelDirty) {
                      event.preventDefault();
                      setPendingChannelId(channel.id);
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
                  <span
                    className="text-muted"
                    style={{
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Text size="sm">
                      {getSlackChannelSummary(channel, projects)}
                    </Text>
                  </span>
                </Link>
              );
            })}
            <Button
              variant="outline"
              color="gray"
              size="sm"
              mt="3"
              icon={<PiPlus />}
              onClick={onAddChannel}
              style={{
                width: "100%",
              }}
            >
              Add channel
            </Button>
          </Flex>
        </Box>
        <Box p={{ initial: "3", sm: "5" }} style={{ minWidth: 0 }}>
          {selected ? (
            <SlackChannelSettings
              key={selected.id}
              integration={selected}
              workspace={workspace}
              saveBarHost={saveBarHost}
              onDraftEnabledChange={setDraftEnabled}
              onDirtyChange={setChannelDirty}
              onSaved={saved}
              onDeleted={async () => {
                await onSelectChannel(null);
                await onSaved();
              }}
            />
          ) : (
            <Flex direction="column" align="start" gap="3">
              <Heading as="h2" size="sm">
                Add a Channel
              </Heading>
              <Text color="text-mid">
                Add a channel to start receiving notifications from this
                workspace.
              </Text>
              <Button icon={<PiPlus />} onClick={onAddChannel}>
                Add channel
              </Button>
            </Flex>
          )}
        </Box>
      </div>
      <Box
        ref={setSaveBarHost}
        style={{ position: "sticky", bottom: 0, zIndex: 1 }}
      />
      {pendingChannelId && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          content="This channel has unsaved changes. Switching channels discards them."
          yesText="Discard changes"
          noText="Keep editing"
          onCancel={() => setPendingChannelId(null)}
          onConfirm={async () => {
            const channelId = pendingChannelId;
            setPendingChannelId(null);
            setLocalChannelId(channelId);
            await onSelectChannel(channelId);
          }}
        />
      )}
    </Frame>
  );
}
