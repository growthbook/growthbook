# Slack assistant setup

Workspace OAuth must be configured with `SLACK_CLIENT_ID` and
`SLACK_CLIENT_SECRET`. Set `SLACK_SIGNING_SECRET` to verify inbound Slack requests.
In the Slack app settings, configure:

- Events Request URL: `https://YOUR_API_HOST/integrations/slack/events`
- Interactivity Request URL: `https://YOUR_API_HOST/integrations/slack/interactions`
- Bot events: `app_mention`, `message.im`, and `assistant_thread_started`.
  General channel history is not requested; outside DMs, users should explicitly
  mention the bot for follow-up questions.

The OAuth scopes include `app_mentions:read`, `im:history`, and
`assistant:write` for chat, alongside the existing notification scopes. Reconnect
an older workspace installation if it lacks these grants. Enable the assistant
in GrowthBook's Slack workspace settings; it defaults off. GrowthBook's existing
AI access, usage limits, and the linked user's permissions still apply.

Users link their Slack identity through a private signed link requiring GrowthBook
login. Requests run with their current organization permissions. Mutations require
confirmation from the conversation owner. Notification delivery is independent of
the assistant switch.

## Account links and organization routing

Users consent separately for each GrowthBook organization. Send `link account`
to GrowthBook in a DM, or mention the bot with that text in a channel, to get a
private signed link. The consent page shows the Slack workspace/user, signed-in
GrowthBook account, and eligible connected organizations. Choose the organization
before confirming. To replace a linked GrowthBook account, open a fresh private
link while signed in to the replacement account and confirm that organization.

The personal account menu's **My Slack links** page lists the current user's
links in the selected organization and allows disconnecting them. These actions
do not require integration-admin permission. Other organizations' links remain
unchanged. Every replacement creates a new link identifier, so older conversations
and pending approvals cannot be reused, even when relinking to the same account.
A signed consent token can be used once per organization; retrying an already
successful consent is idempotent. A failed or subsequently disconnected consent
requires a fresh private link.

Workspace OAuth connections are authoritative for linking and DMs, including a
fresh installation with no notification channels. Deleting the final notification
channel leaves workspace linking and DMs available. Channel requests still require
an exact channel subscription in the selected organization.

An unambiguous eligible organization with the assistant enabled is chosen automatically. When a DM or channel
has multiple eligible linked organizations, the assistant posts a private clickable
organization picker and continues the original question after a valid choice.
The choice persists in `slackassistantthreads` for the team/channel/thread. Later
messages and approvals use that organization. Losing a link, membership, or channel
connection never redirects an existing thread to another organization. Each Slack
participant has a separate conversation bound to their Slack identity, GrowthBook
account, organization, and current link identifier. Picker responses are bound to
the requester and pending question; stale, duplicate, or mismatched responses do
not start another turn. Membership, configuration, and permissions are checked again
when acting. To use a different organization, start a new thread.

`slackuserlinks` is unique per Slack workspace, Slack user, and organization;
BaseModel creates that index at startup. Every stored link carries the `linkId`
generation it was created with. Old approval buttons from before thread routing
was introduced are rejected and require a new proposal.

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
