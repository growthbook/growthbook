import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import { EventWebHookInterface } from "shared/types/event-webhook";
import {
  EVENT_WEBHOOK_DEFAULT_COALESCE_WINDOW_MS,
  defaultSlackEventSubscriptions,
} from "shared/validators";
import {
  APP_ORIGIN,
  JWT_SECRET,
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
} from "back-end/src/util/secrets";
import { ReqContext } from "back-end/types/request";
import {
  createEventWebHook,
  deleteEventWebHookById,
  EventWebHookModel,
  findSlackWorkspaceEventWebhook,
  getAllEventWebHooks,
  getEventWebHookById,
  getSlackBotAccessTokenForWebhook,
  propagateSlackTeamCredentials,
  reconnectSlackEventWebhook,
  setSlackWorkspaceFlag,
  updateSlackChannelName,
} from "back-end/src/models/EventWebhookModel";
import { deleteCoalesceBucketsForWebhook } from "back-end/src/models/EventWebHookCoalesceBucketModel";
import {
  getSlackConversationName,
  joinSlackConversation,
  listSlackConversations,
} from "back-end/src/services/slack/slackWebApi";
import { logger } from "back-end/src/util/logger";
import { fetch } from "back-end/src/util/http.util";

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";
// Workspace-level install — no incoming-webhook scope, so Slack shows no
// channel picker on consent; channels are added from the GrowthBook UI.
// app_mentions:read: receive @-mentions. *:history: receive plain thread
// follow-ups without a mention. channels:read/groups:read: list channels and
// resolve renames (conversations.list/info). channels:join: the bot joins
// public channels picked in the UI. Rest cover slash commands, chat:write
// delivery, file uploads, and users:read*.
const SLACK_OAUTH_SCOPE =
  "commands,chat:write,files:write,users:read,users:read.email,app_mentions:read,channels:read,groups:read,channels:join,channels:history,groups:history,im:history,mpim:history,links:read";
const SLACK_OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
// Fresh installs subscribe to the curated default set (explicit event names,
// no wildcards) so the low-signal suppression gate is bypassed. Editable on the
// Slack settings page afterward.
const DEFAULT_SLACK_EVENTS = defaultSlackEventSubscriptions();
// Workspace-level installs have no incoming-webhook URL; the model requires a
// url, so store a placeholder. Delivery code never POSTs it — everything goes
// through the bot token, guarded by isSlackIncomingWebhookUrl.
const SLACK_PLACEHOLDER_URL = "https://slack.com";

const slackOAuthStateSchema = z
  .object({
    orgId: z.string(),
    userId: z.string(),
    nonce: z.string(),
    createdAt: z.number(),
  })
  .strict();

const slackOAuthAccessSuccessSchema = z
  .object({
    ok: z.literal(true),
    app_id: z.string().optional(),
    access_token: z.string().optional(),
    token_type: z.string().optional(),
    scope: z.string().optional(),
    bot_user_id: z.string().optional(),
    team: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .nullable()
      .optional(),
    enterprise: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .nullable()
      .optional(),
    authed_user: z
      .object({
        id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    // Only present when the app still requests the incoming-webhook scope
    // (legacy manifest / per-channel installs). Workspace-level installs omit
    // it; when present its shape is still validated strictly.
    incoming_webhook: z
      .object({
        channel: z.string().optional(),
        channel_id: z.string().optional(),
        configuration_url: z.string().url().optional(),
        url: z.string().url().startsWith("https://hooks.slack.com/services/"),
      })
      .strict()
      .optional(),
    is_enterprise_install: z.boolean().optional(),
  })
  .passthrough();

const slackOAuthAccessErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
  })
  .passthrough();

const slackOAuthAccessResponseSchema = z.union([
  slackOAuthAccessSuccessSchema,
  slackOAuthAccessErrorSchema,
]);

type SlackOAuthAccessSuccess = z.infer<typeof slackOAuthAccessSuccessSchema>;

export const isSlackOAuthConfigured = () =>
  !!SLACK_CLIENT_ID && !!SLACK_CLIENT_SECRET;

