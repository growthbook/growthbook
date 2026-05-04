# Contributing Guide

Interested in making GrowthBook better? So are we! This guide should help get you setup with a local development environment so you can make changes, create PRs, and get your code merged.

If you just want to contribute a client library in a new language and not make changes to the app itself, you can skip the instructions here and view https://docs.growthbook.io/lib/build-your-own instead.

## Requirements

- MacOS or Linux (Windows may work too, but we haven't tested it)
- [NodeJS](https://nodejs.org/en/download/package-manager/) 24.x or above
  - Check version by running `node -v` on terminal
- [pnpm](https://pnpm.io/installation)
- [Python](https://www.python.org/downloads/) 3.9+ (for the stats engine)
  - [scipy](https://scipy.org/install/)
  - [numpy](https://numpy.org/install/)
  - [pandas](https://pandas.pydata.org/docs/getting_started/install.html)
- [Docker](https://docs.docker.com/engine/install/) (for running MongoDB locally)

### Windows users

One sure shot way to run GrowthBook on Windows is through installing [Windows Subsystem for Linux (WSL)](https://docs.microsoft.com/en-us/windows/wsl/setup/environment#set-up-your-linux-user-info). These are some of the steps to follow, also outlined in the link above:

1. Search for your terminal app in the windows search bar
2. Select the option to "Run as administrator"
3. Now, on the terminal, run `wsl --install`
4. After the installation is complete, restart your computer
5. Set up your Linux username and password
6. Run `sudo apt update && sudo apt upgrade` (for Ubuntu or Debian) to update and upgrade packages

Now you have the basic Linux system set up, and can follow along with all the other steps.

It's **strongly recommended** that if you are using WSL on Windows that you run the project from your `/home/:user` directory rather than a `/mnt/` directory: the `/mnt` directory has poor performance, and the file watcher for nodemon will not work, requiring you to manually stop and re-run the `pnpm dev` command.

## Getting started

1. Fork the project
2. Clone your forked project by running `git clone git@github.com:{ YOUR_USERNAME }/growthbook.git`
   - Can also use `git clone` and list the HTTPS URL of the repo afterwards
3. Run `cd growthbook`
4. Run `pnpm install` to install dependencies
5. Install [poetry](https://python-poetry.org/docs/)
   - Run `curl -sSL https://install.python-poetry.org | python3 -`
   - Close and reopen your terminal
   - Run `poetry --version` to confirm a successful install
   - If unsuccessful add the Poetry path (ex. `$HOME/.poetry/bin`) to your global path (ex. `/etc/profile`, `/etc/environment`, `~/.bashrc`, `~/.zshrc`)
6. Run `pnpm run setup` to do the initial build
7. If you have Docker installed, start MongoDB in Docker:

```sh
docker run -d -p 27017:27017 --name mongo \
  -e MONGO_INITDB_ROOT_USERNAME=root \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  -v ~/gb_mongo_data/:/data/db \
  mongo
```

The -v is optional and will store the data in your ~/gb_mongo_data directory on your computer. This will allow you to start a new docker container with the same command in case the old one dies preserving your data. Setup can also be shared between devs
by replacing the contents of that directory with theirs.

If docker isn't running, view [this](https://stackoverflow.com/questions/44678725/cannot-connect-to-the-docker-daemon-at-unix-var-run-docker-sock-is-the-docker).
Look at [this](https://www.digitalocean.com/community/questions/how-to-fix-docker-got-permission-denied-while-trying-to-connect-to-the-docker-daemon-socket) for other docker issues with Linux

Otherwise, install [Mongo](https://www.mongodb.com/docs/manual/installation/) directly (no Docker)

8. Run `pnpm dev` to start the app in dev mode
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
- **packages/shared** is a collection of Typescript functions and constants shared between the front-end and back-end.
- **packages/sdk-js** is our javascript SDK (`@growthbook/growthbook` on npm)
- **packages/sdk-react** is our React SDK (`@growthbook/growthbook-react` on npm)
- **packages/stats** is our Python stats engine (`gbstats` on PyPi)
- **docs** is a Docusaurus instance for our documentation site (https://docs.growthbook.io).

Depending on what you're changing, you may need to edit one or more of these packages.

### Enterprise Code

The `front-end`, `back-end`, and `shared` packages each have an `enterprise` directory containing non-open source code. We typically do not accept outside contributions to these directories. Please reach out if you have any questions.

### Working on the main app

The `pnpm dev` command starts both the front-end and back-end in parallel.

The packages are available at the following urls with hot-reloading:

- Front-end: http://localhost:3000
- Back-end: http://localhost:3100

#### Accessing the MongoDB database

GrowthBook uses MongoDB as a primary data store, and while working on the code it may be necessary to access the database directly. [MongoDB Compass](https://www.mongodb.com/products/compass) is the easiest way, but you can also use the [mongosh shell](https://www.mongodb.com/docs/mongodb-shell/).

##### MongoDB Compass

To access MongoDB with the MongoDB Compass GUI, you can do the following after opening MongoDB Compass:

1. In the menu bar, click **Connect** and choose **New Connection**
2. Paste the connection string you configured in your `.env.local` here
3. Press **Connect**

At this point you should be connected to MongoDB and see your databases. Click into the desired database, e.g. `growthbook`, to view your collections.

##### Mongo Shell

To access MongoDB with the `mongosh` shell, run the following command:

```sh
docker exec -it mongo bash
```

Alternatively, if you are using Docker Desktop, you can click the CLI button to execute the shell for the Mongo container.

Then login as the user of the database. If your user is `root`:

```sh
mongosh -u root
```

###### mongosh Commands

- `show dbs` should show you the databases in Mongo
- `use <databasename>` will allow you to change to the right database. By default, you may be in another database and may need to call `use growthbook`
- `show collections` should show you the collections for the database you are using. This will throw an error if you are not logged in as the correct user.
- `db` is available and you should be able to run queries against it, e.g. `db.users.find()`

### Working on docs

To start the docs site, first `cd docs` and then run `pnpm install` to install and `pnpm dev` to run the docs server. You can view the site at http://localhost:3200

### Working on the SDKs

To work on the SDKs, `cd` into the desired directory and the following commands are available:

- `pnpm test` - Run the test suite
- `pnpm build` - Run the rollup build process
- `pnpm size` - Get the gzip size of the bundle (must run `pnpm build` first)

#### Releasing SDK Updates

Releasing SDK updates is a very manual process right now. It requires bumping versions in many different files, updating changelogs, and adding metadata to shared packages.

1. Create a branch from the latest main
2. Run `pnpm bump-sdk-version patch` (or `minor` or `major`)
3. Add new entry to `packages/sdk-js/CHANGELOG.md`
4. If any new capabilities were added, update relevant `packages/shared/src/sdk-versioning/sdk-versions/` files (javascript, nodejs, react, nocode). Also re-generate the sdk-info in docs.
5. Do a global search for the old version string to make sure nothing was missed. Update the `bump-version.js` script if you find anything.
6. Create a PR and let CI complete successfully. Use the changelog entry as the PR description.
7. Publish the Javascript SDK
   - `pnpm build`
   - `npm publish`
8. Publish the React SDK
   - `pnpm build`
   - `npm publish`
9. Merge the PR

### Working on the stats engine

Ensure you have run `pnpm run setup` first to install the poetry virtual environment before working in the stats engine. Otherwise, pre-commit hooks and the following commands will error.

- `pnpm --filter stats test` - Run pytest
- `pnpm --filter stats lint` - Run flake8, black, and pyright
- `pnpm --filter stats build` - Run the build process
- `pnpm --filter stats notebook` - Spin up a Jupyter Notebook with `gbstats` and other dependencies in the kernel

You can also just run `yarn *` where \* is test, lint, build if you `cd` to the `packages/stats` directory first.

## Code Quality

There are a few repo-wide code quality tools:

- `yarn test` - Run the full test suite on all packages
- `yarn type-check` - Typescript type checking
- `yarn lint` - Typescript code linting
- `yarn workspace stats lint` - Python code linting (ensure you have run `yarn setup` first to install the poetry virtual environment)

There is a pre-commit hook that runs `yarn lint` automatically, so you shouldn't need to run that yourself.

## Opening Pull Requests

1. Please Provide a thoughtful commit message and push your changes to your fork using
   `git push origin main` (assuming your forked project is using `origin` for
   the remote name and you are on the `main` branch).

2. Open a Pull Request on GitHub with a description of your changes.

## Troubleshooting

### `/bin/activate: No such file or directory`

If you see this warning, it is likely because you ran `yarn setup` from within a Python virtual environment, and Poetry currently does not create a custom environment for the stats library from within another virtual environment (see: https://github.com/python-poetry/poetry/issues/4055).

To resolve this, ensure you are not using a Python virtual environment and re-run `yarn setup` from the project root.

## Getting Help

Join our [Slack community](https://slack.growthbook.io?ref=contributing) if you need help getting set up or want to chat. We're also happy to hop on a call and do some pair programming.
