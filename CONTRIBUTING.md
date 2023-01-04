# Contributing Guide

Interested in making GrowthBook better? So are we! This guide should help get you setup with a local development environment so you can make changes, create PRs, and get your code merged.

If you just want to contribute a client library in a new language and not make changes to the app itself, you can skip the instructions here and view https://docs.growthbook.io/lib/build-your-own instead.

## Quickstart

The fastest way to start contributing to GrowthBook is by using our pre configured devcontainer. A dev container is a Docker container that is specifically configured to provide a full-featured development environment.

1. Install the vscode extension [Remote - Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers). Launch VS code Quick Open `Ctrl + P` then paste the following command `ext install ms-vscode-remote.remote-containers` and press enter.
2. If you do not have Docker installed follow these instructions [Docker](https://docs.docker.com/engine/install/)
3. Open the Command Palette `Ctrl + Shift + P` then paste the following command `Remote-Containers: Reopen in Container` and press enter.

## Requirements

- MacOS or Linux (Windows may work too, but we haven't tested it)
- [NodeJS](https://nodejs.org/en/download/package-manager/) 16.x or higher
  - Check version by running `node -v` on terminal
- [Yarn](https://classic.yarnpkg.com/en/docs/install)
- [Python](https://www.python.org/downloads/) 3.8+ (for the stats engine)
  - [scipy](https://scipy.org/install/)
  - [numpy](https://numpy.org/install/)
  - [pandas](https://pandas.pydata.org/docs/getting_started/install.html)
- [Docker](https://docs.docker.com/engine/install/) (for running MongoDB locally)

## Windows users

One sure shot way to run GrowthBook on Windows is through installing [Windows Subsystem for Linux (WSL)](https://docs.microsoft.com/en-us/windows/wsl/setup/environment#set-up-your-linux-user-info). These are some of the steps to follow, also outlined in the link above:

1. Search for your terminal app in the windows search bar
2. Select the option to "Run as administrator"
3. Now, on the terminal, run `wsl --install`
4. After the installation is complete, restart your computer
5. Set up your Linux username and password
6. Run `sudo apt update && sudo apt upgrade` (for Ubuntu or Desbian) to update and upgrade packages

Now you have the basic Linux system set up, and can follow along with all the other steps.

It's **strongly recommended** that if you are using WSL on Windows that you run the project from your `/home/:user` directory rather than a `/mnt/` directory: the `/mnt` directory has poor performance, and the file watcher for nodemon will not work, requiring you to manually stop and re-run the `yarn dev` command.

## Getting started

1. Fork the project
2. Clone your forked project by running `git clone git@github.com:{ YOUR_USERNAME }/growthbook.git`
   - Can also use `git clone` and list the HTTPS URL of the repo afterwards
3. Run `cd growthbook`
4. Run `yarn` to install dependencies
5. Install [poetry](https://python-poetry.org/docs/)
   - Run `curl -sSL https://install.python-poetry.org | python3 -`
   - Close and reopen your terminal
   - Run `poetry --version` to confirm a successful install
   - If unsuccessful add the Poetry path (ex. `$HOME/.poetry/bin`) to your global path (ex. `/etc/profile`, `/etc/environment`, `~/.bashrc`, `~/.zshrc`)
6. Run `yarn setup` to do the initial build
7. If you have Docker installed, start MongoDB in Docker:

```sh
docker run -d -p 27017:27017 --name mongo \
  -e MONGO_INITDB_ROOT_USERNAME=root \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  mongo
```

If docker isn't running, view [this](https://stackoverflow.com/questions/44678725/cannot-connect-to-the-docker-daemon-at-unix-var-run-docker-sock-is-the-docker).
Look at [this](https://www.digitalocean.com/community/questions/how-to-fix-docker-got-permission-denied-while-trying-to-connect-to-the-docker-daemon-socket) for other docker issues with Linux

Otherwise, install [Mongo](https://www.mongodb.com/docs/manual/installation/) directly (no Docker)

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
- **packages/sdk-js** is our javascript SDK (`@growthbook/growthbook` on npm)
- **packages/sdk-react** is our React SDK (`@growthbook/growthbook-react` on npm)
- **packages/stats** is our Python stats engine (`gbstats` on PyPi)
- **docs** is a Docusaurus instance for our documentation site (https://docs.growthbook.io).

Depending on what you're changing, you may need to edit one or more of these packages.

### Working on the main app

The `yarn dev` command starts both the front-end and back-end in parallel.

The back-end can take up to 30 seconds for the initial build, so be patient.

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

To start the docs site, first `cd docs` and then run `yarn dev`. You can view the site at http://localhost:3200

### Working on the SDKs

To work on the SDKs, `cd` into the desired directory and the following commands are available:

- `yarn test` - Run Jest
- `yarn build` - Run the rollup build process
- `yarn size` - Get the gzip size of the bundle (must run `yarn build` first)

### Working on the stats engine

To work on the Python stats engine, `cd` into the `packages/stats` directory and the following commands are available:

- `. $(cd packages/stats && poetry env info --path)/bin/activate && yarn test` - Run pytest
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

## Troubleshooting

### `black` not found

If you experience issues with `black` when committing during the pre-commit hook stage, it's possible your virtual environment is not enabled. Run the following from the project root: `. $(cd packages/stats && poetry env info --path)/bin/activate`.

If you get the error that `poetry env info --path` is not defined, try re-running `yarn setup` from the project root.

## Getting Help

Join our [Slack community](https://slack.growthbook.io?ref=contributing) if you need help getting set up or want to chat. We're also happy to hop on a call and do some pair programming.
