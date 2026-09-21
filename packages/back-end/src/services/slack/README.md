# Slack assistant setup

Workspace OAuth must be configured with `SLACK_CLIENT_ID` and
`SLACK_CLIENT_SECRET`. Set `SLACK_SIGNING_SECRET` to verify inbound Slack requests.
The self-hosted setup manifest includes the assistant events, interactivity, and
the Messages tab. Its OAuth redirect uses `APP_ORIGIN`; events and interactions
use `API_HOST`. After creating the app, configure its credentials, restart
GrowthBook, and verify the Events Request URL in Slack's Event Subscriptions
settings. Slack must be able to reach `API_HOST` over HTTPS.

For an existing Slack app, configure:

- Events Request URL: `https://YOUR_API_HOST/integrations/slack/events`
- Interactivity Request URL: `https://YOUR_API_HOST/integrations/slack/interactions`
- Bot events: `app_mention`, `message.im`, and `assistant_thread_started`.
  General channel history is not requested; outside DMs, users should explicitly
  mention the bot for follow-up questions.

`shared/slack-integration` defines the bot OAuth scopes and events used by both
the OAuth connection and the self-hosted setup manifest. Reconnect
an older workspace installation if it lacks these grants. Enable the assistant
in GrowthBook's Slack workspace settings; it defaults off. GrowthBook's existing
AI access, usage limits, and the linked user's permissions still apply.

Users link their Slack identity through a private signed link requiring GrowthBook
login. Requests run with their current organization permissions. Mutations require
confirmation from the conversation owner. Notification delivery is independent of
the assistant switch.

## Account links and organization routing

Each Slack workspace connects to one GrowthBook organization, and each GrowthBook
organization connects to one Slack workspace. Send `link account` to GrowthBook in
a DM, or mention the bot with that text in a channel, to get a private signed link.
The consent page shows the Slack workspace/user, signed-in GrowthBook account, and
the connected organization before confirmation. To replace a linked GrowthBook
account, open a fresh private link while signed in to the replacement account and
confirm that organization.

The connection model enforces this temporary 1:1 policy with the unique indexes
`slack_one_org_per_workspace` and `slack_one_workspace_per_org`. Both OAuth install
paths reject a conflicting connection; reconnecting the same pair refreshes its
credentials. Disconnect the existing pair before moving either side to a new one.
Existing conflicting connections must be disconnected before these indexes can
be created. Writes wait for index creation and fail if it cannot enforce the policy.

To support shared workspaces later, remove this validation, explicitly drop the
two policy indexes, and extend the workspace resolver. Connection primary keys,
account links, and conversation IDs remain organization-scoped for that change.

The private **Link my account** URL expires after 15 minutes. After confirming
the connected organization and account, return to Slack and send the question
again. Linking does not resume a question or dismiss the private prompt.
Explicit `link account` requests do not start an assistant turn. Interactivity
is used for mutation approvals.

The personal account menu's **My Slack links** page lists the current user's
links in the selected organization and allows disconnecting them. These actions
do not require integration-admin permission. Every replacement creates a new link
identifier, so older conversations and pending approvals cannot be reused, even
when relinking to the same account.
A signed consent token can be used once per organization; retrying an already
successful consent is idempotent. A failed or subsequently disconnected consent
requires a fresh private link.

Workspace OAuth connections are authoritative for linking, DMs, and channel
mentions, including a fresh installation with no notification channels. Invite the
bot to a channel directly in Slack to talk to it there. Notification subscriptions
do not restrict access to the assistant, and deleting a notification subscription
does not interrupt assistant conversations.

The assistant uses the organization connected to the Slack workspace. Users must
link their account in that organization and retain access to it.

A thread keeps its organization in `slackassistantthreads`. Disconnecting and
reconnecting the workspace to a different organization never redirects an existing
thread. Each Slack participant has a separate conversation bound to their Slack
identity, GrowthBook account, organization, and current link identifier. Membership,
configuration, and permissions are checked again when acting.

Notifications GrowthBook posts also pin their thread to the sending organization,
so replies still belong to that organization if the workspace is later reconnected
to a different one. These notification pins expire after 90 days through a TTL index,
and they never overwrite a pin the thread already has. A pin stops expiring once
someone converses in the thread.

## Queue recovery

Slack event and interaction requests are acknowledged only after Agenda accepts
the job. A unique delivery index and insert-only upsert retain completed delivery
identities for the normal Agenda cleanup period (seven days). A duplicate never
reschedules a completed task. Database failures return 503 so Slack can retry. Button deliveries are deduplicated
by the Slack click timestamp: a fresh click can retry a failed access or usage
check. The permanent action claim is acquired only after these checks pass,
immediately before resolving the approved action; preflight failures leave the
original approval controls available.

Turns in the same Slack thread are serialized with a durable `thread:` claim in
`slacktaskclaims`. Busy jobs retry after five seconds. Claims are released when
the handler finishes, including errors. They intentionally do not expire while
a process may still be executing a mutation. After 15 minutes, blocked jobs fail
with the claim key in the log and send the user an ephemeral recovery message.

If a worker crashes or a turn hangs:

1. Find the `lockKey` in the blocked job's error/log.
2. Confirm the prior worker has stopped and cannot resume. Inspect GrowthBook
   audit history and the conversation before retrying any mutation.
3. Delete only that exact `thread:` claim from `slacktaskclaims`.
4. Ask the user to send a new message. Failed jobs are not automatically replayed.

Never delete `action:` claims as part of thread recovery. They record approvals
that have already been submitted, including actions with an uncertain result
after a crash. A user should inspect the current state and request a fresh
proposal instead of replaying an old confirmation.
