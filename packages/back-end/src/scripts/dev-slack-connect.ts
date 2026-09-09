// Dev-only helper to connect a Slack workspace to a GrowthBook org WITHOUT the
// OAuth browser flow — for local testing (e.g. behind a single ngrok tunnel).
//
// Get a bot token from your Slack app: OAuth & Permissions → Install to
// Workspace → copy the "Bot User OAuth Token" (xoxb-...). Then:
//
//   pnpm --filter back-end tsx src/scripts/dev-slack-connect.ts \
//     --token xoxb-... [--channel C0123ABCD] [--org org_abc]
//
// Validates the token via auth.test (for the team id), then creates/updates
// the Slack Event Webhook the assistant relies on (team → org mapping + stored
// bot token). Defaults to the only org if --org is omitted.
//
// eslint-disable-next-line no-restricted-imports
import "../init/aliases";
import { init } from "back-end/src/init";
import { fetch } from "back-end/src/util/http.util";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { findAllOrganizations } from "back-end/src/models/OrganizationModel";
import {
  EventWebHookModel,
  createEventWebHook,
} from "back-end/src/models/EventWebhookModel";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        out[key] = val;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

type AuthTest = {
  ok: boolean;
  error?: string;
  team_id?: string;
  team?: string;
  url?: string;
  user_id?: string;
};

async function slackAuthTest(token: string): Promise<AuthTest> {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as AuthTest;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const token = args.token;
  const channelId = args.channel;

  if (!token) {
    console.error("Missing --token xoxb-...");
    process.exit(1);
  }
  if (IS_CLOUD) {
    console.error("This dev helper is not for Cloud.");
    process.exit(1);
  }

  await init();

  let organizationId = args.org;
  if (!organizationId) {
    const { organizations, total } = await findAllOrganizations(1, "", 50);
    if (total === 1 && organizations[0]) {
      organizationId = organizations[0].id;
    } else {
      console.error(
        `Found ${total} organizations — pass --org <id>. Options:\n` +
          organizations.map((o) => `  ${o.id}  (${o.name})`).join("\n"),
      );
      process.exit(1);
    }
  }

  const auth = await slackAuthTest(token);
  if (!auth.ok || !auth.team_id) {
    console.error(`Slack auth.test failed: ${auth.error || "unknown error"}`);
    process.exit(1);
  }
  console.log(
    `Token OK — workspace "${auth.team}" (${auth.team_id})${
      channelId ? `, channel ${channelId}` : ""
    } → org ${organizationId}`,
  );

  const slackMeta = {
    teamId: auth.team_id,
    teamName: auth.team,
    ...(channelId ? { channelId } : {}),
  };

  const existing = await EventWebHookModel.findOne({
    organizationId,
    payloadType: "slack",
    "slack.teamId": auth.team_id,
  }).lean();

  let eventWebHookId: string;
  if (existing) {
    eventWebHookId = existing.id;
    await EventWebHookModel.updateOne(
      { id: existing.id, organizationId },
      { $set: { slack: { ...existing.slack, ...slackMeta } } },
    );
    console.log(`Updated existing Slack webhook ${eventWebHookId}`);
  } else {
    const created = await createEventWebHook({
      name: `Slack dev (${auth.team || auth.team_id})`,
      // Unused by the assistant; just a valid https placeholder for the
      // notification webhook (auth.test returns the workspace URL).
      url: auth.url || "https://slack.com",
      organizationId,
      enabled: true,
      events: ["experiment.*", "feature.*"],
      projects: [],
      tags: [],
      environments: [],
      payloadType: "slack",
      method: "POST",
      headers: {},
      slack: slackMeta,
    });
    eventWebHookId = created.id;
    console.log(`Created Slack webhook ${eventWebHookId}`);
  }

  // Set the bot token directly (it's stripped from the public create interface).
  await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId },
    { $set: { "slack.botAccessToken": token } },
  );

  console.log("Done — the Slack assistant is now connected for this org.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
