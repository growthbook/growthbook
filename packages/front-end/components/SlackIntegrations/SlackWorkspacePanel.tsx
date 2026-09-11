import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { PiPlus } from "react-icons/pi";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import { SlackWorkspaceConnectionFrontEndInterface } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import SlackChannelSettings, {
  getSlackChannelLabel,
} from "./SlackChannelSettings";
import { getSlackChannelSummary } from "./slackSetupUtils";
import styles from "./SlackWorkspacePanel.module.scss";

type WorkspaceOption = {
  key: "assistant" | "unfurl";
  label: string;
  description: string;
  enabled: boolean;
};

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
  options = [],
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
  options?: WorkspaceOption[];
}) {
  const { apiCall } = useAuth();
  const { projects } = useDefinitions();
  const [localChannelId, setLocalChannelId] = useState<string | null>(null);
  const [saveBarHost, setSaveBarHost] = useState<HTMLDivElement | null>(null);
  const [optionChanges, setOptionChanges] = useState<
    Partial<Record<WorkspaceOption["key"], boolean>>
  >({});
  const [draftEnabled, setDraftEnabled] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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
  const changedOptions = options.filter(
    (option) =>
      optionChanges[option.key] !== undefined &&
      optionChanges[option.key] !== option.enabled,
  );
  const additionalDirty = changedOptions.length > 0;
  const saveOptions = async () => {
    for (const option of changedOptions) {
      await apiCall(`/integrations/slack/${option.key}`, {
        method: "POST",
        body: JSON.stringify({
          teamId: workspace.teamId,
          enabled: optionChanges[option.key],
        }),
      });
    }
  };
  const saved = async () => {
    await onSaved();
    setOptionChanges({});
    setDraftEnabled(null);
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
        {options.length > 0 && (
          <Flex
            gap="5"
            mt="4"
            wrap="wrap"
            style={{ paddingLeft: "calc(32px + var(--space-3))" }}
          >
            {options.map((option) => (
              <Checkbox
                key={option.key}
                weight="medium"
                value={optionChanges[option.key] ?? option.enabled}
                setValue={(enabled) =>
                  setOptionChanges((current) => ({
                    ...current,
                    [option.key]: enabled,
                  }))
                }
                label={
                  <Flex asChild gap="2" align="center" wrap="wrap">
                    <span>
                      {option.label}
                      <Text color="text-mid" weight="regular" size="sm">
                        {option.description}
                      </Text>
                    </span>
                  </Flex>
                }
              />
            ))}
          </Flex>
        )}
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
                  onClick={() => setLocalChannelId(channel.id)}
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
              additionalDirty={additionalDirty}
              onSaveAdditionalSettings={saveOptions}
              onDraftEnabledChange={setDraftEnabled}
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
      {!selected && options.length > 0 && (
        <Box p="4" style={{ borderTop: "1px solid var(--gray-a6)" }}>
          <Flex gap="3" align="center">
            <Button
              disabled={!additionalDirty}
              setError={setSaveError}
              onClick={async () => {
                await saveOptions();
                await saved();
              }}
            >
              Save settings
            </Button>
            {additionalDirty && (
              <HelperText status="warning">Unsaved changes</HelperText>
            )}
            {saveError && <HelperText status="error">{saveError}</HelperText>}
          </Flex>
        </Box>
      )}
    </Frame>
  );
}
