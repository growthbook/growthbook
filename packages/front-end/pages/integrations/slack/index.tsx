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
  resolveSlackDigest,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { PiGearSix, PiTrash } from "react-icons/pi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Badge from "@/ui/Badge";
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

const getQueryStringValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getSlackChannelLabel = (i: SlackOAuthIntegrationInterface) =>
  i.slack?.channelName || i.slack?.channelId || i.name;

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

const DIGEST_BADGE_LABELS: Record<string, string> = {
  daily: "Daily digest",
  weekly: "Weekly digest",
  monthly: "Monthly digest",
  quarterly: "Quarterly digest",
  custom: "Custom digest",
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

const SlackIntegrationsPage: NextPage = () => {
  const permissionsUtils = usePermissionsUtil();
  const router = useRouter();
  const { apiCall, orgId, organizations, setOrgId } = useAuth();
  const callbackProcessed = useRef(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Slack-initiated install (App Directory "Add to Slack"): Slack returns a
  // `code` with no GrowthBook `state`. Unlike the in-app "Connect" flow, we
  // can't silently attach — we don't know which org the user means — so we
  // hold the code and show an explicit org-confirmation screen.
  const [installCode, setInstallCode] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<
    "confirming" | "connecting" | "done" | "error"
  >("confirming");
  const [installError, setInstallError] = useState<string | null>(null);
  const installInFlight = useRef(false);

  const {
    data,
    mutate,
    error: loadError,
  } = useApi<SlackIntegrationsResponse>("/integrations/slack");

  const slackIntegrations = useMemo(
    () => data?.slackIntegrations || [],
    [data?.slackIntegrations],
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

    // No state → Slack-initiated install. Stash the code and show the
    // org-confirmation screen instead of attaching silently.
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
      .then(async () => {
        await mutate();
        await router.replace("/integrations/slack", undefined, {
          shallow: true,
        });
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
      await apiCall("/integrations/slack/oauth-install", {
        method: "POST",
        body: JSON.stringify({ code: installCode }),
      });
      await mutate();
      setInstallStatus("done");
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
      setInstallStatus("error");
    } finally {
      installInFlight.current = false;
    }
  }, [apiCall, installCode, mutate]);

  const deleteIntegration = useCallback(
    async (slackIntegration: SlackOAuthIntegrationInterface) => {
      if (
        !window.confirm(
          `Delete the Slack integration for ${getSlackChannelLabel(
            slackIntegration,
          )}?`,
        )
      ) {
        return;
      }
      await apiCall(`/integrations/slack/${slackIntegration.id}`, {
        method: "DELETE",
      });
      await mutate();
    },
    [apiCall, mutate],
  );

  // Slack-initiated install: an explicit org-confirmation screen, shown in
  // place of the normal management page until the user confirms (or it's done).
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
      {installStatus === "done" && (
        <Callout status="success" mb="4">
          Your Slack workspace is now connected. Open it below to choose what it
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
              Connect Slack channels to GrowthBook notifications and the
              assistant. Open a channel to configure what it&rsquo;s notified
              about.
            </Text>
          </Box>

          <Button
            icon={<FaSlack />}
            onClick={connectToSlack}
            loading={connecting}
            disabled={!data?.oauthConfigured}
          >
            Connect to Slack
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
            {slackIntegrations.length === 0 ? (
              <Box p="4" style={{ border: "1px solid var(--gray-a5)" }}>
                <Flex direction="column" gap="3" align="start">
                  <Heading as="h2" size="small">
                    No Slack channels connected
                  </Heading>
                  <Text color="text-mid">
                    Connect a channel to create a Slack Event Webhook. You can
                    add more channels by running the Slack connection flow
                    again.
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
                  {slackIntegrations.map((slackIntegration) => {
                    const categories = enabledCategories(slackIntegration);
                    const digest = resolveSlackDigest(
                      slackIntegration.slackOptions,
                      {
                        dailyDigestHourUtc: slackIntegration.dailyDigestHourUtc,
                      },
                    );
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
                            {digest.frequency !== "off" && (
                              <Badge
                                label={
                                  DIGEST_BADGE_LABELS[digest.frequency] ||
                                  "Digest"
                                }
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
