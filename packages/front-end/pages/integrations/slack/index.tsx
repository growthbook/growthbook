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
import { ago } from "shared/dates";
import {
  SLACK_EVENT_OPTIONS,
  SlackEventCategory,
  selectedSlackOptionIds,
  isSlackSubscriptionCustomized,
  resolveExperimentDigest,
  resolveFeatureDigest,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { PiArrowsClockwise, PiGearSix, PiPlus, PiTrash } from "react-icons/pi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Badge from "@/ui/Badge";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SelectField from "@/components/Forms/SelectField";
import { Select, SelectItem } from "@/ui/Select";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

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

const getSlackChannelLabel = (i: SlackOAuthIntegrationInterface) => {
  const name = i.slack?.channelName;
  // Prefix the resolved name with "#" (once) so it reads like Slack; leave the
  // channel-id / webhook-name fallbacks as-is.
  if (name) return name.startsWith("#") ? name : `#${name}`;
  return i.slack?.channelId || i.name;
};

const getSlackWorkspaceLabel = (i: SlackOAuthIntegrationInterface) =>
  i.slack?.teamName ||
  i.slack?.teamId ||
  i.slack?.enterpriseName ||
  i.slack?.enterpriseId ||
  "Unknown workspace";

const CATEGORY_LABELS: Record<SlackEventCategory, string> = {
  experiment: "Experiments",
  feature: "Feature flags",
};

// Which notification categories are on, for the compact list summary.
const enabledCategories = (
  i: SlackOAuthIntegrationInterface,
): SlackEventCategory[] => {
  const selected = selectedSlackOptionIds(i.events);
  return (["experiment", "feature"] as SlackEventCategory[]).filter((c) =>
    SLACK_EVENT_OPTIONS.some((o) => o.category === c && selected.has(o.id)),
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

  const deleteIntegration = useCallback(
    async (slackIntegration: SlackOAuthIntegrationInterface) => {
      const isWorkspace = !slackIntegration.slack?.channelId;
      const message = isWorkspace
        ? `Disconnect the ${getSlackWorkspaceLabel(
            slackIntegration,
          )} Slack workspace? Existing channel connections keep working, but you won't be able to add new channels until you reconnect.`
        : `Delete the Slack integration for ${getSlackChannelLabel(
            slackIntegration,
          )}?`;
      if (!window.confirm(message)) {
        return;
      }
      await apiCall(`/integrations/slack/${slackIntegration.id}`, {
        method: "DELETE",
      });
      await mutate();
    },
    [apiCall, mutate],
  );

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

  return (
    <div className="container-fluid pagecontents">
      {addChannelTeamId && (
        <AddChannelModal
          teamId={addChannelTeamId}
          onClose={() => setAddChannelTeamId(null)}
          onAdded={async (integration) => {
            await mutate();
            await router.push(`/integrations/slack/${integration.id}`);
          }}
        />
      )}

      {installStatus === "done" && (
        <Callout status="success" mb="4">
          Your Slack workspace is now connected. Add a channel to choose what it
          gets notified about.
        </Callout>
      )}

      <Flex direction="column" gap="5">
        <Flex justify="between" align="start" gap="4" wrap="wrap">
          <Box>
            <Flex align="center" gap="2" mb="2">
              <Badge label="Beta" color="violet" variant="soft" />
              <Heading as="h1" size="large">
                Slack
              </Heading>
            </Flex>
            <Text as="p" color="text-mid" mb="0">
              Connect your Slack workspace, then add channels for GrowthBook
              notifications and the assistant. Open a channel to configure what
              it&rsquo;s notified about.
            </Text>
          </Box>

          <Button
            icon={<FaSlack />}
            onClick={connectToSlack}
            loading={connecting}
            disabled={!data?.oauthConfigured}
          >
            {workspaces.length > 0
              ? "Connect another workspace"
              : "Connect to Slack"}
          </Button>
        </Flex>

        {data && !data.oauthConfigured && (
          <Callout status="warning">
            Slack OAuth is not configured. Set SLACK_CLIENT_ID and
            SLACK_CLIENT_SECRET on the GrowthBook API server.
          </Callout>
        )}

        {connectError && <Callout status="error">{connectError}</Callout>}

        {connecting && (
          <Callout status="info">
            Connecting Slack and creating the Event Webhook.
          </Callout>
        )}

        {loadError && (
          <Callout status="error">
            Failed to load Slack integrations: {loadError.message}
          </Callout>
        )}

        {loadingIntegrations && (
          <Callout status="info">Loading Slack integrations.</Callout>
        )}

        {!loadingIntegrations && !loadError && (
          <>
            {/* Workspace connections: token holders + the add-channel entry
                point. Channels below are configured individually. */}
            {workspaces.length > 0 && (
              <Flex direction="column" gap="3">
                {workspaces.map((workspace) => {
                  const grantedScopes = (workspace.slack?.scope || "")
                    .split(",")
                    .map((s) => s.trim());
                  const needsReconnect = REQUIRED_WORKSPACE_SCOPES.some(
                    (s) => !grantedScopes.includes(s),
                  );
                  return (
                    <Flex
                      key={workspace.id}
                      justify="between"
                      align="center"
                      gap="3"
                      wrap="wrap"
                      p="4"
                      style={{
                        border: "1px solid var(--gray-a5)",
                        borderRadius: 8,
                      }}
                    >
                      <Flex align="center" gap="3">
                        <FaSlack size={20} />
                        <Box>
                          <Text weight="medium" as="div">
                            {getSlackWorkspaceLabel(workspace)}
                          </Text>
                          <Text size="small" color="text-mid" as="div">
                            Workspace connected
                          </Text>
                        </Box>
                        {needsReconnect && (
                          <Badge
                            label="Reconnect needed"
                            color="orange"
                            variant="soft"
                            title="This connection is missing newer Slack permissions used to list and join channels."
                          />
                        )}
                      </Flex>
                      <Flex gap="2" align="center">
                        {needsReconnect && (
                          <Button
                            variant="outline"
                            onClick={connectToSlack}
                            loading={connecting}
                          >
                            Reconnect
                          </Button>
                        )}
                        <Button
                          icon={<PiPlus />}
                          onClick={() =>
                            setAddChannelTeamId(workspace.slack?.teamId || null)
                          }
                        >
                          Add channel
                        </Button>
                        <Button
                          variant="outline"
                          color="red"
                          icon={<PiTrash />}
                          aria-label={`Disconnect ${getSlackWorkspaceLabel(
                            workspace,
                          )}`}
                          onClick={() => deleteIntegration(workspace)}
                        >
                          Disconnect
                        </Button>
                      </Flex>
                    </Flex>
                  );
                })}
              </Flex>
            )}

            {slackIntegrations.length === 0 ? (
              <Box p="4" style={{ border: "1px solid var(--gray-a5)" }}>
                <Flex direction="column" gap="3" align="start">
                  <Heading as="h2" size="small">
                    No Slack workspace connected
                  </Heading>
                  <Text color="text-mid">
                    Connect your Slack workspace, then add the channels
                    GrowthBook should post to.
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
              </Box>
            ) : channelIntegrations.length === 0 ? (
              <Box p="4" style={{ border: "1px solid var(--gray-a5)" }}>
                <Flex direction="column" gap="3" align="start">
                  <Heading as="h2" size="small">
                    No channels yet
                  </Heading>
                  <Text color="text-mid">
                    Add a channel to start receiving GrowthBook notifications.
                  </Text>
                  {workspaces.length > 0 && (
                    <Button
                      icon={<PiPlus />}
                      onClick={() =>
                        setAddChannelTeamId(workspaces[0].slack?.teamId || null)
                      }
                    >
                      Add channel
                    </Button>
                  )}
                </Flex>
              </Box>
            ) : (
              <Table variant="list">
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>Channel</TableColumnHeader>
                    <TableColumnHeader>Workspace</TableColumnHeader>
                    <TableColumnHeader>Notifications</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                    <TableColumnHeader>Last run</TableColumnHeader>
                    <TableColumnHeader style={{ width: 170 }} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channelIntegrations.map((slackIntegration) => {
                    const categories = enabledCategories(slackIntegration);
                    const customized = isSlackSubscriptionCustomized(
                      slackIntegration.events,
                    );
                    const experimentDigestOn =
                      resolveExperimentDigest(slackIntegration.slackOptions)
                        .frequency !== "off";
                    const featureDigestOn =
                      resolveFeatureDigest(slackIntegration.slackOptions)
                        .frequency !== "off";
                    return (
                      <TableRow key={slackIntegration.id}>
                        <TableCell>
                          <LinkButton
                            href={`/integrations/slack/${slackIntegration.id}`}
                            variant="ghost"
                          >
                            {getSlackChannelLabel(slackIntegration)}
                          </LinkButton>
                        </TableCell>
                        <TableCell>
                          {getSlackWorkspaceLabel(slackIntegration)}
                        </TableCell>
                        <TableCell>
                          <Flex gap="2" wrap="wrap">
                            {categories.length === 0 ? (
                              <Text color="text-mid" size="small">
                                None
                              </Text>
                            ) : (
                              categories.map((c) => (
                                <Badge
                                  key={c}
                                  label={CATEGORY_LABELS[c]}
                                  color="blue"
                                  variant="soft"
                                />
                              ))
                            )}
                            {customized && (
                              <Badge
                                label="Customized"
                                color="gray"
                                variant="soft"
                                title="Event list differs from the recommended defaults"
                              />
                            )}
                            {experimentDigestOn && (
                              <Badge
                                label="Experiment digest"
                                color="violet"
                                variant="soft"
                              />
                            )}
                            {featureDigestOn && (
                              <Badge
                                label="Feature digest"
                                color="violet"
                                variant="soft"
                              />
                            )}
                          </Flex>
                        </TableCell>
                        <TableCell>
                          <Badge
                            label={
                              slackIntegration.enabled ? "Enabled" : "Disabled"
                            }
                            color={slackIntegration.enabled ? "green" : "gray"}
                            variant="soft"
                          />
                        </TableCell>
                        <TableCell>
                          {slackIntegration.lastRunAt
                            ? ago(slackIntegration.lastRunAt)
                            : "No runs"}
                        </TableCell>
                        <TableCell>
                          <Flex gap="2" justify="end">
                            <LinkButton
                              href={`/integrations/slack/${slackIntegration.id}`}
                              variant="outline"
                              color="gray"
                              icon={<PiGearSix />}
                            >
                              Manage
                            </LinkButton>
                            <Button
                              variant="outline"
                              color="red"
                              icon={<PiTrash />}
                              aria-label={`Delete ${getSlackChannelLabel(
                                slackIntegration,
                              )}`}
                              onClick={() =>
                                deleteIntegration(slackIntegration)
                              }
                            >
                              Delete
                            </Button>
                          </Flex>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </Flex>
    </div>
  );
};

export default SlackIntegrationsPage;
