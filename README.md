<p align="center"><a href="https://www.growthbook.io"><img src="https://www.growthbook.io/logos/growthbook-logo@2x.png" width="400px" alt="Growth Book - The Open Source A/B Testing Platform" /></a></p>
<p align="center"><b>The Open Source A/B Testing Platform</b></p>
<p align="center">
    <a href="https://github.com/growthbook/growthbook/actions/workflows/ci.yml"><img src="https://img.shields.io/github/workflow/status/growthbook/growthbook/CI" alt="Build Status" height="22"/></a>
    <a href="https://github.com/growthbook/growthbook/blob/main/LICENSE"><img src="https://img.shields.io/github/license/growthbook/growthbook" alt="MIT License" height="22"/></a>
    <a href="https://github.com/growthbook/growthbook/releases"><img src="https://img.shields.io/github/v/release/growthbook/growthbook?color=blue&sort=semver" alt="Release" height="22"/></a>
    <a href="https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg"><img src="https://img.shields.io/badge/slack-join-E01E5A" alt="Join us on Slack" height="22"/></a>
</p>

![growthbook-results](https://user-images.githubusercontent.com/1087514/119926797-a958a000-bf3d-11eb-8a6d-7f01383f4f68.png)

## Major Features

- Client libraries for [React](https://github.com/growthbook/growthbook-react), [Javascript](https://github.com/growthbook/growthbook-js), [PHP](https://github.com/growthbook/growthbook-php), and [Ruby](https://github.com/growthbook/growthbook-ruby) with more coming soon
- [Visual Editor](https://docs.growthbook.io/app/visual) for non-technical users to create experiments _(beta)_
- Query multiple data sources (Snowflake, Redshift, BigQuery, Mixpanel, Postgres, Athena, and Google Analytics)
- Bayesian statistics engine with support for binomial, count, duration, and revenue metrics
- Drill down into A/B test results (e.g. by browser, country, etc.)
- Lightweight idea board and prioritization framework
- Document everything! (upload screenshots, add markdown comments, and more)
- Automated email alerts when tests become significant

## Community

Join [our Growth Book Users Slack community](https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg) if you need help, want to chat, or are thinking of a new feature. We're here to help - and to make Growth Book even better.

## Requirements

- NodeJS 12.x or higher
- Yarn
- MongoDB 3.2 or higher
- A compatible data source (Snowflake, Redshift, BigQuery, Mixpanel, Postgres, Athena, or Google Analytics)
- _(optional)_ An SMTP server for emailing invites, reset password links, etc.
- _(optional)_ Google OAuth keys (only if using Google Analytics as a data source)

Don't want to install, deploy, and maintain Growth Book on your own? Let us do it for you at https://www.growthbook.io

## Dev Quick Start

1.  Start MongoDB locally:
    ```sh
    docker run -d -p 27017:27017 --name mongo \
      -e MONGO_INITDB_ROOT_USERNAME=root \
      -e MONGO_INITDB_ROOT_PASSWORD=password \
      mongo
    ```
2.  Run `yarn` to install dependencies
3.  Run `yarn dev` and visit http://localhost:3000

If you need to change any of the default settings (e.g. to configure an email server or add Google OAuth Keys), copy `packages/back-end/.env.example` to `packages/back-end/.env.local` and edit that file as needed.

View the full developer docs at https://docs.growthbook.io

## License

This project uses the MIT license. The core Growth Book app will always remain free, although we may add some commercial enterprise add-ons in the future.
