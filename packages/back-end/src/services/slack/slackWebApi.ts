import { cancellableFetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

const SLACK_API_URL = "https://slack.com/api";

export const SLACK_WORKSPACE_PLACEHOLDER_URL = "https://slack.com";

export const isSlackWorkspacePlaceholderUrl = (
  url: string | undefined | null,
): boolean => {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return (
      parsed.origin === SLACK_WORKSPACE_PLACEHOLDER_URL &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
};

type SlackApiResponse = { ok: boolean; error?: string } & Record<
  string,
  unknown
>;

const SLACK_FETCH_OPTS = { maxTimeMs: 15000, maxContentSize: 1024 * 256 };

function parseSlackResponse<T extends SlackApiResponse>(
  method: string,
  stringBody: string,
  httpOk: boolean,
  httpStatus: number,
): T | null {
  if (!httpOk) {
    logger.warn(`Slack API ${method} returned HTTP ${httpStatus}`);
    return null;
  }
  const parsed = JSON.parse(stringBody) as T;
  if (!parsed.ok) {
    const p = parsed as { error?: string; needed?: string; provided?: string };
    logger.warn(
      { needed: p.needed, provided: p.provided },
      `Slack API ${method} failed: ${p.error || "unknown error"}`,
    );
  }
  return parsed;
}

async function slackApiCall<T extends SlackApiResponse>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  try {
    const { stringBody, responseWithoutBody } = await cancellableFetch(
      `${SLACK_API_URL}/${method}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      },
      SLACK_FETCH_OPTS,
    );
    return parseSlackResponse<T>(
      method,
      stringBody,
      responseWithoutBody.ok,
      responseWithoutBody.status,
    );
  } catch (e) {
    logger.error(e, `Slack API ${method} request threw`);
    return null;
  }
}

async function slackApiGet<T extends SlackApiResponse>(
  token: string,
  method: string,
  params: Record<string, string>,
): Promise<T | null> {
  try {
    const qs = new URLSearchParams(params).toString();
    const { stringBody, responseWithoutBody } = await cancellableFetch(
      `${SLACK_API_URL}/${method}?${qs}`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      SLACK_FETCH_OPTS,
    );
    return parseSlackResponse<T>(
      method,
      stringBody,
      responseWithoutBody.ok,
      responseWithoutBody.status,
    );
  } catch (e) {
    logger.error(e, `Slack API ${method} request threw`);
    return null;
  }
}

export async function postSlackMessageResult({
  token,
  channel,
  text,
  blocks,
}: {
  token: string;
  channel: string;
  text: string;
  blocks?: unknown[];
}): Promise<{ ok: boolean; ts: string | null; error: string | null }> {
  const res = await slackApiCall<SlackApiResponse & { ts?: string }>(
    token,
    "chat.postMessage",
    { channel, text, ...(blocks ? { blocks } : {}) },
  );
  return {
    ok: !!res?.ok,
    ts: res?.ok ? (res.ts ?? null) : null,
    error: res?.ok ? null : (res?.error ?? "unknown error"),
  };
}

export async function postSlackMessage(args: {
  token: string;
  channel: string;
  text: string;
  blocks?: unknown[];
}): Promise<string | null> {
  return (await postSlackMessageResult(args)).ts;
}

export async function getSlackConversationName({
  token,
  channelId,
}: {
  token: string;
  channelId: string;
}): Promise<string | null> {
  const res = await slackApiGet<
    SlackApiResponse & { channel?: { name?: string } }
  >(token, "conversations.info", { channel: channelId });
  const name = res?.ok ? res.channel?.name : undefined;
  return name || null;
}

export type SlackConversation = {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
};

export async function listSlackConversations({
  token,
  cursor,
}: {
  token: string;
  cursor?: string;
}): Promise<{
  channels: SlackConversation[];
  nextCursor: string | null;
} | null> {
  const res = await slackApiGet<
    SlackApiResponse & {
      channels?: {
        id?: string;
        name?: string;
        is_private?: boolean;
        is_member?: boolean;
        is_archived?: boolean;
      }[];
      response_metadata?: { next_cursor?: string };
    }
  >(token, "conversations.list", {
    types: "public_channel,private_channel",
    exclude_archived: "true",
    limit: "200",
    ...(cursor ? { cursor } : {}),
  });
  if (!res?.ok) return null;
  const channels = (res.channels || [])
    .filter((c) => c.id && c.name && !c.is_archived)
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      isPrivate: !!c.is_private,
      isMember: !!c.is_member,
    }));
  return {
    channels,
    nextCursor: res.response_metadata?.next_cursor || null,
  };
}

export async function joinSlackConversation({
  token,
  channelId,
}: {
  token: string;
  channelId: string;
}): Promise<{ ok: boolean; error: string | null }> {
  const res = await slackApiCall<SlackApiResponse>(
    token,
    "conversations.join",
    { channel: channelId },
  );
  return {
    ok: !!res?.ok,
    error: res?.ok ? null : (res?.error ?? "unknown error"),
  };
}
