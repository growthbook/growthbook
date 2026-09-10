# Slack assistant setup

Workspace OAuth must be configured with `SLACK_CLIENT_ID` and
`SLACK_CLIENT_SECRET`. Set `SLACK_SIGNING_SECRET` to verify inbound Slack requests.
In the Slack app settings, configure:

- Events Request URL: `https://YOUR_API_HOST/integrations/slack/events`
- Interactivity Request URL: `https://YOUR_API_HOST/integrations/slack/interactions`
- Optional `/growthbook` command URL: `https://YOUR_API_HOST/integrations/slack/commands`
- Bot events: `app_mention`, `message.im`, `assistant_thread_started`, and
  `link_shared` when link previews are enabled. Register your GrowthBook app
  domain for link previews. General channel history is not requested; outside
  DMs, users should explicitly mention the bot for follow-up questions.

The OAuth scopes are configured by the cards foundation PR, including
`commands`, `links:read`, and `links:write`. Reconnect the workspace if an older
installation lacks those grants. Enable assistant and/or link previews explicitly
in GrowthBook's Slack workspace settings; both default off. GrowthBook's existing
AI access, usage limits, and the linked user's permissions still apply.

Users link their Slack identity through a private signed link requiring GrowthBook
login. Requests run with their current organization permissions. Mutations require
confirmation from the conversation owner. Notification delivery is independent of
the assistant switch.

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
