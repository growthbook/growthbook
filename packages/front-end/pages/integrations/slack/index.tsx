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
import {
  SLACK_EVENT_OPTIONS,
  SlackEventCategory,
  selectedSlackOptionIds,
  resolveExperimentDigest,
  resolveFeatureDigest,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { PiArrowsClockwise, PiPlus } from "react-icons/pi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import SlackChannelSettings, {
  getSlackChannelLabel,
} from "@/components/SlackIntegrations/SlackChannelSettings";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SelectField from "@/components/Forms/SelectField";
import { Select, SelectItem } from "@/ui/Select";

type SlackIntegrationsResponse = {
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

// Scopes a workspace connection needs for the add-channel flow. Older installs
// missing any of these get a Reconnect prompt. Keep in sync with
// SLACK_OAUTH_SCOPE (back-end slackIntegration.ts).
const REQUIRED_WORKSPACE_SCOPES = [
  "channels:read",
  "groups:read",
  "channels:join",
];

const getQueryStringValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

// One-line rail summary of what a channel hears: its project scope plus which
// subjects (experiments / flags) are on — or "digest only" when no live events
// are selected but a digest is scheduled.
const useChannelScopeSummary = () => {
  const { projects } = useDefinitions();
  return useCallback(
    (i: SlackOAuthIntegrationInterface): string => {
      const projectPart = !i.projects?.length
        ? "All projects"
        : i.projects.length === 1
          ? `${
              projects.find((p) => p.id === i.projects[0])?.name ||
              i.projects[0]
            } only`
          : `${i.projects.length} projects`;

      const selected = selectedSlackOptionIds(i.events);
      const cats = (["experiment", "feature"] as SlackEventCategory[]).filter(
        (c) =>
          SLACK_EVENT_OPTIONS.some(
            (o) => o.category === c && selected.has(o.id),
          ),
      );
      const digestOn =
        resolveExperimentDigest(i.slackOptions).frequency !== "off" ||
        resolveFeatureDigest(i.slackOptions).frequency !== "off";

      const subjectPart =
        cats.length === 2
          ? "exp + flags"
          : cats.length === 1
            ? cats[0] === "experiment"
              ? "experiments"
              : "flags"
            : digestOn
              ? "digest only"
              : "no events";

      return `${projectPart} · ${subjectPart}`;
    },
    [projects],
  );
};

// Searchable channel picker for a connected workspace. Public channels are
// joinable directly; private channels only appear once the bot has been
// /invited in Slack (conversations.list semantics).
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
        const res = await apiCall<{
          channels: SlackChannelOption[];
          nextCursor: string | null;
        }>(
          `/integrations/slack/channels?teamId=${encodeURIComponent(teamId)}${
            cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
          }`,
        );
        setChannels((prev) =>
          cursor ? [...prev, ...res.channels] : res.channels,
        );
        setNextCursor(res.nextCursor);
      } catch (e) {
        setLoadError(
          e instanceof Error ? e.message : "Failed to load Slack channels.",
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
    () => new Set(channels.filter((c) => c.alreadyConnected).map((c) => c.id)),
    [channels],
  );

  const options = useMemo(
    () =>
      channels.map((c) => ({
        label: `#${c.name}${c.isPrivate ? " (private)" : ""}${
          c.alreadyConnected ? " — already connected" : ""
        }`,
        value: c.id,
      })),
    [channels],
  );

  return (
    <ModalStandard
      trackingEventModalType="slack-add-channel"
      open={true}
      header="Add a Slack channel"
      cta="Add channel"
      ctaEnabled={!!selected && !connectedIds.has(selected)}
      submit={async () => {
        const res = await apiCall<{
          slackIntegration: SlackOAuthIntegrationInterface;
        }>("/integrations/slack/channels", {
          method: "POST",
          body: JSON.stringify({ teamId, channelId: selected }),
        });
        await onAdded(res.slackIntegration);
      }}
      close={onClose}
    >
      <Text as="p" color="text-mid" mb="3">
        GrowthBook joins the channel and posts the notifications you configure.
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
        options={options}
        onChange={setSelected}
        isSearchable
        isOptionDisabled={(o) => "value" in o && connectedIds.has(o.value)}
        disabled={loading && channels.length === 0}
      />

      <Flex gap="3" align="center" mt="2" wrap="wrap">
        <Button
          variant="ghost"
          size="xs"
          icon={<PiArrowsClockwise />}
          loading={loading}
          onClick={() => fetchChannels()}
        >
          Refresh
        </Button>
        {nextCursor && (
          <Button
            variant="ghost"
            size="xs"
            loading={loading}
            onClick={() => fetchChannels(nextCursor)}
          >
            Load more channels
          </Button>
        )}
      </Flex>

      <Text as="p" size="small" color="text-mid" mt="3" mb="0">
        Don&rsquo;t see a private channel? Run <code>/invite @GrowthBook</code>{" "}
        in that channel in Slack, then refresh.
      </Text>
    </ModalStandard>
  );
}

