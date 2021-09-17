<p align="center"><a href="https://www.growthbook.io"><img src="https://www.growthbook.io/logos/growthbook-logo@2x.png" width="400px" alt="GrowthBook - The Open Source A/B Testing Platform" /></a></p>
<p align="center"><b>The Open Source A/B Testing Platform</b></p>
<p align="center">
    <a href="https://github.com/growthbook/growthbook/actions/workflows/ci.yml"><img src="https://img.shields.io/github/workflow/status/growthbook/growthbook/CI" alt="Build Status" height="22"/></a>
    <a href="https://github.com/growthbook/growthbook/blob/main/LICENSE"><img src="https://img.shields.io/github/license/growthbook/growthbook" alt="MIT License" height="22"/></a>
    <a href="https://github.com/growthbook/growthbook/releases"><img src="https://img.shields.io/github/v/release/growthbook/growthbook?color=blue&sort=semver" alt="Release" height="22"/></a>
    <a href="https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg"><img src="https://img.shields.io/badge/slack-join-E01E5A?logo=slack" alt="Join us on Slack" height="22"/></a>
</p>

Get up and running in 1 minute with:

```sh
git clone https://github.com/growthbook/growthbook.git
cd growthbook
docker-compose up -d
```

Then visit http://localhost:3000

[![GrowthBook Screenshot](https://user-images.githubusercontent.com/1087514/124157227-26f05e00-da5e-11eb-9f73-3ceabc6ecf9e.png)](https://www.growthbook.io)

## Our Philosophy

The top 1% of companies spend thousands of hours building their own A/B testing platforms in-house.
The other 99% are left paying for expensive 3rd party SaaS tools or hacking together unmaintained open source libraries.

GrowthBook gives you the flexibility and power of a fully-featured in-house A/B testing platform without needing to build it yourself.

## Major Features

- ❄️ Pull data from Snowflake, Redshift, BigQuery, Mixpanel, Google Analytics, [and more](https://docs.growthbook.io/app/datasources)
- 🆎 Bayesian statistics engine with support for binomial, count, duration, and revenue metrics
- ⬇️ Drill down into A/B test results by browser, country, or any other attribute
- 🪐 Export results as a Jupyter Notebook!
- 💻 Client libraries for [React](https://docs.growthbook.io/lib/react), [Javascript](https://docs.growthbook.io/lib/js), [PHP](https://github.com/growthbook/growthbook-php), [Ruby](https://github.com/growthbook/growthbook-ruby), and [Python](https://github.com/growthbook/growthbook-python) with more coming soon
- 👁️ [Visual Editor](https://docs.growthbook.io/app/visual) for non-technical users to create experiments _(beta)_
- 📝 Document experiments with screenshots and GitHub Flavored Markdown
- 🔔 Automated email alerts when tests become significant
- 💡 Lightweight idea board and objective prioritization framework

## Try GrowthBook

### Managed Cloud Hosting

Create a free [GrowthBook Cloud](https://app.growthbook.io) account to get started.

### Open Source

The included [docker-compose.yml](https://github.com/growthbook/growthbook/blob/main/docker-compose.yml) file contains the GrowthBook App and a MongoDB instance (for storing cached experiment results and metadata):

```sh
git clone https://github.com/growthbook/growthbook.git
cd growthbook
docker-compose up -d
```

Then visit http://localhost:3000 to view the app.

Check out the full [Self-Hosting Instructions](https://docs.growthbook.io/self-host) for more details.

## Documentation and Support

View the [GrowthBook Docs](https://docs.growthbook.io) for info on how to configure and use the platform.

Join [our Slack community](https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg) if you get stuck, want to chat, or are thinking of a new feature.

Or email us at [hello@growthbook.io](mailto:hello@growthbook.io) if Slack isn't your thing.

We're here to help - and to make GrowthBook even better!

## Contributors

We ❤️ all contributions, big and small!

Read [CONTRIBUTING.md](/CONTRIBUTING.md) for how to setup your local development environment.

If you want to, you can reach out via [Slack](https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg) or [email](mailto:hello@growthbook.io) and we'll set up a pair programming session to get you started.

## License

This project uses the MIT license. The core GrowthBook app will always remain open and free, although we may add some commercial enterprise add-ons in the future.
