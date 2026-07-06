import { randomUUID } from "crypto";
import { uploadFile } from "back-end/src/services/files";
import { logger } from "back-end/src/util/logger";
import { postSlackMessage } from "back-end/src/services/slack/slackWebApi";

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