export const getSlackOAuthRedirectUri = () =>
  `${APP_ORIGIN}/integrations/slack`;

const signSlackOAuthState = (payload: string) =>
  createHmac("sha256", JWT_SECRET).update(payload).digest("base64url");

const encodeSlackOAuthState = ({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) => {
  const payload = Buffer.from(
    JSON.stringify({
      orgId,
      userId,
      nonce: randomBytes(16).toString("base64url"),
      createdAt: Date.now(),
    }),
  ).toString("base64url");

  return `${payload}.${signSlackOAuthState(payload)}`;
};

const assertSlackOAuthState = ({
  state,
  context,
}: {
  state: string;
  context: ReqContext;
}) => {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) {
    throw new Error("Invalid Slack OAuth state");
  }

  const expected = signSlackOAuthState(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid Slack OAuth state");
  }

  const parsed = slackOAuthStateSchema.safeParse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
  );
  if (!parsed.success) {
    throw new Error("Invalid Slack OAuth state");
  }

  if (Date.now() - parsed.data.createdAt > SLACK_OAUTH_STATE_MAX_AGE_MS) {
    throw new Error("Slack OAuth state expired");
  }

  if (
    parsed.data.orgId !== context.org.id ||
    parsed.data.userId !== context.userId
  ) {
    throw new Error("Slack OAuth state does not match the current user");
  }
};

export const getSlackOAuthAuthorizeUrl = (context: ReqContext) => {
  if (!isSlackOAuthConfigured()) {
    throw new Error("Slack OAuth is not configured");
  }

  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set("client_id", SLACK_CLIENT_ID);
  url.searchParams.set("scope", SLACK_OAUTH_SCOPE);
  url.searchParams.set("redirect_uri", getSlackOAuthRedirectUri());
  url.searchParams.set(
    "state",
    encodeSlackOAuthState({
      orgId: context.org.id,
      userId: context.userId,
    }),
  );

  return url.toString();
};

const exchangeSlackOAuthCode = async (
  code: string,
): Promise<SlackOAuthAccessSuccess> => {
  if (!isSlackOAuthConfigured()) {
    throw new Error("Slack OAuth is not configured");
  }

  const response = await fetch(SLACK_OAUTH_ACCESS_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${SLACK_CLIENT_ID}:${SLACK_CLIENT_SECRET}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      redirect_uri: getSlackOAuthRedirectUri(),
    }).toString(),
  });

  const responseBody: unknown = await response.json();
  const parsed = slackOAuthAccessResponseSchema.safeParse(responseBody);

  if (!parsed.success) {
    throw new Error("Slack returned an invalid OAuth response");
  }

  if (!response.ok) {
    throw new Error(`Slack OAuth exchange failed: ${response.statusText}`);
  }

  if (!parsed.data.ok) {
    throw new Error(`Slack OAuth exchange failed: ${parsed.data.error}`);
  }

  return parsed.data;
};

const getSlackMetadata = (slackOAuthResponse: SlackOAuthAccessSuccess) => ({
  appId: slackOAuthResponse.app_id,
  teamId: slackOAuthResponse.team?.id,
  teamName: slackOAuthResponse.team?.name,
  enterpriseId: slackOAuthResponse.enterprise?.id,
  enterpriseName: slackOAuthResponse.enterprise?.name,
  channelName: slackOAuthResponse.incoming_webhook?.channel,
  channelId: slackOAuthResponse.incoming_webhook?.channel_id,
  configurationUrl: slackOAuthResponse.incoming_webhook?.configuration_url,
  botUserId: slackOAuthResponse.bot_user_id,
  authedUserId: slackOAuthResponse.authed_user?.id,
  scope: slackOAuthResponse.scope,
  isEnterpriseInstall: slackOAuthResponse.is_enterprise_install,
});

const persistSlackBotAccessToken = async ({
  eventWebHookId,
  organizationId,
  accessToken,
}: {
  eventWebHookId: string;
  organizationId: string;
  accessToken?: string;
}) => {
  if (!accessToken) return;

  await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId },
    { $set: { "slack.botAccessToken": accessToken } },
  );
};