const SlackIntegrationsPage: NextPage = () => {
  const permissionsUtils = usePermissionsUtil();
  const router = useRouter();
  const { apiCall, orgId, organizations, setOrgId } = useAuth();
  const callbackProcessed = useRef(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const scopeSummary = useChannelScopeSummary();

  // Slack-initiated install (App Directory "Add to Slack"): `code` with no
  // GrowthBook `state`. We don't know which org the user means, so we hold the
  // code and show an explicit org-confirmation screen instead of attaching.
  const [installCode, setInstallCode] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<
    "confirming" | "connecting" | "done" | "error"
  >("confirming");
  const [installError, setInstallError] = useState<string | null>(null);
  const installInFlight = useRef(false);

  // Add-channel picker: which workspace (teamId) it's open for, if any.
  const [addChannelTeamId, setAddChannelTeamId] = useState<string | null>(null);

  // Slot at the bottom of the page card that the detail pane portals its
  // sticky save bar into (so the bar spans the full card width).
  const [saveBarHost, setSaveBarHost] = useState<HTMLDivElement | null>(null);

  // The channel shown in the detail pane. Synced with ?channel= so deep links
  // (and the old /integrations/slack/[id] URLs) land on the right channel.
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );

  const {
    data,
    mutate,
    error: loadError,
  } = useApi<SlackIntegrationsResponse>("/integrations/slack");

  const slackIntegrations = useMemo(
    () => data?.slackIntegrations || [],
    [data?.slackIntegrations],
  );
  // Workspace connections (channel-less docs from workspace-level installs)
  // vs per-channel connections.
  const workspaces = useMemo(
    () =>
      slackIntegrations.filter((i) => i.slack?.teamId && !i.slack?.channelId),
    [slackIntegrations],
  );
  const channelIntegrations = useMemo(
    () => slackIntegrations.filter((i) => !!i.slack?.channelId),
    [slackIntegrations],
  );
  const loadingIntegrations = !data && !loadError;

  // Resolve the selected channel: explicit selection when it still exists,
  // else the first channel.
  const selectedChannel = useMemo(
    () =>
      channelIntegrations.find((i) => i.id === selectedChannelId) ||
      channelIntegrations[0],
    [channelIntegrations, selectedChannelId],
  );

  const selectChannel = useCallback(
    (id: string | null) => {
      setSelectedChannelId(id);
      router.replace(
        id ? `/integrations/slack?channel=${id}` : "/integrations/slack",
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  // Sync selection from ?channel= (deep links / [id] redirects). Re-selecting
  // via the rail round-trips through the URL to the same value, so this is a
  // no-op for in-page selection changes.
  useEffect(() => {
    if (!router.isReady) return;
    const channel = getQueryStringValue(router.query.channel);
    if (channel) setSelectedChannelId(channel);
  }, [router.isReady, router.query.channel]);

  useEffect(() => {
    if (!router.isReady || callbackProcessed.current) return;

    const slackError = getQueryStringValue(router.query.error);
    if (slackError) {
      callbackProcessed.current = true;
      setConnectError(`Slack authorization failed: ${slackError}`);
      router.replace("/integrations/slack", undefined, { shallow: true });
      return;
    }

    const code = getQueryStringValue(router.query.code);
    const state = getQueryStringValue(router.query.state);
    if (!code) return;

    // No state → Slack-initiated install: stash the code for the confirm screen.
    if (!state) {
      callbackProcessed.current = true;
      setInstallCode(code);
      setInstallStatus("confirming");
      router.replace("/integrations/slack", undefined, { shallow: true });
      return;
    }

    callbackProcessed.current = true;
    setConnecting(true);
    setConnectError(null);

    apiCall<{ slackIntegration: SlackOAuthIntegrationInterface }>(
      "/integrations/slack/oauth-callback",
      {
        method: "POST",
        body: JSON.stringify({ code, state }),
      },
    )
      .then(async (res) => {
        await mutate();
        await router.replace("/integrations/slack", undefined, {
          shallow: true,
        });
        // Workspace-level install (no channel picked on Slack's consent
        // screen) — go straight to picking the first channel.
        const ws = res.slackIntegration;
        if (ws?.slack?.teamId && !ws.slack.channelId) {
          setAddChannelTeamId(ws.slack.teamId);
        }
      })
      .catch((e) => {
        setConnectError(e.message);
      })
      .finally(() => {
        setConnecting(false);
      });
  }, [apiCall, mutate, router]);

  const connectToSlack = useCallback(async () => {
    setConnectError(null);
    const response = await apiCall<{ url: string }>(
      "/integrations/slack/connect",
      { method: "POST" },
    );
    window.location.href = response.url;
  }, [apiCall]);

  const installOrgOptions = useMemo(
    () =>
      (organizations || []).map((o) => ({
        value: o.id,
        label: o.name || o.id,
      })),
    [organizations],
  );
  const currentOrgName =
    installOrgOptions.find((o) => o.value === orgId)?.label || orgId || "—";

  const onSwitchInstallOrg = useCallback(
    (newOrgId: string) => {
      if (!setOrgId || !newOrgId || newOrgId === orgId) return;
      setOrgId(newOrgId);
      try {
        localStorage.setItem("gb-last-picked-org", `"${newOrgId}"`);
      } catch (e) {
        console.warn("Unable to save last org in localStorage");
      }
    },
    [orgId, setOrgId],
  );

  const confirmInstall = useCallback(async () => {
    if (!installCode || installInFlight.current) return;
    installInFlight.current = true;
    setInstallStatus("connecting");
    setInstallError(null);
    try {
      const res = await apiCall<{
        slackIntegration: SlackOAuthIntegrationInterface;
      }>("/integrations/slack/oauth-install", {
        method: "POST",
        body: JSON.stringify({ code: installCode }),
      });
      await mutate();
      setInstallStatus("done");
      // Workspace-level install — prompt for the first channel right away.
      const ws = res.slackIntegration;
      if (ws?.slack?.teamId && !ws.slack.channelId) {
        setAddChannelTeamId(ws.slack.teamId);
      }
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
      setInstallStatus("error");
    } finally {
      installInFlight.current = false;
    }
  }, [apiCall, installCode, mutate]);

  // Slack-initiated install: show the org-confirmation screen in place of the
  // management page until the user confirms (or it's done).
  if (installCode && installStatus !== "done") {
    return (
      <div className="container-fluid pagecontents">
        <Flex
          align="center"
          justify="center"
          px="4"
          style={{ minHeight: "60vh" }}
        >
          <Box style={{ maxWidth: 520, width: "100%" }}>
            {installStatus === "connecting" ? (
              <Flex direction="column" align="center" gap="3">
                <Heading as="h1" size="medium" align="center" mb="0">
                  Connecting…
                </Heading>
                <Text as="p" color="text-mid" align="center">
                  Linking your Slack workspace to {currentOrgName}.
                </Text>
              </Flex>
            ) : (
              <Flex direction="column" gap="4">
                <Box>
                  <Heading as="h1" size="large" mb="2">
                    Connect Slack to GrowthBook
                  </Heading>
                  <Text as="p" color="text-mid">
                    You added the GrowthBook app from Slack. Choose which
                    GrowthBook organization to connect this Slack workspace to.
                  </Text>
                </Box>

                <Box
                  p="4"
                  style={{
                    border: "1px solid var(--slate-a5)",
                    borderRadius: 8,
                    background: "var(--color-panel-solid)",
                  }}
                >
                  <Text size="small" color="text-mid" as="p" mb="1">
                    Connecting to
                  </Text>
                  <Heading as="h2" size="medium" mb="2">
                    {currentOrgName}
                  </Heading>
                  {installOrgOptions.length > 1 && (
                    <Box mt="3">
                      <Select
                        label="Organization"
                        value={orgId || ""}
                        setValue={onSwitchInstallOrg}
                      >
                        {installOrgOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </Select>
                    </Box>
                  )}
                </Box>

                {installError && (
                  <Callout status="error">{installError}</Callout>
                )}

                <Flex gap="3" align="center">
                  <Button onClick={confirmInstall}>
                    Connect to {currentOrgName}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setInstallCode(null);
                      setInstallError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </Flex>
              </Flex>
            )}
          </Box>
        </Flex>
      </div>
    );
  }

  if (!permissionsUtils.canManageIntegrations()) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  const connected = slackIntegrations.length > 0;
  // Docs representing the team: workspace connections when present, else the
  // channel docs of a legacy (pre-workspace-install) org.
  const teamDocs = workspaces.length ? workspaces : channelIntegrations;
  // A connection missing newer scopes can't list/join channels — surface a
  // reconnect hint by the connection status. (The Connect button reconnects.)
  const workspaceNeedsReconnect = teamDocs.some((w) => {
    const granted = (w.slack?.scope || "").split(",").map((s) => s.trim());
    return REQUIRED_WORKSPACE_SCOPES.some((s) => !granted.includes(s));
  });
  // Team the add-channel flow targets — the back-end accepts any same-team
  // doc as the credentials source, so legacy installs work too.
  const addChannelTarget = teamDocs[0]?.slack?.teamId || null;

  return (
    <div className="container-fluid pagecontents">
      {addChannelTeamId && (
        <AddChannelModal
          teamId={addChannelTeamId}
          onClose={() => setAddChannelTeamId(null)}
          onAdded={async (integration) => {
            await mutate();
            selectChannel(integration.id);
          }}
        />
      )}

      {installStatus === "done" && (
        <Callout status="success" mb="4">
          Your Slack workspace is now connected. Add a channel to choose what it
          gets notified about.
        </Callout>
      )}

      {connectError && (
        <Callout status="error" mb="4">
          {connectError}
        </Callout>
      )}

      {connecting && (
        <Callout status="info" mb="4">
          Connecting Slack and creating the Event Webhook.
        </Callout>
      )}

      {data && !data.oauthConfigured && (
        <Callout status="warning" mb="4">
          Slack OAuth is not configured. Set SLACK_CLIENT_ID and
          SLACK_CLIENT_SECRET on the GrowthBook API server.
        </Callout>
      )}

      {loadError && (
        <Callout status="error" mb="4">
          Failed to load Slack integrations: {loadError.message}
        </Callout>
      )}

      <Box className="appbox" mb="0">
        {/* Integration header */}
        <Flex
          justify="between"
          align="start"
          gap="4"
          wrap="wrap"
          p="5"
          style={{ borderBottom: "1px solid var(--gray-a4)" }}
        >
          <Box style={{ maxWidth: 640 }}>
            <Flex align="center" gap="2" mb="2">
              <Badge label="Beta" color="violet" variant="soft" />
              <Heading as="h1" size="large" mb="0">
                Slack
              </Heading>
            </Flex>
            <Text as="p" color="text-mid" mb="0">
              Connect Slack channels to GrowthBook notifications and the
              assistant. Open a channel to configure what it&rsquo;s notified
              about.
            </Text>
          </Box>

          <Flex align="center" gap="3" style={{ flexShrink: 0 }}>
            {connected && (
              <Flex align="center" gap="2">
                <Box
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: workspaceNeedsReconnect
                      ? "var(--amber-9)"
                      : "var(--green-9)",
                  }}
                />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: workspaceNeedsReconnect
                      ? "var(--amber-11)"
                      : "var(--green-11)",
                  }}
                >
                  {workspaceNeedsReconnect
                    ? "Reconnect needed"
                    : "Connected to Slack"}
                </span>
              </Flex>
            )}
            <Button
              icon={<FaSlack />}
              onClick={connectToSlack}
              loading={connecting}
              disabled={!data?.oauthConfigured}
              variant={
                connected && !workspaceNeedsReconnect ? "outline" : "solid"
              }
            >
              {connected ? "Reconnect" : "Connect to Slack"}
            </Button>
          </Flex>
        </Flex>

        {/* Body: channel rail + detail */}
        {loadingIntegrations ? (
          <Box p="5">
            <Text color="text-mid">Loading Slack integrations…</Text>
          </Box>
        ) : !connected ? (
          <Flex direction="column" gap="3" align="center" p="8">
            <Heading as="h2" size="small" mb="0">
              No Slack workspace connected
            </Heading>
            <Text color="text-mid" align="center">
              Connect your Slack workspace, then add the channels GrowthBook
              should post to.
            </Text>
            <Button
              icon={<FaSlack />}
              onClick={connectToSlack}
              loading={connecting}
              disabled={!data?.oauthConfigured}
            >
              Connect to Slack
            </Button>
          </Flex>
        ) : (
          <Flex align="stretch">
            {/* Channel rail */}
            <Flex
              direction="column"
              gap="1"
              p="3"
              style={{
                width: 250,
                flex: "none",
                borderRight: "1px solid var(--gray-a4)",
              }}
            >
              <Flex justify="between" align="center" px="2" pb="2">
                <span
                  style={{
                    textTransform: "uppercase",
                    letterSpacing: ".09em",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--color-text-mid)",
                  }}
                >
                  Channels · {channelIntegrations.length}
                </span>
                {addChannelTarget && (
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label="Add channel"
                    onClick={() => setAddChannelTeamId(addChannelTarget)}
                  >
                    <PiPlus />
                  </Button>
                )}
              </Flex>

              {channelIntegrations.map((channel) => {
                const isSelected = channel.id === selectedChannel?.id;
                return (
                  <Box
                    key={channel.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectChannel(channel.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        selectChannel(channel.id);
                      }
                    }}
                    px="3"
                    py="2"
                    style={{
                      borderRadius: 8,
                      cursor: "pointer",
                      background: isSelected ? "var(--violet-a3)" : undefined,
                      opacity: channel.enabled ? 1 : 0.6,
                    }}
                  >
                    <Flex align="center" gap="2">
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: isSelected ? 600 : 500,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          minWidth: 0,
                        }}
                      >
                        {getSlackChannelLabel(channel)}
                      </span>
                      {!channel.enabled && (
                        <Box ml="auto" style={{ flexShrink: 0 }}>
                          <Badge label="Disabled" color="gray" variant="soft" />
                        </Box>
                      )}
                    </Flex>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-mid)",
                        paddingLeft: 14,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {scopeSummary(channel)}
                    </div>
                  </Box>
                );
              })}

              {addChannelTarget && (
                <Box mt="2">
                  <Button
                    variant="outline"
                    color="violet"
                    icon={<PiPlus />}
                    style={{
                      width: "100%",
                      borderStyle: "dashed",
                      justifyContent: "flex-start",
                    }}
                    onClick={() => setAddChannelTeamId(addChannelTarget)}
                  >
                    Add channel
                  </Button>
                </Box>
              )}
              {!addChannelTarget && (
                <Text size="small" color="text-mid" mt="2" as="div">
                  Reconnect to Slack to add channels from here.
                </Text>
              )}
            </Flex>

            {/* Channel detail */}
            <Box p="5" style={{ flex: 1, minWidth: 0 }}>
              {selectedChannel ? (
                <SlackChannelSettings
                  key={selectedChannel.id}
                  integration={selectedChannel}
                  onSaved={async () => {
                    await mutate();
                  }}
                  onDeleted={async () => {
                    await mutate();
                    selectChannel(null);
                  }}
                  saveBarHost={saveBarHost}
                  // Rail width (250) + the detail pane's own padding, so the
                  // Save button lines up with the detail column's left edge.
                  saveBarInsetLeft="calc(250px + var(--space-5))"
                />
              ) : (
                <Flex direction="column" gap="3" align="start" p="4">
                  <Heading as="h2" size="small" mb="0">
                    No channels yet
                  </Heading>
                  <Text color="text-mid">
                    Add a channel to start receiving GrowthBook notifications.
                  </Text>
                  {addChannelTarget && (
                    <Button
                      icon={<PiPlus />}
                      onClick={() => setAddChannelTeamId(addChannelTarget)}
                    >
                      Add channel
                    </Button>
                  )}
                </Flex>
              )}
            </Box>
          </Flex>
        )}

        {/* Full-width slot the detail pane portals its save bar into, so the
            bar spans the rail + detail columns. Sticky lives HERE (this div's
            parent, the card, is tall) — sticky on the bar itself would have no
            room to move inside this bar-height slot. */}
        <div
          ref={setSaveBarHost}
          style={{ position: "sticky", bottom: 0, zIndex: 1 }}
        />
      </Box>
    </div>
  );
};

export default SlackIntegrationsPage;
