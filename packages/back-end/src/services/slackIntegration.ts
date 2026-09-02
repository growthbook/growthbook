import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import { EventWebHookInterface } from "shared/types/event-webhook";
import {
  SlackWorkspaceConnectionFrontEndInterface,
  SlackWorkspaceConnectionInterface,
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
  findSlackChannelEventWebhook,
  getAllEventWebHooks,
  getEventWebHookById,
  reconnectSlackEventWebhook,
  updateEventWebHook,
  updateSlackChannelName,
} from "back-end/src/models/EventWebhookModel";
import {
  getSlackConversationName,
  joinSlackConversation,
  listSlackConversations,
  SLACK_WORKSPACE_PLACEHOLDER_URL,
} from "back-end/src/services/slack/slackWebApi";
import { logger } from "back-end/src/util/logger";
import { fetch } from "back-end/src/util/http.util";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import {
  decryptSlackBotToken,
  encryptSlackBotToken,
} from "back-end/src/util/slackToken";

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_OAUTH_SCOPE = "chat:write,channels:read,groups:read,channels:join";
const SLACK_OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_SLACK_EVENTS = ["experiment.*", "feature.*"];

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
    access_token: z.string().min(1),
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
  const parts = state.split(".");
  if (parts.length !== 2) {
    throw new Error("Invalid Slack OAuth state");
  }
  const [payload, signature] = parts;

  const expected = signSlackOAuthState(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid Slack OAuth state");
  }

  let statePayload: unknown;
  try {
    statePayload = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
  } catch {
    throw new Error("Invalid Slack OAuth state");
  }
  const parsed = slackOAuthStateSchema.safeParse(statePayload);
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

const slackWorkspaceConnectionToFrontEnd = (
  connection: SlackWorkspaceConnectionInterface,
): SlackWorkspaceConnectionFrontEndInterface => ({
  teamId: connection.teamId,
  dateCreated: connection.dateCreated,
  dateUpdated: connection.dateUpdated,
  appId: connection.appId,
  teamName: connection.teamName,
  enterpriseId: connection.enterpriseId,
  enterpriseName: connection.enterpriseName,
  botUserId: connection.botUserId,
  authedUserId: connection.authedUserId,
  scope: connection.scope,
  isEnterpriseInstall: connection.isEnterpriseInstall,
});

const upsertSlackWorkspaceConnection = async ({
  context,
  slackOAuthResponse,
}: {
  context: ReqContext;
  slackOAuthResponse: SlackOAuthAccessSuccess;
}): Promise<SlackWorkspaceConnectionInterface> => {
  const teamId = slackOAuthResponse.team?.id;
  if (!teamId) {
    throw new Error("Slack did not return a workspace id");
  }

  return context.models.slackWorkspaceConnections.upsertForTeam(teamId, {
    encryptedBotAccessToken: encryptSlackBotToken(
      slackOAuthResponse.access_token,
    ),
    appId: slackOAuthResponse.app_id,
    teamName: slackOAuthResponse.team?.name,
    enterpriseId: slackOAuthResponse.enterprise?.id,
    enterpriseName: slackOAuthResponse.enterprise?.name,
    botUserId: slackOAuthResponse.bot_user_id,
    authedUserId: slackOAuthResponse.authed_user?.id,
    scope: slackOAuthResponse.scope,
    isEnterpriseInstall: slackOAuthResponse.is_enterprise_install,
  });
};

const getSlackWorkspaceToken = (
  connection: SlackWorkspaceConnectionInterface,
): string => {
  const token = decryptSlackBotToken(connection.encryptedBotAccessToken);
  if (!token) {
    throw new Error(
      "Slack bot token unavailable. Reconnect the Slack workspace.",
    );
  }
  return token;
};

export const getSlackChannelEventWebhookId = ({
  organizationId,
  teamId,
  channelId,
}: {
  organizationId: string;
  teamId: string;
  channelId: string;
}): string =>
  `ewh-slack-${createHash("sha256")
    .update(`${organizationId}\0${teamId}\0${channelId}`)
    .digest("hex")
    .slice(0, 32)}`;

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
  environments: eventWebHook.environments,
  tags: eventWebHook.tags,
  lastRunAt: eventWebHook.lastRunAt,
  lastState: eventWebHook.lastState,
  slack: eventWebHook.slack,
});