const getSlackWebhookName = (slackOAuthResponse: SlackOAuthAccessSuccess) => {
  const team = slackOAuthResponse.team?.name;
  if (!slackOAuthResponse.incoming_webhook) {
    return team ? `Slack workspace (${team})` : "Slack workspace";
  }
  const channel =
    slackOAuthResponse.incoming_webhook.channel || "Slack channel";
  return team ? `Slack ${channel} (${team})` : `Slack ${channel}`;
};

const findExistingSlackEventWebhook = async ({
  context,
  slackOAuthResponse,
}: {
  context: ReqContext;
  slackOAuthResponse: SlackOAuthAccessSuccess;
}) => {
  const teamId = slackOAuthResponse.team?.id;
  const channelId = slackOAuthResponse.incoming_webhook?.channel_id;

  if (!teamId || !channelId) return null;

  const eventWebHooks = await getAllEventWebHooks(context.org.id);
  return (
    eventWebHooks.find(
      (eventWebHook) =>
        eventWebHook.payloadType === "slack" &&
        eventWebHook.slack?.teamId === teamId &&
        eventWebHook.slack?.channelId === channelId,
    ) || null
  );
};

export const slackEventWebhookToIntegration = (
  eventWebHook: EventWebHookInterface,
): SlackOAuthIntegrationInterface => ({
  id: eventWebHook.id,
  eventWebHookId: eventWebHook.id,
  name: eventWebHook.name,
  dateCreated: eventWebHook.dateCreated,
  dateUpdated: eventWebHook.dateUpdated,
  enabled: eventWebHook.enabled,
  events: eventWebHook.events,
  projects: eventWebHook.projects,
  experiments: eventWebHook.experiments,
  metrics: eventWebHook.metrics,
  features: eventWebHook.features,
  environments: eventWebHook.environments,
  tags: eventWebHook.tags,
  coalesceWindowMs: eventWebHook.coalesceWindowMs,
  slackOptions: eventWebHook.slackOptions,
  lastRunAt: eventWebHook.lastRunAt,
  lastState: eventWebHook.lastState,
  slack: eventWebHook.slack,
});

export const getSlackOAuthIntegrations = async (
  context: ReqContext,
): Promise<SlackOAuthIntegrationInterface[]> => {
  const eventWebHooks = await getAllEventWebHooks(context.org.id);

  const integrations = eventWebHooks
    .filter((eventWebHook) => eventWebHook.payloadType === "slack")
    .map(slackEventWebhookToIntegration);

  // Resolve each channel's live name (handles renames / missing names),
  // caching a changed name back for future loads. Best-effort and fully
  // error-isolated so one failure can't reject the batch and 500 the list.
  // Bounded concurrency below keeps conversations.info under Slack's rate limit.
  const resolveChannelName = async (
    integration: SlackOAuthIntegrationInterface,
  ) => {
    try {
      const channelId = integration.slack?.channelId;
      if (!channelId) return;
      const token = await getSlackBotAccessTokenForWebhook({
        eventWebHookId: integration.eventWebHookId,
        organizationId: context.org.id,
      });
      if (!token) return;
      const name = await getSlackConversationName({ token, channelId });
      if (!name || name === integration.slack?.channelName) return;
      if (integration.slack) integration.slack.channelName = name;
      await updateSlackChannelName({
        eventWebHookId: integration.eventWebHookId,
        organizationId: context.org.id,
        channelName: name,
      });
    } catch (e) {
      logger.warn(
        e,
        `Failed resolving Slack channel name for webhook ${integration.eventWebHookId}`,
      );
    }
  };

  const CHANNEL_NAME_CONCURRENCY = 5;
  for (let i = 0; i < integrations.length; i += CHANNEL_NAME_CONCURRENCY) {
    await Promise.all(
      integrations
        .slice(i, i + CHANNEL_NAME_CONCURRENCY)
        .map(resolveChannelName),
    );
  }

  return integrations;
};

