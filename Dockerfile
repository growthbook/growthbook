# syntax=docker/dockerfile:1

ARG PYTHON_MAJOR=3.11
ARG NODE_MAJOR=20

# Build the python gbstats package
FROM python:${PYTHON_MAJOR}-slim-bookworm AS pybuild
WORKDIR /usr/local/src/app
COPY ./packages/stats .
RUN --mount=type=cache,target=/root/.cache/pip \
  pip3 install poetry==1.8.5  \
  && poetry install --no-root --without dev --no-interaction --no-ansi \
  && poetry build \
  && poetry export -f requirements.txt --output requirements.txt

# Base Node image
FROM node:${NODE_MAJOR}-bookworm-slim AS node-base
WORKDIR /usr/local/src/app
ENV NODE_OPTIONS="--max-old-space-size=8192"
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  apt-get update && \
  apt-get install -y python3 make g++ && \
  rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Install dependencies (cached)
FROM node-base AS deps
COPY --link package.json yarn.lock ./
COPY --link packages/front-end/package.json ./packages/front-end/package.json
COPY --link packages/back-end/package.json ./packages/back-end/package.json
COPY --link packages/sdk-js/package.json ./packages/sdk-js/package.json
COPY --link packages/sdk-react/package.json ./packages/sdk-react/package.json
COPY --link packages/shared/package.json ./packages/shared/package.json
COPY --link patches ./patches
RUN --mount=type=cache,target=/root/.yarn,sharing=locked YARN_CACHE_FOLDER=/root/.yarn \
    yarn install --frozen-lockfile
RUN yarn postinstall

# Build the app
FROM deps AS builder
COPY --link packages ./packages
RUN yarn build
# Clean up all node_modules to prepare for merging with prod-deps
RUN rm -rf node_modules packages/*/node_modules

# Install production dependencies
FROM node-base AS prod-deps
COPY --link package.json yarn.lock ./
COPY --link packages/front-end/package.json ./packages/front-end/package.json
COPY --link packages/back-end/package.json ./packages/back-end/package.json
COPY --link packages/sdk-js/package.json ./packages/sdk-js/package.json
COPY --link packages/sdk-react/package.json ./packages/sdk-react/package.json
COPY --link packages/shared/package.json ./packages/shared/package.json
COPY --link patches ./patches
RUN --mount=type=cache,target=/root/.yarn,sharing=locked YARN_CACHE_FOLDER=/root/.yarn \
    yarn install --frozen-lockfile --production=true --ignore-optional
RUN yarn postinstall

# Package the full app together
FROM python:${PYTHON_MAJOR}-slim-bookworm
ARG NODE_MAJOR
WORKDIR /usr/local/src/app

# Install Node.js
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  apt-get update && \
  apt-get install -y wget gnupg2 ca-certificates && \
  mkdir -p /etc/apt/keyrings && \
  wget -qO- https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
  apt-get update && \
  apt-get install -y nodejs && \
  npm install -g yarn && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

COPY --link --from=pybuild /usr/local/src/app/requirements.txt /usr/local/src/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install -r /usr/local/src/requirements.txt

# Copy production dependencies
COPY --link --from=prod-deps /usr/local/src/app ./

# Copy built artifacts (this merges with the prod-deps structure)
COPY --link --from=builder /usr/local/src/app/packages ./packages

# wildcard used to act as 'copy if exists'
COPY buildinfo* ./buildinfo

COPY --link --from=pybuild /usr/local/src/app/dist /usr/local/src/gbstats
RUN pip3 install /usr/local/src/gbstats/*.whl ddtrace

ARG DD_GIT_COMMIT_SHA=""
ARG DD_GIT_REPOSITORY_URL=https://github.com/growthbook/growthbook.git
ARG DD_VERSION=""
ENV DD_GIT_COMMIT_SHA=$DD_GIT_COMMIT_SHA
ENV DD_GIT_REPOSITORY_URL=$DD_GIT_REPOSITORY_URL
ENV DD_VERSION=$DD_VERSION

# The front-end app (NextJS)
EXPOSE 3000
# The back-end api (Express)
EXPOSE 3100
# Start both front-end and back-end at once
CMD ["yarn","start"]
