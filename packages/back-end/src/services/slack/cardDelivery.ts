import { randomUUID } from "crypto";
import { uploadFile } from "back-end/src/services/files";
import { SLACK_CARD_PUBLIC_BASE_URL } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { postSlackMessage } from "back-end/src/services/slack/slackWebApi";

// ---------------------------------------------------------------------------
// Dev-only in-memory card cache. When SLACK_CARD_PUBLIC_BASE_URL is set (e.g. an
// ngrok tunnel to the back-end), we serve card PNGs from a public route instead
// of object storage — so images render in Slack locally without S3/GCS. Bounded
// with a short TTL; prod never populates it (it uses the storage path below).
// ---------------------------------------------------------------------------
const DEV_CARD_TTL_MS = 15 * 60 * 1000;
const DEV_CARD_MAX = 100;
const devCardCache = new Map<string, { buf: Buffer; expires: number }>();

export function getDevCardImage(id: string): Buffer | null {
  const entry = devCardCache.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    devCardCache.delete(id);
    return null;
  }
  return entry.buf;
}

function stashDevCard(png: Buffer): string {
  const id = randomUUID();
  devCardCache.set(id, { buf: png, expires: Date.now() + DEV_CARD_TTL_MS });
  if (devCardCache.size > DEV_CARD_MAX) {
    for (const [k, v] of devCardCache) {
      if (Date.now() > v.expires) devCardCache.delete(k);
    }
    if (devCardCache.size > DEV_CARD_MAX) devCardCache.clear();
  }
  return id;
}

// Delivers a rendered experiment-card PNG to Slack. We host the PNG ourselves
// and reference it from an image block (matching the AI-image-gen precedent),
// rather than using files.uploadV2 (which would need the files:write scope).

/**
 * Upload a card PNG and return a URL Slack's servers can fetch, or null if the
 * configured storage backend only yields a non-public URL.
 *
 * Uses the "visual-editor-assets" destination, which is the public,
 * immutable, UUID-keyed bucket (same as AI-generated images). On the `local`
 * upload backend the URL is a relative, auth-gated `/upload/...` path that
 * Slack cannot reach — callers get null and should fall back to text.
 */
export async function uploadCardPng(
  organizationId: string,
  png: Buffer,
): Promise<string | null> {
  // Dev fallback: serve the PNG from the public in-memory route at the
  // configured base (e.g. an ngrok tunnel), bypassing object storage.
  if (SLACK_CARD_PUBLIC_BASE_URL) {
    const id = stashDevCard(png);
    return `${SLACK_CARD_PUBLIC_BASE_URL.replace(/\/$/, "")}/integrations/slack/card-image/${id}.png`;
  }

  const filePath = `slack-cards/${organizationId}/${randomUUID()}.png`;
  let url: string;
  try {
    url = await uploadFile(filePath, "image/png", png, "visual-editor-assets", {
      organizationId,
      feature: "slack-experiment-card",
    });
  } catch (e) {
    logger.error(e, "Slack card: PNG upload failed");
    return null;
  }
  // Only absolute http(s) URLs are fetchable by Slack; local uploads return a
  // relative auth-gated path.
  return /^https?:\/\//.test(url) ? url : null;
}

/**
 * Upload a card PNG and post it to a channel/thread as a Slack image block.
 * If no public URL is available (e.g. local storage backend), posts
 * `fallbackText` instead so the reply still lands. Returns true if an image
 * block was posted.
 */
export async function postExperimentCardImage({
  token,
  channel,
  organizationId,
  png,
  altText,
  fallbackText,
  threadTs,
}: {
  token: string;
  channel: string;
  organizationId: string;
  png: Buffer;
  altText: string;
  fallbackText?: string;
  threadTs?: string;
}): Promise<boolean> {
  const url = await uploadCardPng(organizationId, png);
  if (!url) {
    if (fallbackText) {
      await postSlackMessage({ token, channel, text: fallbackText, threadTs });
    }
    return false;
  }

  const ts = await postSlackMessage({
    token,
    channel,
    text: altText,
    blocks: [{ type: "image", image_url: url, alt_text: altText }],
    threadTs,
  });
  return ts !== null;
}
