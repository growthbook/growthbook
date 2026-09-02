import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import { Box, Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { PiPlus, PiPlugs } from "react-icons/pi";
import SlackChannelSettings, {
  getSlackChannelLabel,
  getSlackWorkspaceLabel,
} from "@/components/SlackIntegrations/SlackChannelSettings";
import SelectField from "@/components/Forms/SelectField";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";

type SlackConnectionsResponse = {
  slackIntegrations: SlackOAuthIntegrationInterface[];
  oauthConfigured: boolean;
};

type SlackChannelOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  alreadyConnected: boolean;
};

type WorkspaceGroup = {
  teamId: string;
  workspace: SlackOAuthIntegrationInterface;
  channels: SlackOAuthIntegrationInterface[];
};

const REQUIRED_SCOPES = [
  "chat:write",
  "channels:read",
  "groups:read",
  "channels:join",
];

const getQueryStringValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getSlackAuthorizationError = (error: string) =>
  error === "access_denied"
    ? "Slack authorization was canceled."
    : "Slack authorization failed. Try again.";

const workspaceNeedsReconnect = (
  integration: SlackOAuthIntegrationInterface,
) => {
  const scopes = new Set(
    (integration.slack?.scope || "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
  return REQUIRED_SCOPES.some((scope) => !scopes.has(scope));
};

function AddChannelModal({
  teamId,
  onClose,
  onAdded,
}: {
  teamId: string;
  onClose: () => void;
  onAdded: (integration: SlackOAuthIntegrationInterface) => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const [channels, setChannels] = useState<SlackChannelOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

  const fetchChannels = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await apiCall<{
          channels: SlackChannelOption[];
          nextCursor: string | null;
        }>(
          `/integrations/slack/channels?teamId=${encodeURIComponent(teamId)}${
            cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
          }`,
        );
        setChannels((current) =>
          cursor ? [...current, ...response.channels] : response.channels,
        );
        setNextCursor(response.nextCursor);
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load Slack channels.",
        );
      } finally {
        setLoading(false);
      }
    },
    [apiCall, teamId],
  );

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const connectedIds = useMemo(
    () =>
      new Set(
        channels
          .filter((channel) => channel.alreadyConnected)
          .map((channel) => channel.id),
      ),
    [channels],
  );

  return (
    <ModalStandard
      trackingEventModalType="slack-add-channel"
      open={true}
      header="Add a Slack Channel"
      cta="Add channel"
      ctaEnabled={!!selected && !connectedIds.has(selected)}
      submit={async () => {
        const response = await apiCall<{
          slackIntegration: SlackOAuthIntegrationInterface;
        }>("/integrations/slack/channels", {
          method: "POST",
          body: JSON.stringify({ teamId, channelId: selected }),
        });
        await onAdded(response.slackIntegration);
      }}
      close={onClose}
    >
      <Text as="p" color="text-mid" mb="3">
        GrowthBook will join the channel and send the notifications you
        configure.
      </Text>
      {loadError && (
        <Callout status="error" mb="3">
          {loadError}
        </Callout>
      )}
      <SelectField
        label="Channel"
        placeholder={loading ? "Loading channels…" : "Search for a channel…"}
        value={selected}
        options={channels.map((channel) => ({
          label: `#${channel.name}${channel.isPrivate ? " (private)" : ""}${
            channel.alreadyConnected ? " — already connected" : ""
          }`,
          value: channel.id,
        }))}
        onChange={setSelected}
        isSearchable
        isOptionDisabled={(option) =>
          "value" in option && connectedIds.has(option.value)
        }
        disabled={loading && channels.length === 0}
      />
      <Flex gap="3" align="center" mt="3">
        <Button
          variant="ghost"
          size="sm"
          loading={loading}
          onClick={() => fetchChannels()}
        >
          Refresh
        </Button>
        {nextCursor && (
          <Button
            variant="ghost"
            size="sm"
            loading={loading}
            onClick={() => fetchChannels(nextCursor)}
          >
            Load more
          </Button>
        )}
      </Flex>
      <Text as="p" size="sm" color="text-mid" mt="3" mb="0">
        For a private channel, invite the GrowthBook app in Slack before
        refreshing this list.
      </Text>
    </ModalStandard>
  );
}

