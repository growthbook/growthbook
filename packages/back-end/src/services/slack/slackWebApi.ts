import { cancellableFetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

// Minimal Slack Web API client for the interactive assistant. Outbound event
// notifications still go through incoming webhooks (EventWebHookNotifier); this
// is only for the bot-token-authenticated calls the assistant needs
// (chat.postMessage / chat.update to reply, users.info to map identities).

const SLACK_API_URL = "https://slack.com/api";

// Slack returns HTTP 200 even on logical failures, carrying { ok: false,
// error }. Always inspect the parsed body, never just the HTTP status.
type SlackApiResponse = { ok: boolean; error?: string } & Record<
  string,
  unknown
>;

type SlackBlock = Record<string, unknown>;

// Slack responses are small, but users.info / chat.postMessage echoes can be a
// few KB — keep a comfortable ceiling.
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

// POST with a JSON body — for "write" methods like chat.postMessage /
// chat.update that accept JSON.
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

// GET with query-string args — for "read" methods like users.info, which read
// their arguments from the query string and IGNORE a JSON body.
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
 * Post a message to a channel (optionally threaded). Returns the new message's
 * `ts` so callers can later chat.update it, or null on failure.
 */
export async function postSlackMessage({
  token,
  channel,
  text,
  blocks,
  threadTs,
}: {
  token: string;
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string;
}): Promise<string | null> {
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
  return res?.ok ? (res.ts ?? null) : null;
}

/**
 * Replace an existing message in place (used to swap a "thinking…" placeholder
 * for the final answer).
 */
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
 * Provide link-unfurl content for URLs shared in a message (responding to a
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
  // users.info is a read method — it reads its args from the query string, NOT
  // a JSON body (unlike chat.postMessage), so pass `user` as a query param.
  const res = await slackApiGet<
    SlackApiResponse & { user?: { profile?: { email?: string } } }
  >(token, "users.info", { user: slackUserId });
  const email = res?.ok ? res.user?.profile?.email : undefined;
  return email || null;
}
