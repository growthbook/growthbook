<p align="center"><a href="https://www.growthbook.io"><img src="https://cdn.growthbook.io/growthbook-logo@2x.png" width="400px" alt="GrowthBook" /></a></p>
<p align="center"><b>Open Source Feature Flags, Experimentation, and Product Analytics</b></p>
<p align="center">
    <a href="https://github.com/growthbook/growthbook/github/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/growthbook/growthbook/ci.yml?branch=main" alt="Build Status" height="22"/></a>
    <a href="https://github.com/growthbook/growthbook/releases"><img src="https://img.shields.io/github/v/release/growthbook/growthbook?color=blue&sort=semver" alt="Release" height="22"/></a>
    <a href="https://slack.growthbook.io?ref=readme-badge"><img src="https://img.shields.io/badge/slack-join-E01E5A?logo=slack" alt="Join us on Slack" height="22"/></a>
</p>

Create a free [GrowthBook Cloud](https://app.growthbook.io) account to get started quickly.

Or run it yourself with:

```sh
git clone https://github.com/growthbook/growthbook.git
cd growthbook
docker compose up -d
```

Then visit http://localhost:3000. View the full [Self-Hosting Instructions](https://docs.growthbook.io/self-host) for more details.

[![GrowthBook Screenshot](/features-screenshot.png)](https://www.growthbook.io)

## Our Philosophy

The top 1% of companies spend thousands of hours building their own in-house experimentation, feature flagging, and analytics platforms.
The other 99% are left paying for expensive 3rd party SaaS tools or hacking together unmaintained open source libraries.

We want to give all companies the flexibility and power of a fully-featured in-house platform without needing to build it themselves.

## Major Features

- 🏁 Feature flags with advanced targeting, gradual rollouts, and experiments
- 💻 24 SDKs including [React](https://docs.growthbook.io/lib/react), [Python](https://docs.growthbook.io/lib/python), [Android](https://docs.growthbook.io/lib/kotlin), and [iOS](https://docs.growthbook.io/lib/swift). [View all](https://docs.growthbook.io/lib)
- 🆎 World class experiment stats engine (CUPED, Sequential, Bayesian, Post-Strat, Bandits, SRM checks).
- ❄️ Warehouse Native. Query 11 data sources including BigQuery, Snowflake, and Databricks. [View all](https://docs.growthbook.io/app/datasources).
- 🎯 Flexible SQL-backed metric definitions. Simple conversion rates, ratios, quantiles, and more.
- 📊 Built-in Product Analytics suite to build dashboards and share with your team.
- 📝 Document everything with screenshots, custom meta fields, and Markdown throughout.
- 🔔 Webhooks and a full REST API for building integrations and custom workflows.
- 🤖 MCP server to create features, start experiments, clean up stale flags, and more.

## Documentation and Support

View the [GrowthBook Docs](https://docs.growthbook.io) for info on how to configure and use the platform.

Join [our Slack community](https://slack.growthbook.io?ref=readme-support) if you get stuck, want to chat, or are thinking of a new feature.

Or email us at [hello@growthbook.io](mailto:hello@growthbook.io) if Slack isn't your thing.

We're here to help - and to make GrowthBook even better!

## Contributors

We ❤️ all contributions, big and small!

Read [CONTRIBUTING.md](/CONTRIBUTING.md) for how to setup your local development environment.

If you want to, you can reach out via [Slack](https://slack.growthbook.io?ref=readme-contributing) or [email](mailto:hello@growthbook.io) and we'll set up a pair programming session to get you started.

## License

GrowthBook is an Open Core product. The bulk of the code is under the permissive MIT license. There are several directories that are governed under a separate commercial license, the GrowthBook Enterprise License.

View the `LICENSE` file in this repository for the full text and details.

![GrowthBook Repository Stats](https://repobeats.axiom.co/api/embed/13ffc63ec5ce7fe45efa95dd326d9185517f0a15.svg "GrowthBook Repository Stats")
