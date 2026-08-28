import {
  postSlackMessage,
  uploadSlackImageFile,
} from "back-end/src/services/slack/slackWebApi";

// Experiment-card image delivery. We upload the PNG as a private, Slack-hosted
// file (needs files:write) and share it into the channel — never at a public
// URL, since experiment results must not be exposed on a public bucket. We share
// the file rather than embedding a `slack_file` block (Slack rejects those with
// `invalid_blocks`).

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
  viewLink,
  fallbackText,
  threadTs,
}: {
  token: string;
  channel: string;
  png: Buffer;
  altText: string;
  // Optional Slack-mrkdwn click-through link ("<url|label>") appended to the
  // leading comment, so the image isn't a dead end.
  viewLink?: string;
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
    initialComment: viewLink ? `${altText}\n${viewLink}` : altText,
  });
  if (!fileId) {
    if (fallbackText) {
      await postSlackMessage({ token, channel, text: fallbackText, threadTs });
    }
    return false;
  }
  return true;
}