const SlackIntegrationsPage: NextPage = () => {
  const permissionsUtils = usePermissionsUtil();
  const canManageIntegrations = permissionsUtils.canManageIntegrations();
  const router = useRouter();
  const { apiCall, orgId, organizations, setOrgId } = useAuth();
  const callbackProcessed = useRef(false);
  const installInFlight = useRef(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectedMessage, setConnectedMessage] = useState<string | null>(null);
  const [installCode, setInstallCode] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [addChannelTeamId, setAddChannelTeamId] = useState<string | null>(null);
  const [disconnectTeamId, setDisconnectTeamId] = useState<string | null>(null);

  const {
    data,
    error: loadError,
    mutate,
  } = useApi<SlackConnectionsResponse>("/integrations/slack/oauth", {
    shouldRun: () => canManageIntegrations,
  });

  const integrations = useMemo(
    () => data?.slackIntegrations || [],
    [data?.slackIntegrations],
  );

  const workspaceGroups = useMemo(() => {
    const groups = new Map<string, WorkspaceGroup>();
    integrations.forEach((integration) => {
      const teamId = integration.slack?.teamId;
      if (!teamId) return;
      const existing = groups.get(teamId);
      if (!existing) {
        groups.set(teamId, {
          teamId,
          workspace: integration,
          channels: integration.slack?.channelId ? [integration] : [],
        });
        return;
      }
      if (integration.slack?.channelId) {
        existing.channels.push(integration);
      } else {
        existing.workspace = integration;
      }
    });
    return [...groups.values()];
  }, [integrations]);

  const selectedChannelId = getQueryStringValue(router.query.channel);
  const selectedWorkspaceId = getQueryStringValue(router.query.workspace);
  const selectedWorkspaceGroup = useMemo(
    () =>
      workspaceGroups.find((group) => group.teamId === selectedWorkspaceId) ||
      null,
    [selectedWorkspaceId, workspaceGroups],
  );
  const selectedChannel = useMemo(() => {
    const channels = workspaceGroups.flatMap((group) => group.channels);
    const workspaceChannels = selectedWorkspaceGroup?.channels || channels;
    return (
      channels.find((channel) => channel.id === selectedChannelId) ||
      workspaceChannels[0]
    );
  }, [selectedChannelId, selectedWorkspaceGroup, workspaceGroups]);

  const selectChannel = useCallback(
    async (channelId: string | null) => {
      await router.replace(
        channelId
          ? `/integrations/slack?channel=${encodeURIComponent(channelId)}`
          : "/integrations/slack",
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  useEffect(() => {
    if (!router.isReady || callbackProcessed.current) {
      return;
    }

    const slackError = getQueryStringValue(router.query.error);
    if (slackError) {
      callbackProcessed.current = true;
      setConnectError(getSlackAuthorizationError(slackError));
      router.replace("/integrations/slack", undefined, { shallow: true });
      return;
    }

    const code = getQueryStringValue(router.query.code);
    if (!code) return;
    const state = getQueryStringValue(router.query.state);
    callbackProcessed.current = true;
    router.replace("/integrations/slack", undefined, { shallow: true });

    if (!state) {
      setInstallCode(code);
      return;
    }

    setConnecting(true);
    setConnectError(null);
    apiCall<{ slackIntegration: SlackOAuthIntegrationInterface }>(
      "/integrations/slack/oauth-callback",
      {
        method: "POST",
        body: JSON.stringify({ code, state }),
      },
    )
      .then(async ({ slackIntegration }) => {
        await mutate();
        setConnectedMessage("Slack workspace connected successfully.");
        const teamId = slackIntegration.slack?.teamId;
        if (teamId && !slackIntegration.slack?.channelId) {
          setAddChannelTeamId(teamId);
        }
      })
      .catch((error: unknown) => {
        setConnectError(
          error instanceof Error
            ? error.message
            : "Failed to connect the Slack workspace.",
        );
      })
      .finally(() => {
        setConnecting(false);
      });
  }, [apiCall, mutate, router]);

  const connectToSlack = useCallback(
    async (teamId?: string) => {
      setConnecting(true);
      setConnectError(null);
      try {
        const response = await apiCall<{ url: string }>(
          "/integrations/slack/connect",
          {
            method: "POST",
            body: JSON.stringify(teamId ? { teamId } : {}),
          },
        );
        window.location.assign(response.url);
      } catch (error) {
        setConnectError(
          error instanceof Error
            ? error.message
            : "Failed to start the Slack connection.",
        );
        setConnecting(false);
      }
    },
    [apiCall],
  );

  const organizationOptions = useMemo(
    () =>
      (organizations || []).map((organization) => ({
        value: organization.id,
        label: organization.name || organization.id,
      })),
    [organizations],
  );
  const currentOrganizationName =
    organizationOptions.find((organization) => organization.value === orgId)
      ?.label ||
    orgId ||
    "this organization";

  const confirmAppDirectoryInstall = useCallback(async () => {
    if (!installCode || installInFlight.current) return;
    installInFlight.current = true;
    setInstalling(true);
    setConnectError(null);
    try {
      const { slackIntegration } = await apiCall<{
        slackIntegration: SlackOAuthIntegrationInterface;
      }>("/integrations/slack/oauth-install", {
        method: "POST",
        body: JSON.stringify({ code: installCode }),
      });
      await mutate();
      setInstallCode(null);
      setConnectedMessage("Slack workspace connected successfully.");
      const teamId = slackIntegration.slack?.teamId;
      if (teamId && !slackIntegration.slack?.channelId) {
        setAddChannelTeamId(teamId);
      }
    } catch (error) {
      setConnectError(
        error instanceof Error
          ? error.message
          : "Failed to connect the Slack workspace.",
      );
    } finally {
      installInFlight.current = false;
      setInstalling(false);
    }
  }, [apiCall, installCode, mutate]);

  const switchInstallOrganization = useCallback(
    (nextOrgId: string) => {
      if (!setOrgId || !nextOrgId || nextOrgId === orgId) return;
      setOrgId(nextOrgId);
      setConnectError(null);
      try {
        localStorage.setItem("gb-last-picked-org", JSON.stringify(nextOrgId));
      } catch {
        // Persisting the selection is best-effort.
      }
    },
    [orgId, setOrgId],
  );

  const disconnectWorkspace = useCallback(async () => {
    if (!disconnectTeamId) return;
    await apiCall("/integrations/slack/disconnect", {
      method: "POST",
      body: JSON.stringify({ teamId: disconnectTeamId }),
    });
    setDisconnectTeamId(null);
    await selectChannel(null);
    await mutate();
  }, [apiCall, disconnectTeamId, mutate, selectChannel]);

  if (installCode) {
    return (
      <Flex align="center" justify="center" p="5" style={{ minHeight: "60vh" }}>
        <Frame style={{ maxWidth: 520, width: "100%" }}>
          <Flex direction="column" gap="4">
            <Box>
              <Heading as="h1" size="lg" mb="2">
                Connect Slack to GrowthBook
              </Heading>
              <Text as="p" color="text-mid" mb="0">
                Confirm which GrowthBook organization should own this Slack
                workspace.
              </Text>
            </Box>
            <Box>
              <Heading as="h2" size="sm" mb="2">
                {currentOrganizationName}
              </Heading>
              {organizationOptions.length > 1 && (
                <Select
                  label="Organization"
                  value={orgId || ""}
                  setValue={switchInstallOrganization}
                >
                  {organizationOptions.map((organization) => (
                    <SelectItem
                      key={organization.value}
                      value={organization.value}
                    >
                      {organization.label}
                    </SelectItem>
                  ))}
                </Select>
              )}
            </Box>
            {!canManageIntegrations && (
              <Callout status="warning">
                You cannot manage integrations for this organization. Choose
                another organization or ask an administrator for access.
              </Callout>
            )}
            {connectError && <Callout status="error">{connectError}</Callout>}
            <Flex gap="3">
              <Button
                onClick={confirmAppDirectoryInstall}
                loading={installing}
                disabled={!orgId || !canManageIntegrations}
              >
                Connect to {currentOrganizationName}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setInstallCode(null);
                  setConnectError(null);
                }}
              >
                Cancel
              </Button>
            </Flex>
          </Flex>
        </Frame>
      </Flex>
    );
  }

  if (!canManageIntegrations) {
    return (
      <Box p="5">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </Box>
    );
  }

  return (
    <Box p="5">
      {addChannelTeamId && (
        <AddChannelModal
          teamId={addChannelTeamId}
          onClose={() => setAddChannelTeamId(null)}
          onAdded={async (integration) => {
            setAddChannelTeamId(null);
            await mutate();
            await selectChannel(integration.id);
          }}
        />
      )}
      {disconnectTeamId && (
        <ConfirmDialog
          title="Disconnect Slack Workspace?"
          content="This removes the workspace and all of its channel connections from GrowthBook."
          yesText="Disconnect"
          onConfirm={disconnectWorkspace}
          onCancel={() => setDisconnectTeamId(null)}
        />
      )}

      <Flex direction="column" gap="4">
        <Flex
          direction={{ initial: "column", sm: "row" }}
          justify="between"
          align="start"
          gap="4"
        >
          <Box>
            <Heading as="h1" size="lg" mb="2">
              Slack
            </Heading>
            <Text as="p" color="text-mid" mb="0">
              Connect Slack channels and choose which GrowthBook events each
              channel receives.
            </Text>
          </Box>
          {data?.oauthConfigured && workspaceGroups.length > 0 && (
            <Button
              icon={<FaSlack />}
              onClick={() => connectToSlack()}
              loading={connecting}
              variant="outline"
            >
              Connect another workspace
            </Button>
          )}
        </Flex>

        {connectedMessage && (
          <Callout status="success">{connectedMessage}</Callout>
        )}
        {connectError && <Callout status="error">{connectError}</Callout>}
        {loadError && (
          <Callout status="error">
            Failed to load Slack connections: {loadError.message}
          </Callout>
        )}
        {data && !data.oauthConfigured && (
          <Callout status="warning">
            Slack OAuth is not configured. Set <code>SLACK_CLIENT_ID</code> and{" "}
            <code>SLACK_CLIENT_SECRET</code> for an app with the{" "}
            <code>chat:write</code>, <code>channels:read</code>,{" "}
            <code>groups:read</code>, and <code>channels:join</code> bot scopes.
            A Slack signing secret is not required for outgoing notifications.
          </Callout>
        )}

        {!data && !loadError ? (
          <Frame>
            <Text color="text-mid">Loading Slack connections…</Text>
          </Frame>
        ) : workspaceGroups.length === 0 ? (
          <Frame>
            <Flex direction="column" align="center" gap="3" p="5">
              <Heading as="h2" size="sm" mb="0">
                No Slack Workspace Connected
              </Heading>
              <Text color="text-mid" align="center">
                Connect a workspace, then add the channels GrowthBook should
                notify.
              </Text>
              {data?.oauthConfigured && (
                <Button icon={<FaSlack />} onClick={() => connectToSlack()}>
                  Connect to Slack
                </Button>
              )}
            </Flex>
          </Frame>
        ) : (
          <Frame>
            <Flex align="stretch">
              <Flex
                direction="column"
                gap="4"
                p="3"
                style={{
                  width: 280,
                  flex: "none",
                  borderRight: "1px solid var(--gray-a4)",
                }}
              >
                {workspaceGroups.map((group) => (
                  <Box key={group.teamId}>
                    <Flex justify="between" align="center" gap="2" mb="2">
                      <Box style={{ minWidth: 0 }}>
                        <Text size="sm" weight="semibold" truncate>
                          {getSlackWorkspaceLabel(group.workspace)}
                        </Text>
                        <Box mt="1">
                          <Badge
                            label={
                              workspaceNeedsReconnect(group.workspace)
                                ? "Reconnect needed"
                                : "Connected"
                            }
                            color={
                              workspaceNeedsReconnect(group.workspace)
                                ? "amber"
                                : "green"
                            }
                            variant="soft"
                          />
                        </Box>
                      </Box>
                      <Flex gap="1">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<PiPlus />}
                          onClick={() => setAddChannelTeamId(group.teamId)}
                        >
                          Add channel
                        </Button>
                      </Flex>
                    </Flex>
                    <Flex gap="2" mb="3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => connectToSlack(group.teamId)}
                        loading={connecting}
                      >
                        Reconnect
                      </Button>
                      <Button
                        variant="outline"
                        color="red"
                        size="sm"
                        icon={<PiPlugs />}
                        onClick={() => setDisconnectTeamId(group.teamId)}
                      >
                        Disconnect
                      </Button>
                    </Flex>
                    <Flex direction="column" gap="1">
                      {group.channels.map((channel) => {
                        const selected = channel.id === selectedChannel?.id;
                        return (
                          <Link
                            key={channel.id}
                            href={`/integrations/slack?channel=${encodeURIComponent(
                              channel.id,
                            )}`}
                            shallow
                            underline="none"
                            color="dark"
                            aria-current={selected ? "page" : undefined}
                            style={{
                              display: "block",
                              padding: "var(--space-2) var(--space-3)",
                              borderRadius: 8,
                              background: selected
                                ? "var(--violet-a3)"
                                : undefined,
                            }}
                          >
                            <Flex align="center" gap="2">
                              <Text
                                size="md"
                                weight={selected ? "semibold" : "medium"}
                                truncate
                              >
                                {getSlackChannelLabel(channel)}
                              </Text>
                              {!channel.enabled && (
                                <Box ml="auto">
                                  <Badge
                                    label="Disabled"
                                    color="gray"
                                    variant="soft"
                                  />
                                </Box>
                              )}
                            </Flex>
                          </Link>
                        );
                      })}
                      {group.channels.length === 0 && (
                        <Text size="sm" color="text-mid">
                          No channels yet
                        </Text>
                      )}
                    </Flex>
                  </Box>
                ))}
              </Flex>

              <Box p="5" style={{ flex: 1, minWidth: 0 }}>
                {selectedChannel ? (
                  <SlackChannelSettings
                    key={selectedChannel.id}
                    integration={selectedChannel}
                    onSaved={async () => {
                      await mutate();
                    }}
                    onDeleted={async () => {
                      await selectChannel(null);
                      await mutate();
                    }}
                  />
                ) : (
                  <Flex direction="column" align="start" gap="3">
                    <Heading as="h2" size="sm" mb="0">
                      Add a Channel
                    </Heading>
                    <Text color="text-mid">
                      Choose a workspace and add the first channel to start
                      receiving notifications.
                    </Text>
                    <Button
                      icon={<PiPlus />}
                      onClick={() =>
                        setAddChannelTeamId(
                          selectedWorkspaceGroup?.teamId ||
                            workspaceGroups[0]?.teamId ||
                            null,
                        )
                      }
                    >
                      Add channel
                    </Button>
                  </Flex>
                )}
              </Box>
            </Flex>
          </Frame>
        )}
      </Flex>
    </Box>
  );
};

export default SlackIntegrationsPage;
