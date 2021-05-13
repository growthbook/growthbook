<p align="center"><img src="https://www.growthbook.io/logos/growthbook-logo@2x.png" width="400px" /></p>

# Open Source A/B Testing Platform

This repo is the actual Growth Book application where you connect to your data sources, define metrics, and analyze experiment results.

In addition, there are **client libraries** to help you implement A/B tests in [React](https://github.com/growthbook/growthbook-react), [Javascript](https://github.com/growthbook/growthbook-js), [PHP](https://github.com/growthbook/growthbook-php), and [Ruby](https://github.com/growthbook/growthbook-ruby) with more coming soon.

## Major Features

- Query multiple data sources (Snowflake, Redshift, BigQuery, Mixpanel, Postgres, Athena, and Google Analytics)
- Bayesian statistics engine with support for binomial, count, duration, and revenue metrics
- Drill down into A/B test results (e.g. by browser, country, etc.)
- Lightweight idea board and prioritization framework
- Document everything! (upload screenshots, add markdown comments, and more)
- Automated email alerts when tests become significant

## Community

Join [our Growth Book Users Slack community](https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg) if you need help, want to chat, or are thinking of a new feature. We're here to help - and to make Growth Book even better.

## Requirements

- NodeJS 12.x or higher (https://nodejs.org/en/)
- Yarn (`sudo npm install -g yarn`)
- MongoDB 3.2 or higher
- A compatible data source (Snowflake, Redshift, BigQuery, Mixpanel, Postgres, Athena, or Google Analytics)
- AWS S3 bucket and access keys that allow writing (for image/file uploads)
- An email provider for sending invites, forgot password emails, etc.
- Google OAuth keys (only if using Google Analytics as a data source)

Don't want to install, deploy, and maintain Growth Book on your own? Let us do it for you at https://www.growthbook.io

## Setup

```sh
# Install dependencies
yarn

# Create .env.local files for the front-end and back-end
yarn init:dev
```

Edit the default values in `packages/back-end/.env.local` and `packages/front-end/.env.local` as needed.

### MongoDB

To quickly get a local MongoDB instance running for development, you can use docker:

```sh
docker run -d --name mongo \
    -e MONGO_INITDB_ROOT_USERNAME=root \
    -e MONGO_INITDB_ROOT_PASSWORD=password \
    mongo
```

For production, we recommend using MongoDB Atlas or another fully managed service.
The Growth Book app only stores meta info and aggregate stats, so the size of MongoDB should stay comfortably within the free tier for most deployments.

### Email

Growth Book sends a few transactional emails (team member invites, forgot password, etc.).

You can configure the email server using environment variables. Here's an example for Sendgrid:

```
EMAIL_ENABLED=true
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=465
EMAIL_HOST_USER=apikey
EMAIL_HOST_PASSWORD=SG.123abc
EMAIL_USE_TLS=true
EMAIL_FROM=noreply@example.com
# Site Manager is alerted when a new organization is created
SITE_MANAGER_EMAIL=admin@example.com
```

## Running Growth Book

This is a monorepo with 3 packages - `back-end`, `front-end`, and `docs`. For ease-of-use, we've added helper scripts at the top level.

### Development

- `yarn dev` - Start dev servers with hot reloading
  - Front-end: http://localhost:3000
  - Back-end: http://localhost:3100
  - Docs: http://localhost:3200
- `yarn lint` - Run eslint and auto-fix errors when possible
- `yarn pretty` - Run prettier across the entire codebase
- `yarn type-check` - Check for typescript compile errors
- `yarn test` - Run the test suites

### Production

For production, you must first build with Typescript/Webpack and then serve it with NodeJS.

- `yarn build:front` - Build the front-end and output to `packages/front-end/dist/`
- `yarn build:back` - Build the back-end and output to `packages/back-end/dist/`
- `yarn build:docs` - Build the docs and output to `packages/docs/dist/`
- `yarn build` - Build everything in parallel
- `yarn start:front` - Serve the front-end at http://localhost:3000
- `yarn start:back` - Serve the back-end at http://localhost:3100
- `yarn start:docs` - Serve the docs at http://localhost:3200

## License

This project uses the MIT license. The core Growth Book app will always remain free, although we may add some commercial enterprise add-ons in the future.