/**
 * Exchange a Slack OAuth `code` and attach (or update) the Slack connection on
 * `context.org`. Shared core for both install paths; assumes the caller has
 * already authorized the attach (see {@link connectSlackOAuthIntegration} and
 * {@link connectSlackOAuthInstallFromSession}).
 */
const attachSlackOAuthCode = async ({
  context,
  code,
}: {
  context: ReqContext;
  code: string;
}) => {
  const slackOAuthResponse = await exchangeSlackOAuthCode(code);

  // Workspace-level install (current manifest, no incoming-webhook scope):
  // no channel was picked on Slack's consent screen — attach a channel-less
  // workspace connection; channels are added afterward from the GrowthBook UI.
  if (!slackOAuthResponse.incoming_webhook) {
    return attachSlackWorkspaceInstall({ context, slackOAuthResponse });
  }

  // Legacy per-channel install (manifest still has the incoming-webhook
  // scope): Slack picked a channel and minted a webhook URL for it.
  const existing = await findExistingSlackEventWebhook({
    context,
    slackOAuthResponse,
  });

  if (existing) {
    // Refresh url + metadata in one write; only overwrite the stored bot token
    // if Slack returned a new one (otherwise the existing token is preserved).
    await reconnectSlackEventWebhook({
      eventWebHookId: existing.id,
      organizationId: context.org.id,
      url: slackOAuthResponse.incoming_webhook.url,
      slack: getSlackMetadata(slackOAuthResponse),
      botAccessToken: slackOAuthResponse.access_token,
    });

    const updated = await getEventWebHookById(existing.id, context.org.id);
    if (!updated) {
      throw new Error("Unable to load updated Slack integration");
    }

    return slackEventWebhookToIntegration(updated);
  }

  const created = await createEventWebHook({
    name: getSlackWebhookName(slackOAuthResponse),
    url: slackOAuthResponse.incoming_webhook.url,
    organizationId: context.org.id,
    enabled: true,
    events: DEFAULT_SLACK_EVENTS,
    projects: [],
    experiments: [],
    metrics: [],
    tags: [],
    environments: [],
    payloadType: "slack",
    method: "POST",
    headers: {},
    slack: getSlackMetadata(slackOAuthResponse),
    coalesceWindowMs: EVENT_WEBHOOK_DEFAULT_COALESCE_WINDOW_MS,
    slackOptions: {
      experimentCardFormat: "compact",
      digest: { frequency: "off" },
    },
  });
  await persistSlackBotAccessToken({
    eventWebHookId: created.id,
    organizationId: context.org.id,
    accessToken: slackOAuthResponse.access_token,
  });

  const updated = await getEventWebHookById(created.id, context.org.id);
  return slackEventWebhookToIntegration(updated || created);
};

