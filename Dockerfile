ARG PYTHON_MAJOR=3.11
ARG NODE_MAJOR=20
ARG PYPI_MIRROR_URL=""
ARG UPGRADE_PIP="true"

# Build the python gbstats package
FROM python:${PYTHON_MAJOR}-slim AS pybuild
ARG PYPI_MIRROR_URL
ARG UPGRADE_PIP
WORKDIR /usr/local/src/app
COPY ./packages/stats .

# Don't write bytecode to disk
ENV PYTHONDONTWRITEBYTECODE=1
# Setup python virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:${PATH}"

# TODO: The preview environment is having network connectivity issues Feb 4, 2026.
# Revert https://github.com/growthbook/growthbook/pull/5231 once the preview build works without it
# as there is probably no need to have this conditional logic long term.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN \
  if [ "$UPGRADE_PIP" = "true" ]; then pip install --upgrade pip; fi \
  && if [ -n "$PYPI_MIRROR_URL" ]; then \
    export PIP_INDEX_URL="$PYPI_MIRROR_URL" \
    && export PIP_TRUSTED_HOST=$(echo "$PYPI_MIRROR_URL" | sed -e 's|^[^/]*//||' -e 's|/.*$||') \
    && pip install --no-cache-dir poetry==1.8.5 \
    && poetry source add --priority=primary mirror "$PYPI_MIRROR_URL" \
    && poetry lock --no-update \
    && poetry install --no-root --without dev --no-interaction --no-ansi \
    && poetry build \
    && poetry export -f requirements.txt --output requirements.txt \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir dist/*.whl ddtrace==4.3.2; \
  else \
    pip install --no-cache-dir poetry==1.8.5 \
    && poetry install --no-root --without dev --no-interaction --no-ansi \
    && poetry build \
    && poetry export -f requirements.txt --output requirements.txt \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir dist/*.whl ddtrace==4.3.2; \
  fi

# Build the nodejs app
FROM node:${NODE_MAJOR}-slim AS nodebuild
WORKDIR /usr/local/src/app
# Set node max memory for build
ENV NODE_OPTIONS="--max-old-space-size=8192"
RUN apt-get update && \
  apt-get install -y --no-install-recommends build-essential python3 ca-certificates libkrb5-dev && \
  npm install -g pnpm@10.28.2 && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*
# Fetch packages into pnpm store
# NB: patches must be present for pnpm fetch to work
COPY patches ./patches
COPY pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm fetch
# Copy over minimum files to install dependencies
COPY .npmrc ./.npmrc
COPY package.json ./package.json
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY packages/front-end/package.json ./packages/front-end/package.json
COPY packages/back-end/package.json ./packages/back-end/package.json
COPY packages/sdk-js/package.json ./packages/sdk-js/package.json
COPY packages/sdk-react/package.json ./packages/sdk-react/package.json
COPY packages/shared/package.json ./packages/shared/package.json
# Install dependencies using cached store
RUN pnpm install --frozen-lockfile --offline
# Apply patches
RUN pnpm postinstall
# Build the app and do a clean install with only production dependencies
COPY packages ./packages
RUN \
  pnpm build \
  && test -f packages/back-end/dist/server.js || (echo "ERROR: packages/back-end/dist/server.js is missing after build!" && exit 1) \
  && rm -rf node_modules \
  && rm -rf packages/back-end/node_modules \
  && rm -rf packages/front-end/node_modules \
  && rm -rf packages/front-end/.next/cache \
  && rm -rf packages/shared/node_modules \
  && rm -rf packages/sdk-js/node_modules \
  && rm -rf packages/sdk-react/node_modules \
  && pnpm install --frozen-lockfile --prod --no-optional \
  && pnpm store prune \
  && find node_modules -type f -name "*.md" -delete \
  && find node_modules -type f -name "*.ts" ! -name "*.d.ts" -delete \
  && find node_modules -type f -name "*.map" -delete \
  && find node_modules -type f -name "CHANGELOG*" -delete \
  && find node_modules -type f -name "LICENSE*" -delete \
  && find node_modules -type f -name "README*" -delete \
  && find node_modules -type d -name benchmarks -prune -exec rm -rf {} + \
  && rm -f packages/stats/poetry.lock
RUN pnpm postinstall

# Package the full app together
FROM node:${NODE_MAJOR}-slim
ARG PYTHON_MAJOR
WORKDIR /usr/local/src/app
RUN apt-get update && \
  apt-get install -y --no-install-recommends python${PYTHON_MAJOR} ca-certificates libkrb5-3 && \
  npm install -g pnpm@10.28.2 && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* && \
  ln -sf /usr/bin/python${PYTHON_MAJOR} /usr/local/bin/python3 && \
  ln -sf /usr/bin/python${PYTHON_MAJOR} /usr/local/bin/python

# Recommended settings for Python runtime in docker
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
# Copy Python virtualenv from build stage
ENV VIRTUAL_ENV=/opt/venv
COPY --from=pybuild $VIRTUAL_ENV $VIRTUAL_ENV

# Copy static config files
COPY ecosystem.config.js ./ecosystem.config.js
COPY bin/yarn ./bin/yarn
RUN chmod +x ./bin/yarn

# Set PATH for python venv + yarn shim
ENV PATH="$VIRTUAL_ENV/bin:/usr/local/src/app/bin:${PATH}"

# Copy app code from node build stage
COPY --from=nodebuild /usr/local/src/app/packages ./packages
COPY --from=nodebuild /usr/local/src/app/node_modules ./node_modules
COPY --from=nodebuild /usr/local/src/app/package.json ./package.json

# Remove TypeScript files from front-end so Next.js doesn't try to install TypeScript
RUN rm -f packages/front-end/tsconfig.json && \
    find packages/front-end -maxdepth 1 -name "*.ts" -delete && \
    find packages/front-end -maxdepth 1 -name "*.tsx" -delete

# Build metadata
COPY buildinfo* ./buildinfo
ARG DD_GIT_COMMIT_SHA=""
ARG DD_GIT_REPOSITORY_URL=https://github.com/growthbook/growthbook.git
ARG DD_VERSION=""
ENV DD_GIT_COMMIT_SHA=$DD_GIT_COMMIT_SHA
ENV DD_GIT_REPOSITORY_URL=$DD_GIT_REPOSITORY_URL
ENV DD_VERSION=$DD_VERSION

EXPOSE 3000
EXPOSE 3100
CMD ["node_modules/.bin/pm2-runtime", "start", "ecosystem.config.js"]
