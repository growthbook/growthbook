// Dev-only: validate the private files.upload delivery path end to end.
// Renders a sample compact card, uploads it via files.getUploadURLExternal +
// completeUploadExternal (needs files:write), and posts it to a channel with a
// slack_file image block via chat.postMessage.
//
//   pnpm --filter back-end exec tsx src/scripts/dev-test-file-upload.ts \
//     --org org_abc [--channel C0123ABCD]
//
// Uses the stored Slack webhook's bot token, so it also confirms the re-seeded
// token carries files:write. Channel defaults to the webhook's channel.
// eslint-disable-next-line no-restricted-imports
import "../init/aliases";
import { init } from "back-end/src/init";
import {
  EventWebHookModel,
  getSlackBotAccessTokenForWebhook,
} from "back-end/src/models/EventWebhookModel";
import { renderExperimentCard } from "back-end/src/services/slack/cards";
import { sampleCard } from "back-end/src/services/slack/chartImage";
import { uploadSlackImageFile } from "back-end/src/services/slack/slackWebApi";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  await init();
  const org = arg("org");
  if (!org) throw new Error("Pass --org org_...");

  const webhook = await EventWebHookModel.findOne({
    organizationId: org,
    payloadType: "slack",
  }).lean<{ id: string; slack?: { channelId?: string } }>();
  if (!webhook) throw new Error(`No slack webhook for org ${org}`);

  const channel = arg("channel") || webhook.slack?.channelId;
  if (!channel) throw new Error("No channel (pass --channel or connect one)");

  const token = await getSlackBotAccessTokenForWebhook({
    eventWebHookId: webhook.id,
    organizationId: org,
  });
  if (!token) throw new Error("No bot token stored for this webhook");

  console.log("Rendering sample compact card…");
  const png = await renderExperimentCard(sampleCard("winner"), "compact");

  console.log(
    `Uploading PNG (${png.length} bytes) and sharing to ${channel} via files.upload…`,
  );
  const fileId = await uploadSlackImageFile({
    token,
    png,
    filename: "test-card.png",
    title: "Test card",
    channelId: channel,
    initialComment: "files.upload test card",
  });

  console.log(
    fileId
      ? `Uploaded + shared (file_id=${fileId}). Check Slack.`
      : "files.upload failed (see warnings above)",
  );
  if (!fileId) throw new Error("files.upload failed");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
