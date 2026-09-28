import { z } from "zod";
import { cancellableFetch, fetch } from "back-end/src/util/http.util";
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
type SlackBlock = Record<string, unknown>;

// node-fetch v2's AbortSignal type is narrower than the global implementation.
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

const SLACK_FETCH_OPTS = { maxTimeMs: 15000, maxContentSize: 1024 * 256 };
const SLACK_MAX_RATE_LIMIT_RETRIES = 3;
const SLACK_MAX_RATE_LIMIT_WAIT_MS = 60_000;

export class SlackRateLimitError extends Error {
  constructor(method: string) {
    super(`Slack API ${method} rate limit retry budget exhausted`);
    this.name = "SlackRateLimitError";
  }
}

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

async function slackApiRequest<T extends SlackApiResponse>(
  method: string,
  url: string,
  options: FetchInit,
): Promise<T | null> {
  try {
    let waitedMs = 0;
    for (let retry = 0; ; retry++) {
      const { stringBody, responseWithoutBody } = await cancellableFetch(
        url,
        options,
        SLACK_FETCH_OPTS,
      );
      if (responseWithoutBody.status !== 429) {
        return parseSlackResponse<T>(
          method,
          stringBody,
          responseWithoutBody.ok,
          responseWithoutBody.status,
        );
      }

      const retryAfterSeconds = Number(
        responseWithoutBody.headers.get("retry-after"),
      );
      const delayMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.ceil(retryAfterSeconds * 1000)
          : 1000 * 2 ** retry;
      // Never shorten Slack's cooldown to fit our worker's wait budget.
      if (
        retry >= SLACK_MAX_RATE_LIMIT_RETRIES ||
        waitedMs + delayMs > SLACK_MAX_RATE_LIMIT_WAIT_MS
      ) {
        throw new SlackRateLimitError(method);
      }
      logger.warn(
        { method, retry: retry + 1, delayMs },
        "Slack API rate limited; retrying after cooldown",
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      waitedMs += delayMs;
    }
  } catch (e) {
    if (e instanceof SlackRateLimitError) throw e;
    logger.error(e, `Slack API ${method} request threw`);
    return null;
  }
}

function slackApiCall<T extends SlackApiResponse>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  return slackApiRequest<T>(method, `${SLACK_API_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
}

function slackApiGet<T extends SlackApiResponse>(
  token: string,
  method: string,
  params: Record<string, string>,
): Promise<T | null> {
  const qs = new URLSearchParams(params).toString();
  return slackApiRequest<T>(method, `${SLACK_API_URL}/${method}?${qs}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function setSlackSuggestedPrompts({
  token,
  channelId,
  title,
  prompts,
}: {
  token: string;
  channelId: string;
  title: string;
  prompts: { title: string; message: string }[];
}): Promise<boolean> {
  const res = await slackApiCall<SlackApiResponse>(
    token,
    "assistant.threads.setSuggestedPrompts",
    // agent_view prompts belong to the Messages tab; thread_ts silently fails.
    { channel_id: channelId, title, prompts },
  );
  return !!res?.ok;
}

export async function postSlackMessageResult({
  token,
  channel,
  text,
  blocks,
  threadTs,
}: {
  token: string;
  channel: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
}): Promise<{ ok: boolean; ts: string | null; error: string | null }> {
  const res = await slackApiCall<SlackApiResponse & { ts?: string }>(
    token,
    "chat.postMessage",
    {
      channel,
      text,
      ...(blocks ? { blocks } : {}),
      ...(threadTs ? { thread_ts: threadTs } : {}),
    },
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
  threadTs?: string;
}): Promise<string | null> {
  return (await postSlackMessageResult(args)).ts;
}

export async function postSlackEphemeralMessage({
  token,
  channel,
  user,
  text,
  blocks,
  threadTs,
}: {
  token: string;
  channel: string;
  user: string;
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string;
}): Promise<boolean> {
  const res = await slackApiCall<SlackApiResponse>(
    token,
    "chat.postEphemeral",
    {
      channel,
      user,
      text,
      ...(blocks ? { blocks } : {}),
      ...(threadTs ? { thread_ts: threadTs } : {}),
    },
  );
  return !!res?.ok;
}

export async function updateSlackMessage({
  token,
  channel,
  ts,
  text,
  blocks,
}: {
  token: string;
  channel: string;
  ts: string;
  text: string;
  blocks?: SlackBlock[];
}): Promise<boolean> {
  const res = await slackApiCall<SlackApiResponse>(token, "chat.update", {
    channel,
    ts,
    text,
    ...(blocks ? { blocks } : {}),
  });
  return !!res?.ok;
}

/**
 * Upload a PNG as a private Slack file and share it into a channel. Slack's
 * external-upload flow keeps experiment data off public object storage.
 */
// Uploads an image and shares it to the channel in one message. The share
// message is `blocks` when given (so the caption can be a small context
// footer), falling back to `initialComment` if Slack rejects them; a card must
// never degrade to text over caption formatting. Sharing on upload matters:
// referencing a private file from a later message fails until Slack finishes
// processing it, and channel members may not be able to see it at all.
export async function uploadSlackImageFile({
  token,
  png,
  filename,
  title,
  channelId,
  initialComment,
  blocks,
}: {
  token: string;
  png: Buffer;
  filename: string;
  title?: string;
  channelId: string;
  initialComment?: string;
  blocks?: unknown[];
}): Promise<string | null> {
  const getRes = await slackApiGet<
    SlackApiResponse & { upload_url?: string; file_id?: string }
  >(token, "files.getUploadURLExternal", {
    filename,
    length: String(png.length),
  });
  if (!getRes?.ok || !getRes.upload_url || !getRes.file_id) return null;

  try {
    const uploadRes = await fetch(getRes.upload_url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: png,
      signal: AbortSignal.timeout(
        SLACK_FETCH_OPTS.maxTimeMs,
      ) as FetchInit["signal"],
    });
    if (!uploadRes.ok) {
      logger.warn(`Slack file upload POST returned HTTP ${uploadRes.status}`);
      return null;
    }
  } catch (error) {
    logger.error(error, "Slack file upload POST threw");
    return null;
  }

  const complete = (share: Record<string, string>) =>
    slackApiCall<SlackApiResponse>(token, "files.completeUploadExternal", {
      files: [{ id: getRes.file_id, title: title || filename }],
      channel_id: channelId,
      ...share,
    });
  let completeRes = await complete(
    blocks
      ? { blocks: JSON.stringify(blocks) }
      : initialComment
        ? { initial_comment: initialComment }
        : {},
  );
  if (!completeRes?.ok && blocks && initialComment) {
    logger.warn(
      `Slack rejected the card caption blocks (${completeRes?.error ?? "unknown error"}); sharing with a plain comment`,
    );
    completeRes = await complete({ initial_comment: initialComment });
  }
  return completeRes?.ok ? getRes.file_id : null;
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

const slackConversationInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  is_private: z.boolean(),
  is_member: z.boolean().optional(),
  is_archived: z.boolean(),
});

export async function getSlackConversation({
  token,
  channelId,
}: {
  token: string;
  channelId: string;
}): Promise<SlackConversation | null> {
  const res = await slackApiGet<SlackApiResponse>(token, "conversations.info", {
    channel: channelId,
  });
  if (!res?.ok) return null;
  const parsed = slackConversationInfoSchema.safeParse(res.channel);
  if (
    !parsed.success ||
    parsed.data.is_archived ||
    parsed.data.id !== channelId
  )
    return null;
  return {
    id: parsed.data.id,
    name: parsed.data.name,
    isPrivate: parsed.data.is_private,
    // Bot tokens can only inspect private channels they have joined. Public
    // channels without membership metadata are joined idempotently by the caller.
    isMember: parsed.data.is_member ?? parsed.data.is_private,
  };
}

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
