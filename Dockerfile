# Build the python gbstats package
FROM python:3.9-slim AS pybuild
WORKDIR /usr/local/src/app
COPY ./packages/stats .
RUN \
  pip3 install poetry \
  && poetry install --no-root --no-dev --no-interaction --no-ansi \
  && poetry build


# Build the nodejs app
FROM node:16-slim AS nodebuild
WORKDIR /usr/local/src/app
# Yarn install with dev dependencies
COPY package.json ./package.json
COPY yarn.lock ./yarn.lock
COPY packages/front-end/package.json ./packages/front-end/package.json
COPY packages/back-end/package.json ./packages/back-end/package.json
RUN yarn install --frozen-lockfile --ignore-optional
# Build the app and do a clean install with only production dependencies
COPY packages ./packages
RUN \
  yarn build \
  && rm -rf node_modules \
  && rm -rf packages/back-end/node_modules \
  && rm -rf packages/front-end/node_modules \
  && rm -rf packages/front-end/.next/cache \
  && yarn install --frozen-lockfile --production=true --ignore-optional


# Package the full app together
FROM python:3.9-slim
WORKDIR /usr/local/src/app
RUN apt-get update && \
  apt-get install -y wget gnupg2 && \
  echo "deb https://deb.nodesource.com/node_16.x buster main" > /etc/apt/sources.list.d/nodesource.list && \
  wget -qO- https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add - && \
  echo "deb https://dl.yarnpkg.com/debian/ stable main" > /etc/apt/sources.list.d/yarn.list && \
  wget -qO- https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add - && \
  apt-get update && \
  apt-get install -yqq nodejs=$(apt-cache show nodejs|grep Version|grep nodesource|cut -c 10-) yarn && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*
RUN pip3 install \
    nbformat \
    numpy \
    pandas \
    scipy \
  && rm -rf /root/.cache/pip
COPY --from=nodebuild /usr/local/src/app/packages ./packages
COPY --from=nodebuild /usr/local/src/app/node_modules ./node_modules
COPY --from=nodebuild /usr/local/src/app/package.json ./package.json

# wildcard used to act as 'copy if exists'
# COPY buildinfo* ./buildinfo

COPY --from=pybuild /usr/local/src/app/dist /usr/local/src/gbstats
RUN pip3 install /usr/local/src/gbstats/*.whl
# The front-end app (NextJS)
EXPOSE 3000
# The back-end api (Express)
EXPOSE 3100
# Start both front-end and back-end at once
CMD ["yarn","start"]
