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
  resolveSlackAssistantEnabled,
  resolveSlackUnfurlEnabled,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { PiArrowsClockwise, PiPlus, PiPlugsConnected } from "react-icons/pi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { getApiHost, getAppOrigin, isCloud } from "@/services/env";
import Code from "@/components/SyntaxHighlighting/Code";
import { useDefinitions } from "@/services/DefinitionsContext";
import SlackChannelSettings, {
  getSlackChannelLabel,
} from "@/components/SlackIntegrations/SlackChannelSettings";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import ConfirmDialog from "@/ui/ConfirmDialog";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Switch from "@/ui/Switch";
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

// --- Self-hosted setup: Slack app manifest ---------------------------------

// Slack's "Create New App" dashboard. Admins choose "From a manifest" and paste
// the pre-filled YAML below.
const SLACK_CREATE_APP_URL = "https://api.slack.com/apps?new_app=1";

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

// Full manifest (notifications + AI assistant), pre-filled with this instance's
// app + API URLs so a self-hosted admin can paste it into Slack's "Create app
// from a manifest" flow without editing anything. Kept in sync with the
// self-hosted section of docs/docs/integrations/slack.mdx.
function buildSlackAppManifest({
  appUrl,
  apiUrl,
  appDomain,
}: {
  appUrl: string;
  apiUrl: string;
  appDomain: string;
}): string {
  return `display_information:
  name: GrowthBook
  description: GrowthBook notifications and the GrowthBook AI assistant
features:
  bot_user:
    display_name: GrowthBook
    always_online: true
  slash_commands:
    - command: /growthbook
      url: ${apiUrl}/integrations/slack/commands
      description: Query experiments and manage this channel's subscriptions
      usage_hint: list | subscribe | status <experiment-id> | results <experiment-id>
      should_escape: false
oauth_config:
  redirect_urls:
    - ${appUrl}/integrations/slack
  scopes:
    bot:
      - chat:write
      - files:write
      - channels:read
      - groups:read
      - channels:join
      - commands
      - users:read
      - users:read.email
      - app_mentions:read
      - channels:history
      - groups:history
      - im:history
      - mpim:history
      - links:read
      - links:write
settings:
  event_subscriptions:
    request_url: ${apiUrl}/integrations/slack/events
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
      - message.mpim
      - link_shared
    unfurl_domains:
      - ${appDomain}
  interactivity:
    is_enabled: true
    request_url: ${apiUrl}/integrations/slack/interactions
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false`;
}

function SlackManifestModal({ onClose }: { onClose: () => void }) {
  const manifest = useMemo(() => {
    const appUrl = trimTrailingSlash(getAppOrigin());
    const apiUrl = trimTrailingSlash(getApiHost());
    let appDomain = "your-growthbook-domain";
    try {
      appDomain = new URL(appUrl).host;
    } catch {
      // getAppOrigin() should always be a valid URL; fall back to a placeholder.
    }
    return buildSlackAppManifest({ appUrl, apiUrl, appDomain });
  }, []);

  return (
    <ModalStandard
      trackingEventModalType="slack-app-manifest"
      open={true}
      size="lg"
      header="Set up the GrowthBook Slack app"
      close={onClose}
      closeCta="Done"
      secondaryAction={
        <Button
          variant="outline"
          icon={<FaSlack />}
          onClick={() => window.open(SLACK_CREATE_APP_URL, "_blank")}
        >
          Open Slack app dashboard
        </Button>
      }
    >
      <Text as="p" color="text-mid" mb="3">
        Self-hosted GrowthBook connects through your own Slack app. This
        manifest is pre-filled with this instance&rsquo;s URLs — no editing
        required.
      </Text>
      <ol style={{ paddingLeft: "1.2rem", margin: "0 0 1rem" }}>
        <li>
          <Text>
            In Slack, open{" "}
            <strong>Your Apps → Create New App → From a manifest</strong> and
            pick your workspace.
          </Text>
        </li>
        <li>
          <Text>Paste the manifest below and create the app.</Text>
        </li>
        <li>
          <Text>
            Under <strong>Basic Information → App Credentials</strong>, copy the
            Client ID, Client Secret, and Signing Secret into{" "}
            <code>SLACK_CLIENT_ID</code>, <code>SLACK_CLIENT_SECRET</code>, and{" "}
            <code>SLACK_SIGNING_SECRET</code> on your API server.
          </Text>
        </li>
        <li>
          <Text>Restart GrowthBook and reload this page to connect.</Text>
        </li>
      </ol>
      <Code
        code={manifest}
        language="yml"
        filename="growthbook-slack-manifest.yml"
      />
      <Callout status="info" mt="3">
        Slack verifies the event URLs with a signed challenge that needs{" "}
        <code>SLACK_SIGNING_SECRET</code> set first. If creating the app fails
        URL verification, remove the <code>event_subscriptions</code> and{" "}
        <code>interactivity</code> blocks, finish the steps above, then add them
        back and reinstall.
      </Callout>
    </ModalStandard>
  );
}

