import {
  postSlackMessage,
  uploadSlackImageFile,
} from "back-end/src/services/slack/slackWebApi";

// Experiment-card image delivery. We upload the PNG to Slack as a private,
// Slack-hosted file (files.upload, needs files:write) and share it into the
// channel via completeUploadExternal. We deliberately never host the image at
// a public URL — experiment results must not be exposed on a public bucket.
//
// Note: we share the file to the channel (optionally threaded) rather than
// embedding a `slack_file` image block — Slack rejects those with
// `invalid_blocks`.

/**
 * Upload a rendered card PNG and post it privately to a channel (optionally
 * threaded, with a leading comment). If the upload fails, posts `fallbackText`
 * instead (never a public URL). Returns true if the image was posted.
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
  const fileId = await uploadSlackImageFile({
    token,
    png,
    filename: "experiment-card.png",
    title: altText,
    channelId: channel,
    threadTs,
    initialComment: altText,
  });
  if (!fileId) {
    if (fallbackText) {
      await postSlackMessage({ token, channel, text: fallbackText, threadTs });
    }
    return false;
  }
  return true;
}
