import {
  postSlackMessage,
  uploadSlackImageFile,
} from "back-end/src/services/slack/slackWebApi";

// Experiment-card image delivery. We upload the PNG to Slack as a private,
// Slack-hosted file (files.upload, needs files:write) and reference it from an
// image block via `slack_file`. We deliberately never host the image at a
// public URL — experiment results must not be exposed on a public bucket.

/**
 * Upload a rendered card PNG to Slack and return an `image` block referencing
 * the private file, or null if the upload failed (e.g. missing files:write).
 */
export async function uploadCardImageBlock({
  token,
  png,
  altText,
  filename = "experiment-card.png",
}: {
  token: string;
  png: Buffer;
  altText: string;
  filename?: string;
}): Promise<Record<string, unknown> | null> {
  const fileId = await uploadSlackImageFile({
    token,
    png,
    filename,
    title: altText,
  });
  if (!fileId) return null;
  return { type: "image", slack_file: { id: fileId }, alt_text: altText };
}

/**
 * Upload a card PNG (privately) and post it to a channel/thread as an image
 * block. If the upload fails, posts `fallbackText` instead (never a public
 * URL). Returns true if an image block was posted.
 */
export async function postExperimentCardImage({
  token,
  channel,
  png,
  altText,
  fallbackText,
  threadTs,
}: {
  token: string;
  channel: string;
  png: Buffer;
  altText: string;
  fallbackText?: string;
  threadTs?: string;
}): Promise<boolean> {
  const block = await uploadCardImageBlock({ token, png, altText });
  if (!block) {
    if (fallbackText) {
      await postSlackMessage({ token, channel, text: fallbackText, threadTs });
    }
    return false;
  }

  const ts = await postSlackMessage({
    token,
    channel,
    text: altText,
    blocks: [block],
    threadTs,
  });
  return ts !== null;
}
