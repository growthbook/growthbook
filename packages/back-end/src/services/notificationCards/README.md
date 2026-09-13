# Notification card previews

From the repository root, after installing dependencies, build shared packages
and render the previews:

```sh
pnpm build:deps
pnpm --filter back-end preview:notification-cards
```

Open the printed local HTML file in your browser. It shows compact and detailed
PNG cards generated from the built-in sample SRM warning data using the same
renderer as notification delivery. The PNG files are alongside the HTML file
in a new temporary directory on each run. No Slack credentials, running server,
database, or customer data are needed, and nothing is sent to Slack.

These samples help check fonts, layout, and renderer changes. They are not an
end-to-end delivery test and do not imply that every renderer state is currently
mapped to a notification event. In the initial cards release, only SRM warnings
produce cards; significance and unsupported warning events remain text-only.

For a delivery test, connect a test Slack channel in GrowthBook and use the
Event Webhook's Test action. A generic webhook test checks notification delivery;
it does not necessarily generate an SRM card.
