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
  getAllEventWebHooks,
  getEventWebHookById,
  getSlackBotAccessTokenForWebhook,
  reconnectSlackEventWebhook,
  updateSlackChannelName,
} from "back-end/src/models/EventWebhookModel";
import { deleteCoalesceBucketsForWebhook } from "back-end/src/models/EventWebHookCoalesceBucketModel";
import { getSlackConversationName } from "back-end/src/services/slack/slackWebApi";
import { logger } from "back-end/src/util/logger";
import { fetch } from "back-end/src/util/http.util";

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";
// app_mentions:read: receive @-mentions. *:history: receive plain thread
// follow-ups without a mention. channels:read/groups:read: resolve a channel's
// current name (conversations.info) so the UI shows renames. Rest cover
// incoming-webhook notifications, slash commands, chat:write, and users:read*.
const SLACK_OAUTH_SCOPE =
  "incoming-webhook,commands,chat:write,files:write,users:read,users:read.email,app_mentions:read,channels:read,groups:read,channels:history,groups:history,im:history,mpim:history,links:read";
const SLACK_OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
// Fresh installs subscribe to the curated default set (explicit event names,
// no wildcards) so the low-signal suppression gate is bypassed. Editable on the
// Slack settings page afterward.
const DEFAULT_SLACK_EVENTS = defaultSlackEventSubscriptions();

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
    incoming_webhook: z
      .object({
        channel: z.string().optional(),
        channel_id: z.string().optional(),
        configuration_url: z.string().url().optional(),
        url: z.string().url().startsWith("https://hooks.slack.com/services/"),
      })
      .strict(),
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
  channelName: slackOAuthResponse.incoming_webhook.channel,
  channelId: slackOAuthResponse.incoming_webhook.channel_id,
  configurationUrl: slackOAuthResponse.incoming_webhook.configuration_url,
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
  const channel =
    slackOAuthResponse.incoming_webhook.channel || "Slack channel";
  const team = slackOAuthResponse.team?.name;

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
  const channelId = slackOAuthResponse.incoming_webhook.channel_id;

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
  environments: eventWebHook.environments,
  tags: eventWebHook.tags,
  coalesceWindowMs: eventWebHook.coalesceWindowMs,
  dailyDigestHourUtc: eventWebHook.dailyDigestHourUtc,
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
