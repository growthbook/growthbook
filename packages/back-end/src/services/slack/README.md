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
- Bot events: `app_mention`, `message.im`, `app_home_opened`, and `link_shared`.
  General channel history is not requested; outside DMs, users should explicitly
  mention the bot for follow-up questions.

Channel messages are accepted only as `app_mention` events, including mentions
inside existing threads. Other channel messages are discarded before any database
lookup or job creation, even if an older app configuration still delivers them.
DM messages are accepted with or without a mention. Bot messages and message
subtypes such as edits are ignored.

The bot scopes cover notifications, the assistant, and permissions for link unfurling:

| Scope                          | Use                                                                 |
| ------------------------------ | ------------------------------------------------------------------- |
| `chat:write`                   | Assistant replies, private account-link prompts, and notifications  |
| `files:write`                  | Notification chart images                                           |
| `channels:read`, `groups:read` | Public/private notification channel selection and validation        |
| `channels:join`                | Joining a public channel selected for notifications                 |
| `assistant:write`              | Suggested prompts in the app's Messages tab                         |
| `im:history`                   | Messages sent directly to the bot                                   |
| `app_mentions:read`            | Explicit channel mentions                                           |
| `links:read`, `links:write`    | Permissions for receiving matching links and posting custom unfurls |

The manifest registers the `APP_ORIGIN` hostname as its unfurl domain. Slack filters
`link_shared` events to matching URLs and sends link metadata, not message text.
No channel-history scopes or general message subscriptions are needed. The current
backend acknowledges these events without generating previews; the manifest
prepares the permissions and subscription for a future unfurl handler. See Slack's
[link unfurling guide](https://docs.slack.dev/messaging/unfurling-links-in-messages/).
Changing unfurl domains requires reinstalling the app.

Do not add `channels:history`, `groups:history`, `mpim:history`, `message.channels`,
`message.groups`, or `message.mpim` for this version. `app_home_opened` only updates DM onboarding
prompts; it does not start an assistant conversation.

Use `features.agent_view` with `agent_description`. Remove the legacy
`assistant_thread_started` subscription when updating an existing app. Slack's
[Agent messaging migration guide](https://docs.slack.dev/ai/migrating-to-agent-messaging/)
uses `app_home_opened` with `tab: "messages"` for DM onboarding. These events
go through the durable queue and replace static suggested prompts in the Messages
tab without posting a welcome message or running the AI assistant. Suggested
prompts omit `thread_ts`, as required for `agent_view`; actual conversations
start with a user message and retain the existing account and AI access checks.

For Cloud, use `https://app.growthbook.io/integrations/slack` as the OAuth redirect
and `https://api.growthbook.io` as the API host for the two request URLs above.
Activate public distribution in the Slack app dashboard so other workspaces can
install it through GrowthBook's OAuth connection flow.

`shared/slack-integration` defines the bot OAuth scopes and events used by both
the OAuth connection and the self-hosted setup manifest. Reconnect
an older workspace installation if it lacks these grants. The assistant follows
the organization's AI setting unless its Slack workspace switch was set
explicitly. Organization AI access, usage limits, and the linked user's
permissions still apply.

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

Notifications GrowthBook posts also bind their thread to the sending organization,
so replies still belong to that organization if the workspace is later reconnected
to a different one. These notification bindings expire after 90 days through a TTL
index, and they never overwrite a binding the thread already has. A binding stops
expiring once someone converses in the thread.

## Queue recovery

Slack Web API calls retry HTTP 429 responses up to three times, with at most
60 seconds of cumulative waiting per call. Retries honor `Retry-After` without
shortening Slack's cooldown; missing or invalid values use exponential backoff
starting at one second. Exhausted reply delivery retries fail the assistant job
instead of silently succeeding or replaying the AI turn or a mutation.

Slack event and interaction requests are acknowledged only after Agenda accepts
the job. A unique delivery index and insert-only upsert retain completed delivery
identities for the normal Agenda cleanup period (seven days). A duplicate never
reschedules a completed task. Database failures return 503 so Slack can retry. Button deliveries are deduplicated
by the Slack click timestamp: a fresh click can retry a failed access or usage
check. The permanent action claim is acquired only after these checks pass,
immediately before resolving the approved action; preflight failures leave the
original approval controls available.

The handler checks the workspace connection, thread binding, and user access before
claiming the thread. Unlinked users receive account-link prompts without a claim.

Turns in one Slack thread run one at a time. The worker holds a `thread:` lease
in `slacktaskclaims` that expires after two minutes, renews it every 30 seconds
while the turn runs, and releases it when the turn ends. A busy Agenda job
reschedules after five seconds and reuses the placeholder its first attempt
posted, so a second quick message is acknowledged while the first is answered.
When a worker dies mid-turn (a deploy or a crash), its renewals stop and the
thread's next turn takes the lease over within two minutes, without administrator
intervention. Every Agenda processor, this one included, runs inside the shared
queue wrapper in `services/queueing.ts`, which renews the job lock every nine
minutes, so a long turn is never picked up by a second worker.

A turn gets 15 minutes. At that deadline, or when a renewal finds the lease was
taken over, the worker aborts the AI stream, skips the final conversation save,
and replaces the placeholder with a timeout notice. Renewal stops at the same
moment, so a turn that never returns still lets its lease lapse. An
already-dispatched mutation may still finish; its permanent action claim
prevents replay.

Permanent `action:` claims record approvals that have already been submitted,
including actions with an uncertain result after a crash. They never block a
thread. Users can inspect the current state and request a fresh proposal
instead of replaying an old confirmation.