// Attach a workspace-level install: one channel-less, DISABLED EventWebHook
// doc per team+org holding the bot token + team metadata. Disabled keeps it
// out of the event fan-out and digest scans — it exists to hold credentials
// (and to route the assistant) until channels are added from the UI.
const attachSlackWorkspaceInstall = async ({
  context,
  slackOAuthResponse,
}: {
  context: ReqContext;
  slackOAuthResponse: SlackOAuthAccessSuccess;
}) => {
  const teamId = slackOAuthResponse.team?.id;
  if (!teamId) {
    throw new Error(
      "Slack did not return a workspace id. Install the GrowthBook app into a specific workspace (org-wide enterprise installs are not supported).",
    );
  }

  const existing = await findSlackWorkspaceEventWebhook({
    organizationId: context.org.id,
    teamId,
  });

  let eventWebHookId: string;
  if (existing) {
    await reconnectSlackEventWebhook({
      eventWebHookId: existing.id,
      organizationId: context.org.id,
      slack: getSlackMetadata(slackOAuthResponse),
      botAccessToken: slackOAuthResponse.access_token,
      enabled: false,
    });
    eventWebHookId = existing.id;
  } else {
    const created = await createEventWebHook({
      name: getSlackWebhookName(slackOAuthResponse),
      url: SLACK_PLACEHOLDER_URL,
      organizationId: context.org.id,
      enabled: false,
      events: DEFAULT_SLACK_EVENTS,
      projects: [],
      experiments: [],
      metrics: [],
      tags: [],
      environments: [],
      payloadType: "slack",
      method: "POST",
      headers: {},
      slack: getSlackMetadata(slackOAuthResponse),
      coalesceWindowMs: EVENT_WEBHOOK_DEFAULT_COALESCE_WINDOW_MS,
      slackOptions: {
        experimentCardFormat: "compact",
        digest: { frequency: "off" },
      },
    });
    await persistSlackBotAccessToken({
      eventWebHookId: created.id,
      organizationId: context.org.id,
      accessToken: slackOAuthResponse.access_token,
    });
    eventWebHookId = created.id;
  }

  // Channel docs no longer get their own OAuth exchange — push the fresh
  // token + scope onto every same-team doc so they keep delivering and their
  // settings-page reconnect banner clears.
  await propagateSlackTeamCredentials({
    organizationId: context.org.id,
    teamId,
    botAccessToken: slackOAuthResponse.access_token,
    scope: slackOAuthResponse.scope,
  });

  const updated = await getEventWebHookById(eventWebHookId, context.org.id);
  if (!updated) {
    throw new Error("Unable to load Slack workspace connection");
  }
  return slackEventWebhookToIntegration(updated);
};

/**
 * GrowthBook-initiated install ("Connect to Slack" in-app): verify the signed
 * `state` tying this callback to the same user/org before attaching.
 */
export const connectSlackOAuthIntegration = async ({
  context,
  code,
  state,
}: {
  context: ReqContext;
  code: string;
  state: string;
}) => {
  assertSlackOAuthState({ state, context });
  return attachSlackOAuthCode({ context, code });
};

/**
 * Slack-initiated install (App Directory): Slack returns a `code` with no
 * GrowthBook `state`, so there's no signed state to verify. Authorization is
 * instead established by the caller — logged-in user, explicit in-app org
 * confirmation, and a `canManageIntegrations` check in the controller. Mirrors
 * how the visual-editor extension attaches to an org.
 */
export const connectSlackOAuthInstallFromSession = async ({
  context,
  code,
}: {
  context: ReqContext;
  code: string;
}) => {
  return attachSlackOAuthCode({ context, code });
};

export const deleteSlackOAuthIntegration = async ({
  context,
  id,
}: {
  context: ReqContext;
  id: string;
}) => {
  const eventWebHook = await getEventWebHookById(id, context.org.id);

  if (!eventWebHook || eventWebHook.payloadType !== "slack") {
    return false;
  }

  // Drop in-flight coalesce buckets so the next flush doesn't deliver to a
  // now-deleted webhook.
  await deleteCoalesceBucketsForWebhook({
    organizationId: context.org.id,
    eventWebHookId: eventWebHook.id,
  });

  return deleteEventWebHookById({
    eventWebHookId: eventWebHook.id,
    organizationId: context.org.id,
  });
};

// Disconnect a whole Slack workspace: remove its channel-less connection doc
// AND every channel doc for that team. GrowthBook-side only — to fully revoke
// access the user also removes the app from Slack's "Manage apps".
export const disconnectSlackWorkspace = async ({
  context,
  teamId,
}: {
  context: ReqContext;
  teamId?: string;
}): Promise<{ deleted: number }> => {
  const slackDocs = (await getAllEventWebHooks(context.org.id)).filter(
    (w) => w.payloadType === "slack",
  );
  const teams = new Set(
    slackDocs.map((w) => w.slack?.teamId).filter((t): t is string => !!t),
  );
  const target = teamId ?? (teams.size === 1 ? [...teams][0] : undefined);
  if (!target) {
    throw new Error(
      teams.size
        ? "Multiple Slack workspaces are connected — specify which one."
        : "No Slack workspace connection found.",
    );
  }

  let deleted = 0;
  for (const doc of slackDocs.filter((w) => w.slack?.teamId === target)) {
    if (await deleteSlackOAuthIntegration({ context, id: doc.id })) deleted++;
  }
  return { deleted };
};

