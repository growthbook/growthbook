# Slack digests and grouped notifications

These features apply only to workspace OAuth channel connections. Legacy incoming webhooks and custom relays keep their existing delivery behavior. Both digests and grouping are off by default, including for existing connections.

## Channel settings

Open a connected channel in Settings → Integrations → Slack. Choose the events, Projects, environments, and tags it should receive, then save its settings.

Experiment and Feature Flag digests have independent schedules:

- Off: no scheduled digest.
- Daily: the selected UTC hour each day.
- Weekly: the selected weekday and UTC hour.
- Monthly: the selected day (1–28) and UTC hour.
- Quarterly: the selected day in January, April, July, and October, at the selected UTC hour.
- Every few days: a custom interval of 1–90 days at the selected UTC hour.

Schedules use UTC and do not change with daylight saving time. Queue processing and retries can delay delivery. Digests summarize subscribed events matching the channel filters; they do not replace individual event notifications. A digest is an activity summary, not an assessment of experiment outcomes or shipped improvements.

“Group related notifications” combines updates for the same experiment into a summary after about a minute. A group containing multiple events is text-only. A lone event retains its normal card or text delivery. Updates for separate experiments and separate channel connections are not combined.

Grouped delivery retries up to three times after the initial attempt, including across worker restarts. Failed deliveries appear in the channel delivery status and logs. As with ordinary webhook delivery, a timeout after Slack accepts a message can result in a duplicate on retry.

Disabling the channel stops its notifications. Setting either digest schedule to Off disables only that digest.

## Validation with a test workspace

1. With digests and grouping off, trigger a subscribed experiment event and verify its normal notification still arrives.
2. Enable grouping, then trigger several subscribed updates for one experiment within a minute. Verify one text summary arrives. Trigger a single update for another experiment and verify its regular card or text arrives.
3. Enable an experiment digest and a Feature Flag digest with distinct schedules. Verify each includes only the events matching that channel’s subscriptions and filters.
4. Change only the card format and verify an existing digest schedule is not postponed.
5. Disable the channel before scheduled delivery and verify nothing is posted. Re-enable it and confirm schedules resume.
6. Verify a legacy incoming-webhook connection still sends its normal notifications.

## Follow-up integration

These are text activity digests. Experiment scorecard images and feature activity digest images from the preserved modernization branch remain separate follow-up work. When combining this PR with the Slack AI assistant, apply its notification snooze checks to grouped and digest deliveries as well as ordinary notifications.