export const listSlackOAuthConnections = async (
  context: ReqContext,
): Promise<{
  slackConnections: SlackWorkspaceConnectionFrontEndInterface[];
  slackIntegrations: SlackOAuthIntegrationInterface[];
}> => {
  const [eventWebHooks, connections] = await Promise.all([
    getAllEventWebHooks(context.org.id),
    context.models.slackWorkspaceConnections.getAll(),
  ]);

  const integrations = eventWebHooks
    .filter(
      (eventWebHook) =>
        eventWebHook.payloadType === "slack" &&
        !!eventWebHook.slack?.teamId &&
        !!eventWebHook.slack.channelId,
    )
    .map(slackEventWebhookToIntegration);
  const connectionsByTeamId = new Map(
    connections.map((connection) => [connection.teamId, connection]),
  );

  // Resolve each channel's live name (handles renames / missing names),
  // caching a changed name back for future loads. Best-effort and fully
  // error-isolated so one failure can't reject the batch and 500 the list.
  // Bounded concurrency below keeps conversations.info under Slack's rate limit.
  const resolveChannelName = async (
    integration: SlackOAuthIntegrationInterface,
  ) => {
    try {
      const channelId = integration.slack?.channelId;
      const teamId = integration.slack?.teamId;
      if (!channelId || !teamId) return;
      const connection = connectionsByTeamId.get(teamId);
      if (!connection) return;
      const token = getSlackWorkspaceToken(connection);
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

  return {
    slackConnections: connections.map(slackWorkspaceConnectionToFrontEnd),
    slackIntegrations: integrations,
  };
};

export const getSlackOAuthIntegrationById = async ({
  context,
  id,
}: {
  context: ReqContext;
  id: string;
}): Promise<SlackOAuthIntegrationInterface | null> => {
  const eventWebHook = await getEventWebHookById(id, context.org.id);
  return eventWebHook?.payloadType === "slack" && eventWebHook.slack?.teamId
    ? slackEventWebhookToIntegration(eventWebHook)
    : null;
};

export const updateSlackOAuthIntegration = async ({
  context,
  id,
  updates,
}: {
  context: ReqContext;
  id: string;
  updates: Pick<
    EventWebHookInterface,
    "enabled" | "events" | "projects" | "environments" | "tags"
  >;
}): Promise<SlackOAuthIntegrationInterface | null> => {
  const eventWebHook = await getEventWebHookById(id, context.org.id);
  if (eventWebHook?.payloadType !== "slack" || !eventWebHook.slack?.teamId) {
    return null;
  }

  await updateEventWebHook(
    { eventWebHookId: id, organizationId: context.org.id },
    updates,
  );

  const updated = await getEventWebHookById(id, context.org.id);
  return updated ? slackEventWebhookToIntegration(updated) : null;
};

/**
 * Exchange a Slack OAuth `code` and attach (or update) the Slack connection on
 * `context.org`. Shared core for both install paths; assumes the caller has
 * already authorized the attach (see {@link connectSlackOAuthIntegration} and
 * {@link connectSlackOAuthInstallFromSession}).
 */
export type SlackOAuthConnectionResult = {
  slackConnection: SlackWorkspaceConnectionFrontEndInterface;
  slackIntegration: SlackOAuthIntegrationInterface | null;
};

const attachSlackOAuthCode = async ({
  context,
  code,
}: {
  context: ReqContext;
  code: string;
}): Promise<SlackOAuthConnectionResult> => {
  const slackOAuthResponse = await exchangeSlackOAuthCode(code);
  const teamId = slackOAuthResponse.team?.id;
  if (!teamId) {
    throw new Error(
      "Slack did not return a workspace id. Install the GrowthBook app into a specific workspace (org-wide enterprise installs are not supported).",
    );
  }
  const connection = await upsertSlackWorkspaceConnection({
    context,
    slackOAuthResponse,
  });
  const slackConnection = slackWorkspaceConnectionToFrontEnd(connection);

  if (!slackOAuthResponse.incoming_webhook) {
    return { slackConnection, slackIntegration: null };
  }

  const channelId = slackOAuthResponse.incoming_webhook.channel_id;
  if (!channelId) {
    throw new Error("Slack did not return a channel identifier");
  }

  // Legacy per-channel install (manifest still has the incoming-webhook
  // scope): Slack picked a channel and minted a webhook URL for it.
  const existing = await findExistingSlackEventWebhook({
    context,
    slackOAuthResponse,
  });

  if (existing) {
    await reconnectSlackEventWebhook({
      eventWebHookId: existing.id,
      organizationId: context.org.id,
      url: slackOAuthResponse.incoming_webhook.url,
      slack: getSlackMetadata(slackOAuthResponse),
    });

    const updated = await getEventWebHookById(existing.id, context.org.id);
    if (!updated) {
      throw new Error("Unable to load updated Slack integration");
    }

    return {
      slackConnection,
      slackIntegration: slackEventWebhookToIntegration(updated),
    };
  }

  let created: EventWebHookInterface;
  try {
    created = await createEventWebHook({
      id: getSlackChannelEventWebhookId({
        organizationId: context.org.id,
        teamId,
        channelId,
      }),
      name: getSlackWebhookName(slackOAuthResponse),
      url: slackOAuthResponse.incoming_webhook.url,
      organizationId: context.org.id,
      enabled: true,
      events: DEFAULT_SLACK_EVENTS,
      projects: [],
      tags: [],
      environments: [],
      payloadType: "slack",
      method: "POST",
      headers: {},
      slack: getSlackMetadata(slackOAuthResponse),
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const concurrent = await findSlackChannelEventWebhook({
      organizationId: context.org.id,
      teamId,
      channelId,
    });
    if (!concurrent) throw error;
    return {
      slackConnection,
      slackIntegration: slackEventWebhookToIntegration(concurrent),
    };
  }

  return {
    slackConnection,
    slackIntegration: slackEventWebhookToIntegration(created),
  };
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

  return deleteEventWebHookById({
    eventWebHookId: eventWebHook.id,
    organizationId: context.org.id,
  });
};

// GrowthBook-side only — users must remove the app in Slack to revoke access.
export const disconnectSlackWorkspace = async ({
  context,
  teamId,
}: {
  context: ReqContext;
  teamId?: string;
}): Promise<{ deleted: number }> => {
  const [eventWebHooks, connections] = await Promise.all([
    getAllEventWebHooks(context.org.id),
    context.models.slackWorkspaceConnections.getAll(),
  ]);
  const slackDocs = eventWebHooks.filter((w) => w.payloadType === "slack");
  const teams = new Set(
    [
      ...connections.map((connection) => connection.teamId),
      ...slackDocs.map((w) => w.slack?.teamId),
    ].filter((candidate): candidate is string => !!candidate),
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
  if (await context.models.slackWorkspaceConnections.deleteForTeam(target)) {
    deleted++;
  }
  for (const doc of slackDocs.filter((w) => w.slack?.teamId === target)) {
    if (await deleteSlackOAuthIntegration({ context, id: doc.id })) deleted++;
  }
  return { deleted };
};

const resolveSlackWorkspace = async ({
  context,
  teamId,
}: {
  context: ReqContext;
  teamId?: string;
}) => {
  const [connections, eventWebHooks] = await Promise.all([
    context.models.slackWorkspaceConnections.getAll(),
    getAllEventWebHooks(context.org.id),
  ]);
  const connection = teamId
    ? connections.find((candidate) => candidate.teamId === teamId)
    : connections.length === 1
      ? connections[0]
      : undefined;
  if (!connection) {
    throw new Error(
      connections.length > 1 && !teamId
        ? "Multiple Slack workspaces are connected — specify which one."
        : "No Slack workspace connection found. Connect to Slack first.",
    );
  }
  return {
    connection,
    token: getSlackWorkspaceToken(connection),
    slackWebhooks: eventWebHooks.filter((w) => w.payloadType === "slack"),
  };
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
  const { connection, token, slackWebhooks } = await resolveSlackWorkspace({
    context,
    teamId,
  });
  const wsTeamId = connection.teamId;

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
 * EventWebHook doc that references the workspace by team id.
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
  const { connection, token, slackWebhooks } = await resolveSlackWorkspace({
    context,
    teamId,
  });
  const wsTeamId = connection.teamId;

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

  let created: EventWebHookInterface;
  try {
    created = await createEventWebHook({
      id: getSlackChannelEventWebhookId({
        organizationId: context.org.id,
        teamId: wsTeamId,
        channelId,
      }),
      name: connection.teamName
        ? `Slack #${channel.name} (${connection.teamName})`
        : `Slack #${channel.name}`,
      url: SLACK_WORKSPACE_PLACEHOLDER_URL,
      organizationId: context.org.id,
      enabled: true,
      events: DEFAULT_SLACK_EVENTS,
      projects: [],
      tags: [],
      environments: [],
      payloadType: "slack",
      method: "POST",
      headers: {},
      slack: {
        appId: connection.appId,
        teamId: connection.teamId,
        teamName: connection.teamName,
        enterpriseId: connection.enterpriseId,
        enterpriseName: connection.enterpriseName,
        botUserId: connection.botUserId,
        authedUserId: connection.authedUserId,
        scope: connection.scope,
        isEnterpriseInstall: connection.isEnterpriseInstall,
        channelId: channel.id,
        channelName: channel.name,
      },
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const concurrent = await findSlackChannelEventWebhook({
      organizationId: context.org.id,
      teamId: wsTeamId,
      channelId,
    });
    if (!concurrent) throw error;
    return slackEventWebhookToIntegration(concurrent);
  }
  return slackEventWebhookToIntegration(created);
};