// Toggle a workspace-wide Slack option (assistant, link unfurling) on/off.
// Resolves the target team (defaulting to the only connected one) and writes the
// flag to every same-team doc so it reads consistently. Notifications are
// unaffected.
export const setSlackWorkspaceOption = async ({
  context,
  teamId,
  field,
  enabled,
}: {
  context: ReqContext;
  teamId?: string;
  field: "assistantEnabled" | "unfurlEnabled";
  enabled: boolean;
}): Promise<{ enabled: boolean }> => {
  const slackDocs = (await getAllEventWebHooks(context.org.id)).filter(
    (w) => w.payloadType === "slack",
  );
  const teams = new Set(
    slackDocs.map((w) => w.slack?.teamId).filter((t): t is string => !!t),
  );
  const target = teamId ?? (teams.size === 1 ? [...teams][0] : undefined);
  if (!target) {
    throw new Error(
      teams.size
        ? "Multiple Slack workspaces are connected — specify which one."
        : "No Slack workspace connection found.",
    );
  }
  await setSlackWorkspaceFlag({
    organizationId: context.org.id,
    teamId: target,
    field,
    enabled,
  });
  return { enabled };
};

// Resolve the org's workspace connection (channel-less doc) and its bot token.
// `teamId` selects between multiple connected workspaces; it may be omitted
// when the org has exactly one.
const resolveSlackWorkspace = async ({
  context,
  teamId,
}: {
  context: ReqContext;
  teamId?: string;
}) => {
  const eventWebHooks = await getAllEventWebHooks(context.org.id);
  const slackWebhooks = eventWebHooks.filter((w) => w.payloadType === "slack");
  const workspaceDocs = slackWebhooks.filter(
    (w) => w.slack?.teamId && !w.slack?.channelId,
  );
  // Legacy installs predate the channel-less workspace doc — any same-team
  // channel doc works as the team/credentials source (the bot token lookup
  // falls back across the team's docs).
  const teamDocs = workspaceDocs.length
    ? workspaceDocs
    : slackWebhooks.filter((w) => w.slack?.teamId);
  const distinctTeams = new Set(teamDocs.map((w) => w.slack?.teamId));
  const workspace = teamId
    ? teamDocs.find((w) => w.slack?.teamId === teamId)
    : distinctTeams.size === 1
      ? teamDocs[0]
      : undefined;
  if (!workspace) {
    throw new Error(
      distinctTeams.size > 1 && !teamId
        ? "Multiple Slack workspaces are connected — specify which one."
        : "No Slack workspace connection found. Connect to Slack first.",
    );
  }
  const token = await getSlackBotAccessTokenForWebhook({
    eventWebHookId: workspace.id,
    organizationId: context.org.id,
  });
  if (!token) {
    throw new Error(
      "Slack bot token unavailable. Reconnect the Slack workspace.",
    );
  }
  return { workspace, token, slackWebhooks };
};

export type SlackChannelOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  alreadyConnected: boolean;
};

/**
 * Channels available to connect in the org's Slack workspace, for the
 * add-channel picker. Private channels only appear once the bot has been
 * /invited (conversations.list semantics). Caps at ~5 pages per request;
 * `nextCursor` lets the UI fetch more.
 */
