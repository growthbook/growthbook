<p align="center"><a href="https://www.growthbook.io"><img src="https://www.growthbook.io/logos/growthbook-logo@2x.png" width="400px" alt="Growth Book - The Open Source A/B Testing Platform" /></a></p>
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
# Then visit http://localhost:3000
```
[![Grwoth Book Screenshot](https://user-images.githubusercontent.com/1087514/124157227-26f05e00-da5e-11eb-9f73-3ceabc6ecf9e.png)](https://www.growthbook.io)

## Major Features

- ❄️ Pull data from Snowflake, Redshift, BigQuery, ClickHouse, Mixpanel, Postgres, Athena, or Google Analytics
- 🆎 Bayesian statistics engine with support for binomial, count, duration, and revenue metrics
- ⬇️ Drill down into A/B test results by browser, country, or any other attribute
- 💻 Client libraries for [React](https://github.com/growthbook/growthbook-react), [Javascript](https://github.com/growthbook/growthbook-js), [PHP](https://github.com/growthbook/growthbook-php), [Ruby](https://github.com/growthbook/growthbook-ruby), and [Python](https://github.com/growthbook/growthbook-python) with more coming soon
- 👁️ [Visual Editor](https://docs.growthbook.io/app/visual) for non-technical users to create experiments _(beta)_
- 📝 Document experiments with screenshots and GitHub Flavored Markdown
- 🔔 Automated email alerts when tests become significant
- 💡 Lightweight idea board and objective prioritization framework

## Try Growth Book

### Managed Cloud Hosting

Create a free [Growth Book Cloud](https://app.growthbook.io) account to get started.

### Open Source

Growth Book is built with a NextJS front-end, an ExpressJS API, and a Python stats engine. It uses MongoDB to store login credentials, cached experiment results, and meta data.

The front-end, back-end, and stats engine are bundled together into a single Docker image. View the image on [Docker Hub](https://hub.docker.com/r/growthbook/growthbook) for all possible environment variables and commands.

This repo includes an example [docker-compose.yml](https://github.com/growthbook/growthbook/blob/main/docker-compose.yml) file to quickly launch the app on your development machine:

```sh
docker-compose up -d
# Then visit http://localhost:3000
```

If you have any questions or need help, [please get in touch](mailto:hello@growthbook.io)!

## Documentation and Support

View the [Growth Book Docs](https://docs.growthbook.io) for info on how to setup and use the platform.

Join [our Slack community](https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg) if you get stuck, want to chat, or are thinking of a new feature. We're here to help - and to make Growth Book even better.

## Contributors

We ❤️ all contributions!

Read [CONTRIBUTING.md](/CONTRIBUTING.md) for how to setup your local development environment.

If you want to, you can reach out via [Slack](https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg) or [email](mailto:hello@growthbook.io) and we'll set up a pair programming session to get you started.

## License

This project uses the MIT license. The core Growth Book app will always remain open and free, although we may add some commercial enterprise add-ons in the future.
