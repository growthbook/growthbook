<p align="center"><a href="https://www.growthbook.io"><img src="https://cdn.growthbook.io/growthbook-logo@2x.png" width="400px" alt="GrowthBook - Open Source Feature Flagging and A/B Testing" /></a></p>
<p align="center"><b>Open Source Feature Flagging and A/B Testing</b></p>
<p align="center">
    <a href="https://github.com/growthbook/growthbook/github/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/growthbook/growthbook/ci.yml?branch=main" alt="Build Status" height="22"/></a>
    <a href="https://github.com/growthbook/growthbook/blob/main/LICENSE"><img src="https://img.shields.io/github/license/growthbook/growthbook" alt="MIT License" height="22"/></a>
    <a href="https://github.com/growthbook/growthbook/releases"><img src="https://img.shields.io/github/v/release/growthbook/growthbook?color=blue&sort=semver" alt="Release" height="22"/></a>
    <a href="https://slack.growthbook.io?ref=readme-badge"><img src="https://img.shields.io/badge/slack-join-E01E5A?logo=slack" alt="Join us on Slack" height="22"/></a>
</p>


Get up and running in 1 minute with:

```sh
git clone https://github.com/growthbook/growthbook.git
cd growthbook
docker-compose up -d
```

Then visit http://localhost:3000

[![GrowthBook Screenshot](/features-screenshot.png)](https://www.growthbook.io)

## Our Philosophy

The top 1% of companies spend thousands of hours building their own feature flagging and A/B testing platforms in-house.
The other 99% are left paying for expensive 3rd party SaaS tools or hacking together unmaintained open source libraries.

We want to give all companies the flexibility and power of a fully-featured in-house platform without needing to build it themselves.

## Major Features

- 🏁 Feature flags with advanced targeting, gradual rollouts, and experiments
- 💻 SDKs for [React](https://docs.growthbook.io/lib/react), [Javascript](https://docs.growthbook.io/lib/js), [PHP](https://docs.growthbook.io/lib/php), [Ruby](https://docs.growthbook.io/lib/ruby), [Python](https://docs.growthbook.io/lib/python), [Go](https://docs.growthbook.io/lib/go), and [Kotlin (Android)](https://docs.growthbook.io/lib/kotlin) with more coming soon
- 🆎 Powerful A/B test analysis with support for binomial, count, duration, and revenue metrics
- ❄️ Use your existing data stack - BigQuery, Mixpanel, Redshift, Google Analytics, [and more](https://docs.growthbook.io/app/datasources)
- ⬇️ Drill down into A/B test results by browser, country, or any other custom attribute
- 🪐 Export reports as a Jupyter Notebook!
- 📝 Document everything with screenshots and GitHub Flavored Markdown throughout
- 🔔 Automated email alerts when A/B tests become significant

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

Join [our Slack community](https://slack.growthbook.io?ref=readme-support) if you get stuck, want to chat, or are thinking of a new feature.

Or email us at [hello@growthbook.io](mailto:hello@growthbook.io) if Slack isn't your thing.

We're here to help - and to make GrowthBook even better!

## Contributors

We ❤️ all contributions, big and small!

Read [CONTRIBUTING.md](/CONTRIBUTING.md) for how to setup your local development environment.

If you want to, you can reach out via [Slack](https://slack.growthbook.io?ref=readme-contributing) or [email](mailto:hello@growthbook.io) and we'll set up a pair programming session to get you started.

## License

This project uses the MIT license. The core GrowthBook app will always remain open and free, although we may add some commercial enterprise add-ons in the future.