export const listSlackWorkspaceChannels = async ({
  context,
  teamId,
  cursor,
}: {
  context: ReqContext;
  teamId?: string;
  cursor?: string;
}): Promise<{
  channels: SlackChannelOption[];
  nextCursor: string | null;
  teamId: string;
}> => {
  const { workspace, token, slackWebhooks } = await resolveSlackWorkspace({
    context,
    teamId,
  });
  const wsTeamId = workspace.slack?.teamId as string;

  const connected = new Set(
    slackWebhooks
      .filter((w) => w.slack?.teamId === wsTeamId && w.slack?.channelId)
      .map((w) => w.slack?.channelId),
  );

  const channels: SlackChannelOption[] = [];
  let nextCursor: string | null = cursor || null;
  for (let page = 0; page < 5; page++) {
    const res = await listSlackConversations({
      token,
      cursor: nextCursor || undefined,
    });
    if (!res) throw new Error("Failed to list Slack channels");
    channels.push(
      ...res.channels.map((c) => ({
        ...c,
        alreadyConnected: connected.has(c.id),
      })),
    );
    nextCursor = res.nextCursor;
    if (!nextCursor) break;
  }
  channels.sort((a, b) => a.name.localeCompare(b.name));

  return { channels, nextCursor, teamId: wsTeamId };
};

/**
 * Connect a channel picked in the GrowthBook UI: join it (public channels;
 * private ones require a prior /invite) and create its per-channel
 * EventWebHook doc with the workspace's team metadata + bot token copied on.
 * Idempotent — an already-connected channel returns its existing connection.
 */
export const addSlackChannelToWorkspace = async ({
  context,
  teamId,
  channelId,
}: {
  context: ReqContext;
  teamId?: string;
  channelId: string;
}): Promise<SlackOAuthIntegrationInterface> => {
  const { workspace, token, slackWebhooks } = await resolveSlackWorkspace({
    context,
    teamId,
  });
  const wsTeamId = workspace.slack?.teamId as string;

  const existing = slackWebhooks.find(
    (w) => w.slack?.teamId === wsTeamId && w.slack?.channelId === channelId,
  );
  if (existing) return slackEventWebhookToIntegration(existing);

  // Find the channel (name / privacy / membership) in the workspace list.
  let channel:
    | { id: string; name: string; isPrivate: boolean; isMember: boolean }
    | undefined;
  let cursor: string | undefined;
  for (let page = 0; page < 5 && !channel; page++) {
    const res = await listSlackConversations({ token, cursor });
    if (!res) break;
    channel = res.channels.find((c) => c.id === channelId);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  if (!channel) {
    // Deep pagination fallback: resolve the name directly and attempt a join.
    const name = await getSlackConversationName({ token, channelId });
    if (!name) throw new Error("Slack channel not found in this workspace");
    channel = { id: channelId, name, isPrivate: false, isMember: false };
  }

  if (!channel.isMember) {
    if (channel.isPrivate) {
      throw new Error(
        `GrowthBook can't join private channels itself. In Slack, run /invite @GrowthBook in #${channel.name}, then try again.`,
      );
    }
    const join = await joinSlackConversation({ token, channelId });
    if (!join.ok) {
      throw new Error(
        `Couldn't join #${channel.name}: ${join.error}. If it's a private channel, run /invite @GrowthBook in it first.`,
      );
    }
  }

  const created = await createEventWebHook({
    name: workspace.slack?.teamName
      ? `Slack #${channel.name} (${workspace.slack.teamName})`
      : `Slack #${channel.name}`,
    url: SLACK_PLACEHOLDER_URL,
    organizationId: context.org.id,
    enabled: true,
    events: DEFAULT_SLACK_EVENTS,
    projects: [],
    experiments: [],
    metrics: [],
    tags: [],
    environments: [],
    payloadType: "slack",
    method: "POST",
    headers: {},
    slack: {
      ...workspace.slack,
      channelId: channel.id,
      channelName: channel.name,
    },
    coalesceWindowMs: EVENT_WEBHOOK_DEFAULT_COALESCE_WINDOW_MS,
    slackOptions: {
      experimentCardFormat: "compact",
      digest: { frequency: "off" },
    },
  });
  // Copy the workspace bot token onto the channel doc so per-doc token reads
  // keep working even if the workspace connection is later deleted.
  await persistSlackBotAccessToken({
    eventWebHookId: created.id,
    organizationId: context.org.id,
    accessToken: token,
  });

  const updated = await getEventWebHookById(created.id, context.org.id);
  return slackEventWebhookToIntegration(updated || created);
};
