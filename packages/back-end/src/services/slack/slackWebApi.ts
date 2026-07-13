import { cancellableFetch, fetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

// Minimal Slack Web API client for the interactive assistant (bot-token calls:
// chat.postMessage/update, users.info). Outbound event notifications still go
// through incoming webhooks (EventWebHookNotifier).

const SLACK_API_URL = "https://slack.com/api";

// Slack returns HTTP 200 even on logical failures, carrying { ok: false,
// error }. Always inspect the parsed body, never just the HTTP status.
type SlackApiResponse = { ok: boolean; error?: string } & Record<
  string,
  unknown
>;

type SlackBlock = Record<string, unknown>;

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
    logger.warn(
      `Slack API ${method} failed: ${parsed.error || "unknown error"}`,
    );
  }
  return parsed;
}

// POST with a JSON body — for "write" methods like chat.postMessage/update.
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

// GET with query-string args — "read" methods like users.info read their args
// from the query string and IGNORE a JSON body.
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

/**
 * Post a message (optionally threaded). Returns `ts` (for a later chat.update),
 * `ok`, and the Slack `error` on failure so callers can surface why it failed
 * (e.g. not_in_channel, invalid_blocks).
 */
export async function postSlackMessageResult({
  token,
  channel,
  text,
  blocks,
  threadTs,
  unfurl,
}: {
  token: string;
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string;
  // When false, suppress Slack's link/media previews (e.g. for experiment
  // names containing a URL). Defaults to Slack's behavior (previews on).
  unfurl?: boolean;
}): Promise<{ ok: boolean; ts: string | null; error: string | null }> {
  const res = await slackApiCall<SlackApiResponse & { ts?: string }>(
    token,
    "chat.postMessage",
    {
      channel,
      text,
      ...(blocks ? { blocks } : {}),
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(unfurl === false ? { unfurl_links: false, unfurl_media: false } : {}),
    },
  );
  return {
    ok: !!res?.ok,
    ts: res?.ok ? (res.ts ?? null) : null,
    error: res?.ok ? null : (res?.error ?? "unknown error"),
  };
}

/** Post a message, returning its `ts` (for a later chat.update) or null. */
export async function postSlackMessage(args: {
  token: string;
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string;
  unfurl?: boolean;
}): Promise<string | null> {
  return (await postSlackMessageResult(args)).ts;
}

/**
 * Post an ephemeral message, visible only to `user`. Used for one-person
 * content (e.g. the account-link prompt) so a signed link isn't exposed to the
 * whole channel. Returns false on failure (never throws).
 */
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

/** Replace a message in place (e.g. swap a "thinking…" placeholder for the answer). */
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
 * Provide unfurl content for URLs shared in a message (responding to a
 * `link_shared` event). `unfurls` maps each shared URL to its block content.
 */
export async function unfurlSlackLinks({
  token,
  channel,
  ts,
  unfurls,
}: {
  token: string;
  channel: string;
  ts: string;
  unfurls: Record<string, { blocks: SlackBlock[] }>;
}): Promise<boolean> {
  const res = await slackApiCall<SlackApiResponse>(token, "chat.unfurl", {
    channel,
    ts,
    unfurls,
  });
  return !!res?.ok;
}

/**
 * Upload a PNG as a private, Slack-hosted file (requires `files:write`) and
 * share it into a channel, optionally as a threaded reply with a leading
 * comment. Returns the file id, or null on failure.
 *
 * Shares via completeUploadExternal's `channel_id` rather than an `image`
 * block's `slack_file` — the latter is rejected with `invalid_blocks` (known
 * Slack limitation), and this keeps the file private (never a public URL).
 * Uses the current external-upload flow (the older files.upload is gone).
 */
export async function uploadSlackImageFile({
  token,
  png,
  filename,
  title,
  channelId,
  threadTs,
  initialComment,
}: {
  token: string;
  png: Buffer;
  filename: string;
  title?: string;
  channelId: string;
  threadTs?: string;
  initialComment?: string;
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
    });
    if (!uploadRes.ok) {
      logger.warn(`Slack file upload POST returned HTTP ${uploadRes.status}`);
      return null;
    }
  } catch (e) {
    logger.error(e, "Slack file upload POST threw");
    return null;
  }

  const completeRes = await slackApiCall<SlackApiResponse>(
    token,
    "files.completeUploadExternal",
    {
      files: [{ id: getRes.file_id, title: title || filename }],
      channel_id: channelId,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(initialComment ? { initial_comment: initialComment } : {}),
    },
  );
  return completeRes?.ok ? getRes.file_id : null;
}

/**
 * Look up a Slack user's profile email (requires the `users:read.email` scope,
 * which the OAuth install requests). Returns null if unavailable.
 */
export async function getSlackUserEmail({
  token,
  slackUserId,
}: {
  token: string;
  slackUserId: string;
}): Promise<string | null> {
  const res = await slackApiGet<
    SlackApiResponse & { user?: { profile?: { email?: string } } }
  >(token, "users.info", { user: slackUserId });
  const email = res?.ok ? res.user?.profile?.email : undefined;
  return email || null;
}

// Resolve a channel's current name via conversations.info (needs channels:read
// / groups:read). Installs predating those scopes return `missing_scope`; we
// return null so callers fall back to the name captured at install time.
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
