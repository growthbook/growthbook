# Contributing Guide

Interested in making GrowthBook better? So are we! This guide should help get you setup with a local development environment so you can make changes, create PRs, and get your code merged.

If you just want to contribute a client library in a new language and not make changes to the app itself, you can skip the instructions here and view https://docs.growthbook.io/lib/build-your-own instead.

## Requirements

- MacOS or Linux (Windows may work too, but we haven't tested it)
- NodeJS 12.x or 14.x
- Yarn
- Python 3.6+ (for the stats engine)
  - scipy
  - numpy
  - pandas
- Docker (for running MongoDB locally)

## Getting started

1. Fork the project
2. Clone your forked project by running `git clone git@github.com:{ YOUR_USERNAME }/growthbook.git`
3. Run `cd growthbook`
4. Run `yarn` to install dependencies
5. Install [poetry](https://python-poetry.org/docs/master/#installing-with-the-official-installer)
6. Run `yarn setup` to do the initial build
7. Start MongoDB in Docker

```sh
docker run -d -p 27017:27017 --name mongo \
  -e MONGO_INITDB_ROOT_USERNAME=root \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  mongo
```

8. Run `yarn dev` to start the app in dev mode
9. Visit http://localhost:3000 in your browser and verify the app is working correctly

### Changing Configuration Settings

If you need to change any of the default configuration settings, you can use environment variables:

- Back-end: `cp packages/back-end/.env.example packages/back-end/.env.local`
- Front-end: `cp packages/front-end/.env.example packages/front-end/.env.local`

Then, edit the `.env.local` files as needed.

## Writing code!

This repository is a monorepo with the following packages:

- **packages/front-end** is a Next.js app and contains the full UI of the GrowthBook app.
- **packages/back-end** is an Express app and serves as the REST api for the front-end.
- **packages/docs** is another Next.js app of our documentation site (https://docs.growthbook.io).
- **packages/sdk-js** is our javascript SDK (`@growthbook/growthbook` on npm)
- **packages/sdk-react** is our React SDK (`@growthbook/growthbook-react` on npm)
- **packages/stats** is our Python stats engine (`gbstats` on PyPi)

Depending on what you're changing, you may need to edit one or more of these packages.

### Working on the main app

The `yarn dev` command starts both the front-end and back-end in parallel.

The back-end can take up to 30 seconds for the initial build, so be patient.

The packages are available at the following urls with hot-reloading:

- Front-end: http://localhost:3000
- Back-end: http://localhost:3100

### Working on docs

To start the docs site, run `yarn workspace docs dev`. You can view the site at http://localhost:3200

### Working on the SDKs

To work on the SDKs, `cd` into the desired directory and the following commands are available:

- `yarn test` - Run just
- `yarn build` - Run the rollup build process
- `yarn size` - Get the gzip size of the bundle (must run `yarn build` first)

### Working on the stats engine

To work on the Python stats engine, `cd` into the `packages/stats` directory and the following commands are available:

- `yarn test` - Run pytest
- `yarn lint` - Run flake8 and black
- `poetry build` - Run the build process

## Code Quality

There are a few repo-wide code quality tools:

- `yarn test` - Run the full test suite on all packages
- `yarn type-check` - Typescript type checking
- `yarn lint` - Typescript code linting
- `yarn workspace stats lint` - Python code linting (need to `pip install flake8 black` first)

There is a pre-commit hook that runs `yarn lint` automatically, so you shouldn't need to run that yourself.

## Opening Pull Requests

1. Please Provide a thoughtful commit message and push your changes to your fork using
   `git push origin main` (assuming your forked project is using `origin` for
   the remote name and you are on the `main` branch).

2. Open a Pull Request on GitHub with a description of your changes.

## Getting Help

Join our [Slack community](https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg) if you need help getting set up or want to chat. We're also happy to hop on a call and do some pair programming.
