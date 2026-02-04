ARG PYTHON_MAJOR=3.11
ARG NODE_MAJOR=20

# Build the python gbstats package
FROM python:${PYTHON_MAJOR}-slim AS pybuild
WORKDIR /usr/local/src/app
COPY ./packages/stats .
ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ENV PIP_TRUSTED_HOST=mirrors.aliyun.com
RUN \
  pip3 install --retries 10 --timeout 60 poetry==1.8.5 \
  && poetry install --no-root --without dev --no-interaction --no-ansi \
  && poetry build \
  && poetry export -f requirements.txt --output requirements.txt

# Build the nodejs app
FROM python:${PYTHON_MAJOR}-slim AS nodebuild
ARG NODE_MAJOR
WORKDIR /usr/local/src/app
# Set node max memory
ENV NODE_OPTIONS="--max-old-space-size=8192"
RUN apt-get update && \
  apt-get install -y wget gnupg2 build-essential ca-certificates libkrb5-dev && \
  mkdir -p /etc/apt/keyrings && \
  wget -qO- https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
  apt-get update && \
  apt-get install -yqq nodejs && \
  npm install -g pnpm@9.15.0 && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*
# Copy over minimum files to install dependencies
COPY .npmrc ./.npmrc
COPY package.json ./package.json
COPY pnpm-lock.yaml ./pnpm-lock.yaml
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY packages/front-end/package.json ./packages/front-end/package.json
COPY packages/back-end/package.json ./packages/back-end/package.json
COPY packages/sdk-js/package.json ./packages/sdk-js/package.json
COPY packages/sdk-react/package.json ./packages/sdk-react/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY patches ./patches
# pnpm install with dev dependencies (will be cached as long as dependencies don't change)
RUN pnpm install --frozen-lockfile
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
  && find node_modules -type d -name benchmarks -prune -exec rm -rf {} +
RUN pnpm postinstall


# Package the full app together
FROM python:${PYTHON_MAJOR}-slim
ARG NODE_MAJOR
WORKDIR /usr/local/src/app
# TODO: Remove openssl upgrade once base image has version >3.5.4-1~deb13u2
# Check with: `docker run --rm python:3.11-slim dpkg -l | grep openssl`
RUN apt-get update && \
  apt-get install --only-upgrade -y openssl && \
  apt-get install -y wget gnupg2 build-essential ca-certificates libkrb5-dev && \
  mkdir -p /etc/apt/keyrings && \
  wget -qO- https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
  apt-get update && \
  apt-get install -yqq nodejs && \
  npm install -g pnpm@9.15.0 && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*
RUN pip install --upgrade pip
COPY --from=pybuild /usr/local/src/app/requirements.txt /usr/local/src/requirements.txt
RUN pip3 install -r /usr/local/src/requirements.txt && rm -rf /root/.cache/pip

COPY --from=nodebuild /usr/local/src/app/packages ./packages
COPY --from=nodebuild /usr/local/src/app/node_modules ./node_modules
COPY --from=nodebuild /usr/local/src/app/package.json ./package.json

# Remove TypeScript files from front-end so Next.js doesn't try to install TypeScript
RUN rm -f packages/front-end/tsconfig.json && \
    find packages/front-end -maxdepth 1 -name "*.ts" -delete && \
    find packages/front-end -maxdepth 1 -name "*.tsx" -delete

# Copy PM2 config file
COPY ecosystem.config.js ./ecosystem.config.js

# Copy yarn compatibility shim for users with custom entry points
COPY bin/yarn ./bin/yarn
RUN chmod +x ./bin/yarn
ENV PATH="/usr/local/src/app/bin:${PATH}"

# wildcard used to act as 'copy if exists'
COPY buildinfo* ./buildinfo

COPY --from=pybuild /usr/local/src/app/dist /usr/local/src/gbstats
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
# Use TRACING_PROVIDER env var to enable tracing (datadog or opentelemetry)
CMD ["node_modules/.bin/pm2-runtime", "start", "ecosystem.config.js"]
