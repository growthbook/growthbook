FROM python:slim

RUN apt-get update && \
  apt-get install -y wget gnupg2 && \
  echo "deb https://deb.nodesource.com/node_14.x buster main" > /etc/apt/sources.list.d/nodesource.list && \
  wget -qO- https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add - && \
  echo "deb https://dl.yarnpkg.com/debian/ stable main" > /etc/apt/sources.list.d/yarn.list && \
  wget -qO- https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add - && \
  apt-get update && \
  apt-get install -yqq nodejs=$(apt-cache show nodejs|grep Version|grep nodesource|cut -c 10-) yarn && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* && \
  pip3 install \
    gbstats \
    nbformat \
    numpy \
    pandas \
    scipy

WORKDIR /usr/local/src/app

# Copy only the required files
COPY . /usr/local/src/app

RUN \
  # Install app with dev dependencies
  yarn install --frozen-lockfile --ignore-optional \
  # Build the app
  && yarn build \
  # Then do a clean install with only production dependencies
  && rm -rf node_modules \
  && rm -rf packages/back-end/node_modules \
  && rm -rf packages/front-end/node_modules \
  && rm -rf packages/front-end/.next/cache \
  && yarn install --frozen-lockfile --production=true --ignore-optional \
  && wget -qO- https://gobinaries.com/tj/node-prune | sh \
  && node-prune \
  # Clear the yarn cache
  && yarn cache clean

# The front-end app (NextJS)
EXPOSE 3000
# The back-end api (Express)
EXPOSE 3100

CMD ["yarn","start"]
