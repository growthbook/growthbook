import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { APP_ORIGIN, JWT_SECRET } from "back-end/src/util/secrets";

// Signed state for the Slack account-link flow. The bot hands the user a link
// containing this state; when they complete it in a GrowthBook session, the
// signature proves the request originated from our bot for that specific Slack
// user (so a user can't link an arbitrary Slack id to their account). Mirrors
// the HMAC-signed state used by the Slack OAuth install.

const LINK_STATE_MAX_AGE_MS = 15 * 60 * 1000;

const sign = (payload: string) =>
  createHmac("sha256", JWT_SECRET).update(payload).digest("base64url");

/** Build the account-link URL the bot posts to an unlinked user. */
export function buildSlackLinkUrl({
  slackTeamId,
  slackUserId,
}: {
  slackTeamId: string;
  slackUserId: string;
}): string {
  const payload = Buffer.from(
    JSON.stringify({
      slackTeamId,
      slackUserId,
      nonce: randomBytes(12).toString("base64url"),
      createdAt: Date.now(),
    }),
  ).toString("base64url");
  const state = `${payload}.${sign(payload)}`;
  return `${APP_ORIGIN.replace(/\/$/, "")}/integrations/slack/link?state=${encodeURIComponent(
    state,
  )}`;
}

/**
 * Verify a link state and return the Slack identity it encodes, or null if the
 * signature is invalid or it has expired.
 */
export function verifySlackLinkState(
  state: string,
): { slackTeamId: string; slackUserId: string } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const actual = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    actual.length !== expectedBuf.length ||
    !timingSafeEqual(actual, expectedBuf)
  ) {
    return null;
  }

  let parsed: {
    slackTeamId?: unknown;
    slackUserId?: unknown;
    createdAt?: unknown;
  };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof parsed.slackTeamId !== "string" ||
    typeof parsed.slackUserId !== "string" ||
    typeof parsed.createdAt !== "number"
  ) {
    return null;
  }
  if (Date.now() - parsed.createdAt > LINK_STATE_MAX_AGE_MS) return null;

  return { slackTeamId: parsed.slackTeamId, slackUserId: parsed.slackUserId };
}