function SelfHostedSetupPanel({
  onOpenManifest,
}: {
  onOpenManifest: () => void;
}) {
  return (
    <Flex direction="column" gap="3" align="center" p="8">
      <Heading as="h2" size="small" mb="0">
        Finish self-hosted Slack setup
      </Heading>
      <Box style={{ maxWidth: 520 }}>
        <Text color="text-mid" align="center">
          Self-hosted GrowthBook connects through your own Slack app. Create it
          from a pre-filled manifest, set the credentials on your API server,
          and restart to connect.
        </Text>
      </Box>
      <Button icon={<FaSlack />} onClick={onOpenManifest}>
        Set up Slack app
      </Button>
      <Text size="small" color="text-mid" align="center">
        Requires <code>SLACK_CLIENT_ID</code>, <code>SLACK_CLIENT_SECRET</code>,
        and <code>SLACK_SIGNING_SECRET</code> on the API server.
      </Text>
    </Flex>
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
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  // Self-hosted setup: the pre-filled Slack app manifest modal.
  const [showManifest, setShowManifest] = useState(false);
  // Workspace-wide AI assistant toggle: optimistic override while saving + any
  // error to surface.
  const [pendingAssistant, setPendingAssistant] = useState<boolean | null>(
    null,
  );
  const [assistantError, setAssistantError] = useState<string | null>(null);
  // Workspace-wide link-unfurl toggle (same optimistic pattern).
  const [pendingUnfurl, setPendingUnfurl] = useState<boolean | null>(null);
  const [unfurlError, setUnfurlError] = useState<string | null>(null);

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

  // Flip the workspace-wide assistant on/off. Optimistic (pendingAssistant) so
  // the switch responds instantly; cleared once the refetch reflects the write.
  const toggleAssistant = useCallback(
    async (enabled: boolean, teamId: string | null) => {
      setAssistantError(null);
      setPendingAssistant(enabled);
      try {
        await apiCall("/integrations/slack/assistant", {
          method: "POST",
          body: JSON.stringify({ enabled, ...(teamId ? { teamId } : {}) }),
        });
        await mutate();
      } catch (e) {
        setAssistantError(
          e instanceof Error ? e.message : "Failed to update the assistant.",
        );
      } finally {
        setPendingAssistant(null);
      }
    },
    [apiCall, mutate],
  );

  // Flip workspace-wide link unfurling on/off (same optimistic pattern).
  const toggleUnfurl = useCallback(
    async (enabled: boolean, teamId: string | null) => {
      setUnfurlError(null);
      setPendingUnfurl(enabled);
      try {
        await apiCall("/integrations/slack/unfurl", {
          method: "POST",
          body: JSON.stringify({ enabled, ...(teamId ? { teamId } : {}) }),
        });
        await mutate();
      } catch (e) {
        setUnfurlError(
          e instanceof Error ? e.message : "Failed to update link previews.",
        );
      } finally {
        setPendingUnfurl(null);
      }
    },
    [apiCall, mutate],
  );

  // Remove the whole workspace connection + all its channels. `teamId` scopes
  // it to the workspace being disconnected (multi-workspace safe). Throws
  // propagate to the confirm dialog's button, which surfaces the error.
  const disconnectWorkspace = useCallback(
    async (teamId: string | null) => {
      await apiCall("/integrations/slack/disconnect", {
        method: "POST",
        body: JSON.stringify(teamId ? { teamId } : {}),
      });
      await mutate();
      setSelectedChannelId(null);
      setConfirmingDisconnect(false);
    },
    [apiCall, mutate],
  );

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
  // Self-hosted instance whose server env is missing SLACK_CLIENT_ID/SECRET:
  // show the app-manifest setup flow instead of a dead, disabled Connect
  // button. Cloud is always configured, so this is false there.
  const selfHostedUnconfigured = !!data && !data.oauthConfigured && !isCloud();
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

  // Workspace-wide AI assistant toggle. The flag is kept in sync across the
  // team's docs, so any representative doc reflects it. `pendingAssistant` is an
  // optimistic override so the switch flips instantly while the write + refetch
  // settle.
  const assistantEnabled =
    pendingAssistant ?? resolveSlackAssistantEnabled(teamDocs[0]?.slackOptions);
  const unfurlEnabled =
    pendingUnfurl ?? resolveSlackUnfurlEnabled(teamDocs[0]?.slackOptions);

  return (
    <div className="container-fluid pagecontents">
      {showManifest && (
        <SlackManifestModal onClose={() => setShowManifest(false)} />
      )}

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

      {confirmingDisconnect && (
        <ConfirmDialog
          title="Disconnect Slack?"
          content={
            `This removes the Slack connection${
              channelIntegrations.length
                ? ` and ${channelIntegrations.length} channel connection${
                    channelIntegrations.length === 1 ? "" : "s"
                  }`
                : ""
            }. You can reconnect anytime. To fully revoke access, also remove ` +
            "GrowthBook from your Slack workspace's Manage apps."
          }
          yesText="Disconnect"
          onConfirm={() => disconnectWorkspace(addChannelTarget)}
          onCancel={() => setConfirmingDisconnect(false)}
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

      {data && !data.oauthConfigured && isCloud() && (
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
          direction={{ initial: "column", sm: "row" }}
          justify="between"
          align="start"
          gap="4"
          p="5"
          style={{ borderBottom: "1px solid var(--gray-a4)" }}
        >
          <Box style={{ maxWidth: 640, flex: 1 }}>
            <Heading as="h1" size="large" mb="2">
              Slack
            </Heading>
            <Text as="p" color="text-mid" mb="0">
              Connect Slack channels to GrowthBook notifications and the
              assistant. Open a channel to configure what it&rsquo;s notified
              about.
            </Text>
          </Box>

          <Flex align="center" gap="3" style={{ flexShrink: 0 }}>
            {connected && (
              <HelperText
                status={workspaceNeedsReconnect ? "warning" : "success"}
              >
                {workspaceNeedsReconnect
                  ? "Reconnect needed"
                  : "Connected to Slack"}
              </HelperText>
            )}
            {!connected && selfHostedUnconfigured ? (
              <Button icon={<FaSlack />} onClick={() => setShowManifest(true)}>
                Set up Slack
              </Button>
            ) : (
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
            )}
            {connected && (
              <Button
                variant="outline"
                color="red"
                icon={<PiPlugsConnected />}
                onClick={() => setConfirmingDisconnect(true)}
              >
                Disconnect
              </Button>
            )}
          </Flex>
        </Flex>

        {/* AI assistant (workspace-wide) — sits above the per-channel body so
            it reads as a connection-level setting, not a per-channel one. */}
        {connected && (
          <Box p="5" style={{ borderBottom: "1px solid var(--gray-a4)" }}>
            <Flex justify="between" align="center" gap="4" wrap="wrap">
              <Box style={{ maxWidth: 640 }}>
                <Text as="p" weight="medium" mb="1">
                  AI assistant
                </Text>
                <Text as="p" size="small" color="text-mid" mb="0">
                  Let people @mention the bot in Slack to ask about experiments,
                  features, and metrics. Turn this off to run notifications only
                  — cards and digests keep posting either way. Requires AI to be
                  enabled for your organization.
                </Text>
              </Box>
              <Switch
                value={assistantEnabled}
                onChange={(v) => toggleAssistant(v, addChannelTarget)}
                disabled={pendingAssistant !== null}
                label={assistantEnabled ? "On" : "Off"}
              />
            </Flex>
            {assistantError && (
              <Callout status="error" mt="3">
                {assistantError}
              </Callout>
            )}

            <Flex
              justify="between"
              align="center"
              gap="4"
              wrap="wrap"
              mt="4"
              pt="4"
              style={{ borderTop: "1px solid var(--gray-a4)" }}
            >
              <Box style={{ maxWidth: 640 }}>
                <Text as="p" weight="medium" mb="1">
                  Link previews
                </Text>
                <Text as="p" size="small" color="text-mid" mb="0">
                  When someone shares a GrowthBook experiment link in Slack,
                  unfurl it into a short summary (name, goal metric, lift). Turn
                  off to leave shared links untouched. Only shown to people who
                  can view the experiment.
                </Text>
              </Box>
              <Switch
                value={unfurlEnabled}
                onChange={(v) => toggleUnfurl(v, addChannelTarget)}
                disabled={pendingUnfurl !== null}
                label={unfurlEnabled ? "On" : "Off"}
              />
            </Flex>
            {unfurlError && (
              <Callout status="error" mt="3">
                {unfurlError}
              </Callout>
            )}
          </Box>
        )}

        {/* Body: channel rail + detail */}
        {loadingIntegrations ? (
          <Box p="5">
            <Text color="text-mid">Loading Slack integrations…</Text>
          </Box>
        ) : !connected ? (
          selfHostedUnconfigured ? (
            <SelfHostedSetupPanel
              onOpenManifest={() => setShowManifest(true)}
            />
          ) : (
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
          )
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
                <Text
                  size="small"
                  weight="medium"
                  color="text-mid"
                  textTransform="uppercase"
                >
                  Channels · {channelIntegrations.length}
                </Text>
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
                      <Box style={{ minWidth: 0 }}>
                        <Text
                          as="div"
                          size="medium"
                          weight={isSelected ? "semibold" : "medium"}
                          truncate
                        >
                          {getSlackChannelLabel(channel)}
                        </Text>
                      </Box>
                      {!channel.enabled && (
                        <Box ml="auto" style={{ flexShrink: 0 }}>
                          <Badge label="Disabled" color="gray" variant="soft" />
                        </Box>
                      )}
                    </Flex>
                    <Box pl="4">
                      <Text as="div" size="small" color="text-mid" truncate>
                        {scopeSummary(channel)}
                      </Text>
                    </Box>
                  </Box>
                );
              })}

              {addChannelTarget && (
                <Box mt="2">
                  <Button
                    variant="ghost"
                    icon={<PiPlus />}
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
